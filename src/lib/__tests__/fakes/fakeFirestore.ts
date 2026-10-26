/**
 * In-memory Firestore fake exposing both the Admin SDK (method-chained refs) and the modular
 * SDK (free functions, for use with `vi.mock('firebase/firestore')`) over one store.
 *
 * It mimics the behaviours the driver depends on:
 * - every read yields to the event loop, so concurrent operations interleave;
 * - transactions use optimistic concurrency and retry when a read document changed;
 * - writes reject `undefined` at any depth, as real Firestore does;
 * - snapshot listeners are delivered asynchronously, one listener per macrotask.
 */

type Data = Record<string, unknown>;
type Flavor = 'admin' | 'modular';

interface StoredDoc {
  data: Data;
  version: number;
}

interface FakeDocRef {
  kind: 'doc';
  path: string;
  fs: FakeFirestore;
}

interface FakeQuery {
  kind: 'query';
  collectionPath: string;
  filters: Array<[string, string, unknown]>;
  order?: [string, 'asc' | 'desc'];
  fs: FakeFirestore;
}

type Target = FakeDocRef | FakeQuery;

interface Listener {
  target: Target;
  flavor: Flavor;
  onNext: (snap: unknown) => void;
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function assertNoUndefined(value: unknown, path = ''): void {
  if (value === undefined) {
    throw new Error(
      `Function setDoc() called with invalid data. Unsupported field value: undefined (found in field ${path || '<root>'})`
    );
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoUndefined(item, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      assertNoUndefined(val, path ? `${path}.${key}` : key);
    }
  }
}

function getField(data: Data, field: string): unknown {
  return field.split('.').reduce<unknown>((acc, key) => (acc as Data | undefined)?.[key], data);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class FakeFirestore {
  private docs = new Map<string, StoredDoc>();
  private listeners = new Set<Listener>();
  /** Number of transaction attempts that were rolled back and retried. */
  public transactionRetries = 0;

  // --- Store primitives ---

  public raw(path: string): Data | undefined {
    const doc = this.docs.get(path);
    return doc ? clone(doc.data) : undefined;
  }

  public listenerCount(): number {
    return this.listeners.size;
  }

  private version(path: string): number {
    return this.docs.get(path)?.version ?? 0;
  }

  private write(path: string, data: Data, merge: boolean): void {
    assertNoUndefined(data);
    const existing = this.docs.get(path);
    if (merge && !existing) {
      throw new Error(`NOT_FOUND: No document to update: ${path}`);
    }
    this.docs.set(path, {
      data: clone(merge && existing ? { ...existing.data, ...data } : data),
      version: (existing?.version ?? 0) + 1
    });
    for (const listener of this.listeners) {
      if (this.affects(listener.target, path)) this.deliver(listener);
    }
  }

  private affects(target: Target, path: string): boolean {
    if (target.kind === 'doc') return target.path === path;
    const parent = path.slice(0, path.lastIndexOf('/'));
    return parent === target.collectionPath;
  }

  private docSnap(path: string, flavor: Flavor) {
    const doc = this.docs.get(path);
    const data = doc ? clone(doc.data) : undefined;
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      exists: flavor === 'admin' ? !!doc : () => !!doc,
      data: () => data
    };
  }

  private querySnap(query: FakeQuery, flavor: Flavor) {
    const prefix = `${query.collectionPath}/`;
    let paths = Array.from(this.docs.keys()).filter(
      p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')
    );
    paths = paths.filter(p =>
      query.filters.every(([field, op, value]) => {
        if (op !== '==') throw new Error(`Fake only supports '==' filters, got ${op}`);
        return getField(this.docs.get(p)!.data, field) === value;
      })
    );
    if (query.order) {
      const [field, direction] = query.order;
      paths.sort((a, b) => {
        const va = String(getField(this.docs.get(a)!.data, field));
        const vb = String(getField(this.docs.get(b)!.data, field));
        return direction === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
    return { docs: paths.map(p => this.docSnap(p, flavor)) };
  }

  private snapshot(target: Target, flavor: Flavor) {
    return target.kind === 'doc'
      ? this.docSnap(target.path, flavor)
      : this.querySnap(target, flavor);
  }

  private deliver(listener: Listener): void {
    setTimeout(() => {
      if (this.listeners.has(listener)) {
        listener.onNext(this.snapshot(listener.target, listener.flavor));
      }
    }, 0);
  }

  // --- Shared operations used by both SDK facades ---

  public async get(target: Target, flavor: Flavor) {
    await tick();
    return this.snapshot(target, flavor);
  }

  public async set(ref: FakeDocRef, data: Data): Promise<void> {
    await tick();
    this.write(ref.path, data, false);
  }

  public async update(ref: FakeDocRef, data: Data): Promise<void> {
    await tick();
    this.write(ref.path, data, true);
  }

  public listen(target: Target, flavor: Flavor, onNext: (snap: unknown) => void): () => void {
    const listener: Listener = { target, flavor, onNext };
    this.listeners.add(listener);
    this.deliver(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async runTransaction<T>(flavor: Flavor, fn: (tx: unknown) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 25; attempt++) {
      const reads = new Map<string, number>();
      const writes: Array<() => void> = [];
      const tx = {
        get: async (ref: FakeDocRef) => {
          if (writes.length > 0) {
            throw new Error('Firestore transactions require all reads to be executed before all writes.');
          }
          await tick();
          reads.set(ref.path, this.version(ref.path));
          return this.docSnap(ref.path, flavor);
        },
        set: (ref: FakeDocRef, data: Data) => {
          assertNoUndefined(data);
          writes.push(() => this.write(ref.path, data, false));
          return tx;
        },
        update: (ref: FakeDocRef, data: Data) => {
          assertNoUndefined(data);
          writes.push(() => this.write(ref.path, data, true));
          return tx;
        }
      };

      const result = await fn(tx);
      await tick();
      const stale = Array.from(reads).some(([path, version]) => this.version(path) !== version);
      if (stale) {
        this.transactionRetries++;
        continue;
      }
      for (const commit of writes) commit();
      return result;
    }
    throw new Error('ABORTED: transaction contention');
  }

  public docRef(path: string): FakeDocRef {
    return { kind: 'doc', path, fs: this };
  }

  public queryRef(collectionPath: string): FakeQuery {
    return { kind: 'query', collectionPath, filters: [], fs: this };
  }
}

// --- Admin SDK facade ---

function adminDoc(fs: FakeFirestore, path: string): any {
  const ref = fs.docRef(path);
  return {
    path,
    get: () => fs.get(ref, 'admin'),
    set: (data: Data) => fs.set(ref, data),
    update: (data: Data) => fs.update(ref, data),
    onSnapshot: (onNext: (snap: unknown) => void) => fs.listen(ref, 'admin', onNext),
    collection: (sub: string) => adminQuery(fs, fs.queryRef(`${path}/${sub}`)),
    __ref: ref
  };
}

function adminQuery(fs: FakeFirestore, query: FakeQuery): any {
  return {
    doc: (id: string) => adminDoc(fs, `${query.collectionPath}/${id}`),
    where: (field: string, op: string, value: unknown) =>
      adminQuery(fs, { ...query, filters: [...query.filters, [field, op, value]] }),
    orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') =>
      adminQuery(fs, { ...query, order: [field, direction] }),
    get: () => fs.get(query, 'admin'),
    onSnapshot: (onNext: (snap: unknown) => void) => fs.listen(query, 'admin', onNext)
  };
}

/** Creates an object shaped like a `firebase-admin/firestore` Firestore instance. */
export function createAdminDb(fs = new FakeFirestore()) {
  const db = {
    doc: (path: string) => adminDoc(fs, path),
    collection: (path: string) => adminQuery(fs, fs.queryRef(path)),
    runTransaction: <T>(fn: (tx: any) => Promise<T>) =>
      fs.runTransaction('admin', tx =>
        fn({
          get: (ref: any) => (tx as any).get(ref.__ref),
          set: (ref: any, data: Data) => (tx as any).set(ref.__ref, data),
          update: (ref: any, data: Data) => (tx as any).update(ref.__ref, data)
        })
      )
  };
  return { db, fs };
}

// --- Modular SDK facade (pass as the `vi.mock('firebase/firestore')` factory result) ---

/** Creates an object shaped like a modular-SDK `Firestore` instance (no methods). */
export function createModularDb(fs = new FakeFirestore()) {
  return { db: { type: 'firestore', __fake: fs }, fs };
}

function fakeOf(db: any): FakeFirestore {
  if (!db?.__fake) throw new Error('Expected a fake modular Firestore instance');
  return db.__fake;
}

export const modularFirestore = {
  doc: (db: any, path: string) => fakeOf(db).docRef(path),
  collection: (db: any, path: string) => fakeOf(db).queryRef(path),
  where: (field: string, op: string, value: unknown) => ({ type: 'where', field, op, value }),
  orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') => ({ type: 'orderBy', field, direction }),
  query: (base: FakeQuery, ...constraints: any[]): FakeQuery => {
    let q = base;
    for (const c of constraints) {
      q =
        c.type === 'where'
          ? { ...q, filters: [...q.filters, [c.field, c.op, c.value]] }
          : { ...q, order: [c.field, c.direction] };
    }
    return q;
  },
  getDoc: (ref: FakeDocRef) => ref.fs.get(ref, 'modular'),
  getDocs: (query: FakeQuery) => query.fs.get(query, 'modular'),
  setDoc: (ref: FakeDocRef, data: Data) => ref.fs.set(ref, data),
  updateDoc: (ref: FakeDocRef, data: Data) => ref.fs.update(ref, data),
  onSnapshot: (target: Target, onNext: (snap: unknown) => void) =>
    target.fs.listen(target, 'modular', onNext),
  runTransaction: <T>(db: any, fn: (tx: any) => Promise<T>) =>
    fakeOf(db).runTransaction('modular', fn)
};
