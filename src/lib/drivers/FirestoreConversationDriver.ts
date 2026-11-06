import type { ConversationDriver } from './ConversationDriver.js';
import type {
  Conversation,
  CreateConversationPayload,
  Message,
  PostMessagePayload
} from '../types.js';
import { hasUserReacted, normalizeReactionInput, type ReactionInput } from '../core/reactions.js';

export interface FirestoreConversationDriverOptions {
  /**
   * Firestore instance from modular SDK ('firebase/firestore') or 'firebase-admin/firestore'.
   */
  db: any;
  /**
   * Root collection name for conversations. Defaults to 'conversations'.
   */
  conversationsCollection?: string;
  /**
   * Subcollection name for messages. Defaults to 'messages'.
   */
  messagesSubcollection?: string;
}

type WhereClause = [field: string, op: string, value: unknown];

interface QuerySpec {
  where?: WhereClause[];
  orderBy?: [field: string, direction: 'asc' | 'desc'];
}

interface Transaction {
  get(ref: any): Promise<any>;
  set(ref: any, data: Record<string, unknown>): unknown;
  update(ref: any, data: Record<string, unknown>): unknown;
}

/**
 * The handful of Firestore operations the driver needs, bound to one SDK flavour.
 * Admin SDK refs carry their own methods; the modular SDK needs free functions
 * (`doc`, `query`, `getDoc`, ...) applied to refs it created itself.
 */
interface FirestoreOps {
  doc(path: string): any;
  query(collectionPath: string, spec: QuerySpec): any;
  getDoc(ref: any): Promise<any>;
  getDocs(query: any): Promise<any>;
  setDoc(ref: any, data: Record<string, unknown>): Promise<unknown>;
  runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  onSnapshot(ref: any, onNext: (snap: any) => void, onError?: (err: Error) => void): () => void;
}

function adminOps(db: any): FirestoreOps {
  return {
    doc: path => db.doc(path),
    query: (collectionPath, { where = [], orderBy }) => {
      let q = db.collection(collectionPath);
      for (const [field, op, value] of where) q = q.where(field, op, value);
      if (orderBy) q = q.orderBy(...orderBy);
      return q;
    },
    getDoc: ref => ref.get(),
    getDocs: query => query.get(),
    setDoc: (ref, data) => ref.set(data),
    runTransaction: fn => db.runTransaction(fn),
    onSnapshot: (ref, onNext, onError) => ref.onSnapshot(onNext, onError)
  };
}

async function modularOps(db: any): Promise<FirestoreOps> {
  const fs = await import('firebase/firestore');
  return {
    doc: path => fs.doc(db, path),
    query: (collectionPath, { where = [], orderBy }) =>
      fs.query(
        fs.collection(db, collectionPath),
        ...where.map(([field, op, value]) => fs.where(field, op as any, value)),
        ...(orderBy ? [fs.orderBy(...orderBy)] : [])
      ),
    getDoc: ref => fs.getDoc(ref),
    getDocs: query => fs.getDocs(query),
    setDoc: (ref, data) => fs.setDoc(ref, data),
    runTransaction: fn => fs.runTransaction(db, fn as any),
    onSnapshot: (ref, onNext, onError) => fs.onSnapshot(ref, onNext, onError)
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively strips `undefined` (which Firestore rejects at any depth) from plain objects
 * and arrays. Non-plain values such as Timestamps and FieldValue sentinels pass through.
 */
function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter(item => item !== undefined).map(sanitizeValue);
  }
  if (isPlainObject(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) {
        sanitized[key] = sanitizeValue(val);
      }
    }
    return sanitized;
  }
  return value;
}

function sanitizeDocument(data: object): Record<string, unknown> {
  return sanitizeValue(data) as Record<string, unknown>;
}

function snapExists(snap: any): boolean {
  if (typeof snap.exists === 'function') return snap.exists();
  return !!snap.exists;
}

