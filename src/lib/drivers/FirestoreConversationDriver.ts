import type { ConversationDriver } from './ConversationDriver.js';
import type {
  Conversation,
  CreateConversationPayload,
  Message,
  PostMessagePayload
} from '../types.js';

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

function sanitizeDocument(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

export class FirestoreConversationDriver implements ConversationDriver {
  private db: any;
  private conversationsCol: string;
  private messagesSubcol: string;

  constructor(options: FirestoreConversationDriverOptions) {
    if (!options?.db) {
      throw new Error('FirestoreConversationDriver requires a Firestore instance (db).');
    }
    this.db = options.db;
    this.conversationsCol = options.conversationsCollection || 'conversations';
    this.messagesSubcol = options.messagesSubcollection || 'messages';
  }

  public async getConversation(id: string): Promise<Conversation | null> {
    const docRef = this.getDocRef(this.conversationsCol, id);
    const snap = await this.getDoc(docRef);
    if (!this.snapExists(snap)) return null;
    return this.snapData(snap) as Conversation;
  }

  public async getConversationByEntity(
    entityId: string,
    entityType?: string
  ): Promise<Conversation | null> {
    const colRef = this.getCollectionRef(this.conversationsCol);
    let q = this.queryWhere(colRef, 'entity.id', '==', entityId);
    if (entityType) {
      q = this.queryWhere(q, 'entity.type', '==', entityType);
    }
    const snap = await this.getDocs(q);
    const docs = this.snapDocs(snap);
    if (docs.length === 0) return null;
    return this.snapData(docs[0]) as Conversation;
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

    const docRef = this.getDocRef(this.conversationsCol, id);
    await this.setDoc(docRef, sanitizeDocument(conversation as any));

    return conversation;
  }

  public async updateConversationStatus(
    id: string,
    status: 'open' | 'resolved' | 'archived',
    resolvedBy?: string
  ): Promise<Conversation> {
    const docRef = this.getDocRef(this.conversationsCol, id);
    const snap = await this.getDoc(docRef);
    if (!this.snapExists(snap)) {
      throw new Error(`Conversation not found: ${id}`);
    }

    const now = new Date().toISOString();
    const existing = this.snapData(snap) as Conversation;
    const updated: Conversation = {
      ...existing,
      status,
      resolvedAt: status === 'resolved' ? now : undefined,
      resolvedBy: status === 'resolved' ? resolvedBy : undefined,
      updatedAt: now
    };

    await this.setDoc(docRef, sanitizeDocument(updated as any));
    return updated;
  }

  public async postMessage(payload: PostMessagePayload): Promise<Message> {
    const convoRef = this.getDocRef(this.conversationsCol, payload.conversationId);
    const convoSnap = await this.getDoc(convoRef);
    if (!this.snapExists(convoSnap)) {
      throw new Error(`Conversation not found: ${payload.conversationId}`);
    }

    const id = payload.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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
      attachments: payload.attachments || [],
      metadata: payload.metadata || {},
      createdAt: now
    };

    // Subcollection: conversations/{convoId}/messages/{id}
    const msgRef = this.getSubDocRef(convoRef, this.messagesSubcol, id);
    await this.setDoc(msgRef, sanitizeDocument(message as any));

    // Update parent metadata
    const convoData = this.snapData(convoSnap) as Conversation;
    const participants = new Set(convoData.participantIds || []);
    if (payload.author.id) participants.add(payload.author.id);

    const updatedConvo: Partial<Conversation> = {
      participantIds: Array.from(participants),
      messageCount: (convoData.messageCount || 0) + 1,
      lastMessageAt: now,
      updatedAt: now
    };

    await this.updateDoc(convoRef, sanitizeDocument(updatedConvo as any));

    return message;
  }

  public async listMessages(conversationId: string): Promise<Message[]> {
    const convoRef = this.getDocRef(this.conversationsCol, conversationId);
    const msgCol = this.getSubCollectionRef(convoRef, this.messagesSubcol);
    const q = this.queryOrderBy(msgCol, 'createdAt', 'asc');
    const snap = await this.getDocs(q);

    return this.snapDocs(snap).map(d => this.snapData(d) as Message);
  }

  public async updateMessage(id: string, updates: Partial<Message>): Promise<Message> {
    // Requires conversationId in metadata or parameter, fallback search
    throw new Error('updateMessage on FirestoreDriver requires conversation subcollection path.');
  }

  public subscribeToConversation(
    conversationId: string,
    onUpdate: (conversation: Conversation | null, messages: Message[]) => void,
    onError?: (error: Error) => void
  ): () => void {
    const convoRef = this.getDocRef(this.conversationsCol, conversationId);
    const msgCol = this.getSubCollectionRef(convoRef, this.messagesSubcol);
    const msgQuery = this.queryOrderBy(msgCol, 'createdAt', 'asc');

    let currentConvo: Conversation | null = null;
    let currentMsgs: Message[] = [];

    const unsubConvo = this.onSnapshot(
      convoRef,
      (snap: any) => {
        currentConvo = this.snapExists(snap) ? (this.snapData(snap) as Conversation) : null;
        onUpdate(currentConvo, currentMsgs);
      },
      onError
    );

    const unsubMsgs = this.onSnapshot(
      msgQuery,
      (snap: any) => {
        currentMsgs = this.snapDocs(snap).map((d: any) => this.snapData(d) as Message);
        onUpdate(currentConvo, currentMsgs);
      },
      onError
    );

    return () => {
      if (typeof unsubConvo === 'function') unsubConvo();
      if (typeof unsubMsgs === 'function') unsubMsgs();
    };
  }

  // --- Firestore SDK Compatibility Helpers ---
  private getDocRef(collection: string, id: string): any {
    if (typeof this.db.collection === 'function') {
      return this.db.collection(collection).doc(id);
    }
    // Modular SDK
    return { _type: 'doc', path: `${collection}/${id}`, db: this.db };
  }

  private getCollectionRef(collection: string): any {
    if (typeof this.db.collection === 'function') {
      return this.db.collection(collection);
    }
    return { _type: 'collection', path: collection, db: this.db };
  }

  private getSubDocRef(parentRef: any, subcollection: string, id: string): any {
    if (typeof parentRef.collection === 'function') {
      return parentRef.collection(subcollection).doc(id);
    }
    return { _type: 'doc', path: `${parentRef.path}/${subcollection}/${id}`, db: this.db };
  }

  private getSubCollectionRef(parentRef: any, subcollection: string): any {
    if (typeof parentRef.collection === 'function') {
      return parentRef.collection(subcollection);
    }
    return { _type: 'collection', path: `${parentRef.path}/${subcollection}`, db: this.db };
  }

  private async getDoc(ref: any): Promise<any> {
    if (typeof ref.get === 'function') return ref.get();
    const { getDoc } = await import('firebase/firestore');
    return getDoc(ref);
  }

  private async getDocs(query: any): Promise<any> {
    if (typeof query.get === 'function') return query.get();
    const { getDocs } = await import('firebase/firestore');
    return getDocs(query);
  }

  private async setDoc(ref: any, data: any): Promise<any> {
    if (typeof ref.set === 'function') return ref.set(data);
    const { setDoc } = await import('firebase/firestore');
    return setDoc(ref, data);
  }

  private async updateDoc(ref: any, data: any): Promise<any> {
    if (typeof ref.update === 'function') return ref.update(data);
    const { updateDoc } = await import('firebase/firestore');
    return updateDoc(ref, data);
  }

  private queryWhere(ref: any, field: string, op: any, val: any): any {
    if (typeof ref.where === 'function') return ref.where(field, op, val);
    return { ...ref, _filter: { field, op, val } };
  }

  private queryOrderBy(ref: any, field: string, direction: 'asc' | 'desc'): any {
    if (typeof ref.orderBy === 'function') return ref.orderBy(field, direction);
    return { ...ref, _orderBy: { field, direction } };
  }

  private onSnapshot(ref: any, onNext: (snap: any) => void, onError?: (err: Error) => void): () => void {
    if (typeof ref.onSnapshot === 'function') {
      return ref.onSnapshot(onNext, onError);
    }
    let unsub = () => {};
    import('firebase/firestore').then(({ onSnapshot }) => {
      unsub = onSnapshot(ref, onNext, onError);
    }).catch(err => {
      if (onError) onError(err);
    });
    return () => unsub();
  }

  private snapExists(snap: any): boolean {
    if (typeof snap.exists === 'function') return snap.exists();
    return !!snap.exists;
  }

  private snapData(snap: any): any {
    if (typeof snap.data === 'function') return snap.data();
    return snap.data;
  }

  private snapDocs(snap: any): any[] {
    if (Array.isArray(snap.docs)) return snap.docs;
    return [];
  }
}