function snapData(snap: any): any {
  if (typeof snap.data === 'function') return snap.data();
  return snap.data;
}

function snapDocs(snap: any): any[] {
  if (Array.isArray(snap.docs)) return snap.docs;
  return [];
}

export class FirestoreConversationDriver implements ConversationDriver {
  private db: any;
  private conversationsCol: string;
  private messagesSubcol: string;
  private opsPromise?: Promise<FirestoreOps>;

  constructor(options: FirestoreConversationDriverOptions) {
    if (!options?.db) {
      throw new Error('FirestoreConversationDriver requires a Firestore instance (db).');
    }
    this.db = options.db;
    this.conversationsCol = options.conversationsCollection || 'conversations';
    this.messagesSubcol = options.messagesSubcollection || 'messages';
  }

  public async getConversation(id: string): Promise<Conversation | null> {
    const ops = await this.ops();
    const snap = await ops.getDoc(ops.doc(this.conversationPath(id)));
    if (!snapExists(snap)) return null;
    return snapData(snap) as Conversation;
  }

  public async getConversationByEntity(
    entityId: string,
    entityType?: string
  ): Promise<Conversation | null> {
    const ops = await this.ops();
    const where: WhereClause[] = [['entity.id', '==', entityId]];
    if (entityType) {
      where.push(['entity.type', '==', entityType]);
    }
    const snap = await ops.getDocs(ops.query(this.conversationsCol, { where }));
    const docs = snapDocs(snap);
    if (docs.length === 0) return null;
    return snapData(docs[0]) as Conversation;
  }

  public async createConversation(payload: CreateConversationPayload): Promise<Conversation> {
    const id = payload.id || `convo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const conversation: Conversation = {
      id,
      entity: payload.entity,
      status: 'open',
      participantIds: [],
      messageCount: 0,
      metadata: payload.metadata || {},
      createdAt: now,
      updatedAt: now
    };

    const ops = await this.ops();
    await ops.setDoc(ops.doc(this.conversationPath(id)), sanitizeDocument(conversation));

    return conversation;
  }

  public async updateConversationStatus(
    id: string,
    status: 'open' | 'resolved' | 'archived',
    resolvedBy?: string
  ): Promise<Conversation> {
    const ops = await this.ops();
    const docRef = ops.doc(this.conversationPath(id));

    return ops.runTransaction(async tx => {
      const snap = await tx.get(docRef);
      if (!snapExists(snap)) {
        throw new Error(`Conversation not found: ${id}`);
      }

      const now = new Date().toISOString();
      const existing = snapData(snap) as Conversation;
      const updated: Conversation = {
        ...existing,
        status,
        resolvedAt: status === 'resolved' ? now : undefined,
        resolvedBy: status === 'resolved' ? resolvedBy : undefined,
        updatedAt: now
      };

      tx.set(docRef, sanitizeDocument(updated));
      return updated;
    });
  }

  public async postMessage(payload: PostMessagePayload): Promise<Message> {
    const ops = await this.ops();
    const convoRef = ops.doc(this.conversationPath(payload.conversationId));

    const id = payload.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const msgRef = ops.doc(this.messagePath(payload.conversationId, id));

    // The message write and the summary update (messageCount, participantIds) commit
    // together, and the transaction retries on contention so concurrent posts never
    // lose an increment or a participant.
    return ops.runTransaction(async tx => {
      const convoSnap = await tx.get(convoRef);
      if (!snapExists(convoSnap)) {
        throw new Error(`Conversation not found: ${payload.conversationId}`);
      }

      const now = new Date().toISOString();
      const message: Message = {
        id,
        conversationId: payload.conversationId,
        author: payload.author,
        content: payload.content,
        richContent: payload.richContent,
        parentId: payload.parentId || null,
        status: 'sent',
        mentions: payload.mentions || [],
        ...(payload.stickers ? { stickers: payload.stickers } : {}),
        attachments: payload.attachments || [],
        reactions: payload.reactions || [],
        metadata: payload.metadata || {},
        createdAt: now
      };

      const convoData = snapData(convoSnap) as Conversation;
      const participants = new Set(convoData.participantIds || []);
      if (payload.author.id) participants.add(payload.author.id);

      tx.set(msgRef, sanitizeDocument(message));
      tx.update(
        convoRef,
        sanitizeDocument({
          participantIds: Array.from(participants),
          messageCount: (convoData.messageCount || 0) + 1,
          lastMessageAt: now,
          updatedAt: now
        })
      );

      return message;
    });
  }

  public async listMessages(conversationId: string): Promise<Message[]> {
    const ops = await this.ops();
    const q = ops.query(this.messagesPath(conversationId), { orderBy: ['createdAt', 'asc'] });
    const snap = await ops.getDocs(q);
    return snapDocs(snap).map(d => snapData(d) as Message);
  }

  public async updateMessage(
    id: string,
    updates: Partial<Message>,
    conversationId?: string
  ): Promise<Message> {
    const targetConvoId = conversationId || updates.conversationId;
    if (!targetConvoId) {
      throw new Error(
        'updateMessage on FirestoreDriver requires conversationId (pass as third argument or via updates.conversationId).'
      );
    }
    return this.mutateMessage(id, targetConvoId, () => updates);
  }

  public async deleteMessage(id: string, conversationId?: string): Promise<Message> {
    return this.updateMessage(
      id,
      {
        status: 'deleted',
        content: '[This comment was deleted]',
        richContent: undefined,
        attachments: []
      },
      conversationId
    );
  }

  public async addReaction(
    messageId: string,
    reaction: { emoji: string; sticker?: string; userId: string },
    conversationId?: string
  ): Promise<Message> {
    if (!conversationId) {
      throw new Error('addReaction on FirestoreDriver requires conversationId.');
    }
    const normalized = normalizeReactionInput(reaction);
    return this.mutateMessage(messageId, conversationId, existing =>
      hasUserReacted(existing.reactions, normalized, reaction.userId)
        ? null
        : { reactions: withReaction(existing, { ...normalized, userId: reaction.userId }) }
    );
  }

  public async removeReaction(
    messageId: string,
    reaction: ReactionInput,
    userId: string,
    conversationId?: string
  ): Promise<Message> {
    if (!conversationId) {
      throw new Error('removeReaction on FirestoreDriver requires conversationId.');
    }
    const normalized = normalizeReactionInput(reaction);
    return this.mutateMessage(messageId, conversationId, existing => ({
      reactions: withoutReaction(existing, normalized, userId)
    }));
  }

  public async toggleReaction(
    messageId: string,
    reaction: { emoji: string; sticker?: string; userId: string },
    conversationId?: string
  ): Promise<Message> {
    if (!conversationId) {
      throw new Error('toggleReaction on FirestoreDriver requires conversationId.');
    }
    const normalized = normalizeReactionInput(reaction);
    return this.mutateMessage(messageId, conversationId, existing => ({
      reactions: hasUserReacted(existing.reactions, normalized, reaction.userId)
        ? withoutReaction(existing, normalized, reaction.userId)
        : withReaction(existing, { ...normalized, userId: reaction.userId })
    }));
  }

  public subscribeToConversation(
    conversationId: string,
    onUpdate: (conversation: Conversation | null, messages: Message[]) => void,
    onError?: (error: Error) => void
  ): () => void {
    let currentConvo: Conversation | null = null;
    let currentMsgs: Message[] = [];
    let convoReady = false;
    let msgsReady = false;

    // Hold back the first update until both listeners have delivered, so consumers never
    // see a loaded conversation with an empty message list that then pops in.
    const emit = () => {
      if (convoReady && msgsReady) onUpdate(currentConvo, currentMsgs);
    };

    const unsubConvo = this.listen(
      ops => ops.doc(this.conversationPath(conversationId)),
      snap => {
        currentConvo = snapExists(snap) ? (snapData(snap) as Conversation) : null;
        convoReady = true;
        emit();
      },
      onError
    );

    const unsubMsgs = this.listen(
      ops => ops.query(this.messagesPath(conversationId), { orderBy: ['createdAt', 'asc'] }),
      snap => {
        currentMsgs = snapDocs(snap).map(d => snapData(d) as Message);
        msgsReady = true;
        emit();
      },
      onError
    );

    return () => {
      unsubConvo();
      unsubMsgs();
    };
  }

  public subscribeToEntityConversations(
    entityId: string,
    onUpdate: (conversations: Conversation[]) => void,
    onError?: (error: Error) => void
  ): () => void {
    return this.listen(
      ops => ops.query(this.conversationsCol, { where: [['entity.id', '==', entityId]] }),
      snap => onUpdate(snapDocs(snap).map(d => snapData(d) as Conversation)),
      onError
    );
  }

  private ops(): Promise<FirestoreOps> {
    if (!this.opsPromise) {
      this.opsPromise =
        typeof this.db.collection === 'function'
          ? Promise.resolve(adminOps(this.db))
          : modularOps(this.db);
    }
    return this.opsPromise;
  }

  /**
   * Attaches a snapshot listener once the SDK is ready. Unsubscribing before then cancels
   * the pending attach instead of leaving a listener behind that nothing can remove.
   */
  private listen(
    target: (ops: FirestoreOps) => any,
    onNext: (snap: any) => void,
    onError?: (err: Error) => void
  ): () => void {
    let cancelled = false;
    let unsub: (() => void) | undefined;

    this.ops()
      .then(ops => {
        if (cancelled) return;
        unsub = ops.onSnapshot(target(ops), onNext, onError);
      })
      .catch(err => {
        if (!cancelled) onError?.(err);
      });

    return () => {
      cancelled = true;
      unsub?.();
      unsub = undefined;
    };
  }

  /**
   * Reads a message and writes the result of `mutate` in one transaction, so concurrent
   * edits and reactions are retried against fresh data instead of overwriting each other.
   * `mutate` may run more than once and must not have side effects; returning null skips
   * the write.
   */
  private async mutateMessage(
    id: string,
    conversationId: string,
    mutate: (existing: Message) => Partial<Message> | null
  ): Promise<Message> {
    const ops = await this.ops();
    const msgRef = ops.doc(this.messagePath(conversationId, id));

    return ops.runTransaction(async tx => {
      const snap = await tx.get(msgRef);
      if (!snapExists(snap)) {
        throw new Error(`Message not found: ${id}`);
      }

      const existing = snapData(snap) as Message;
      const updates = mutate(existing);
      if (!updates) return existing;

      const updated: Message = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString()
      };
      tx.set(msgRef, sanitizeDocument(updated));
      return updated;
    });
  }

  private conversationPath(conversationId: string): string {
    return `${this.conversationsCol}/${conversationId}`;
  }

  private messagesPath(conversationId: string): string {
    return `${this.conversationPath(conversationId)}/${this.messagesSubcol}`;
  }

  private messagePath(conversationId: string, messageId: string): string {
    return `${this.messagesPath(conversationId)}/${messageId}`;
  }
}

function withReaction(
  message: Message,
  reaction: { emoji: string; sticker?: string; userId: string }
) {
  return [
    ...(message.reactions || []),
    {
      emoji: reaction.emoji,
      ...(reaction.sticker ? { sticker: reaction.sticker } : {}),
      userId: reaction.userId,
      createdAt: new Date().toISOString()
    }
  ];
}

function withoutReaction(message: Message, reaction: ReactionInput, userId: string) {
  return (message.reactions || []).filter(r => !hasUserReacted([r], reaction, userId));
}
