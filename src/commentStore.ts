import { ThreadStore, ThreadStoreAuth, type CommentData, type ThreadData } from "@blocknote/core/comments";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { commentsChanged, type Anchor, type CollabApi, type Thread } from "./collabApi.ts";

export const commentSchema = BlockNoteSchema.create({ blockSpecs: { paragraph: defaultBlockSpecs.paragraph }, inlineContentSpecs: defaultInlineContentSpecs, styleSpecs: {} });

export class CommentAuth extends ThreadStoreAuth {
  private userId: string;
  writable: boolean;
  private admin: boolean;
  constructor(userId: string, writable: boolean, admin: boolean) { super(); this.userId = userId; this.writable = writable; this.admin = admin; }
  canCreateThread() { return this.writable; }
  canAddComment() { return this.writable; }
  canUpdateComment(comment: CommentData) { return this.writable && comment.userId === this.userId; }
  canDeleteComment(comment: CommentData) { return this.writable && (comment.userId === this.userId || this.admin); }
  canDeleteThread() { return false; }
  canResolveThread() { return this.writable; }
  canUnresolveThread() { return this.writable; }
  canAddReaction() { return false; }
  canDeleteReaction() { return false; }
}

function messageBody(body: unknown): string {
  if (!Array.isArray(body)) throw new Error("Write a comment before saving.");
  const text = (parts: unknown): string => Array.isArray(parts) ? parts.map(part => {
    if (!part || typeof part !== "object") return "";
    const item = part as Record<string, unknown>;
    if (item.type === "text" && typeof item.text === "string") return item.text;
    const label = text(item.content);
    return item.type === "link" && typeof item.href === "string" && item.href !== label ? `${label} (${item.href})` : label;
  }).join("") : "";
  const result = body.map(block => text(block.content)).join("\n").trim();
  if (!result || result.length > 5000) throw new Error("Comments must contain 1–5,000 characters.");
  return result;
}

function threadData(thread: Thread): ThreadData {
  return {
    type: "thread", id: thread.id, createdAt: new Date(thread.createdAt), updatedAt: new Date(thread.createdAt),
    resolved: thread.resolved, resolvedBy: thread.resolvedBy ?? undefined, resolvedUpdatedAt: thread.resolvedAt ? new Date(thread.resolvedAt) : undefined,
    metadata: { kind: thread.kind, anchorStatus: thread.anchorStatus },
    comments: thread.messages.map<CommentData>(message => ({
      type: "comment", id: message.id, userId: message.authorId, createdAt: new Date(message.createdAt), updatedAt: new Date(message.editedAt ?? message.createdAt), reactions: [], metadata: {},
      ...(message.deleted ? { deletedAt: new Date(message.editedAt ?? message.createdAt), body: undefined } : { body: message.body.split("\n").map(text => ({ type: "paragraph", content: [{ type: "text", text, styles: {} }] })) }),
    })),
  };
}

export class ServerThreadStore extends ThreadStore {
  private api: CollabApi;
  private pageId: string;
  addThreadToDocument?: NonNullable<ThreadStore["addThreadToDocument"]>;
  rows: Thread[] = [];
  private threads = new Map<string, ThreadData>();
  private listeners = new Set<(threads: Map<string, ThreadData>) => void>();
  private loading: Promise<void> = Promise.resolve();
  getAnchor: () => Promise<Anchor> = async () => { throw new Error("Select text before commenting."); };
  onError: (error: unknown) => void = () => {};
  constructor(api: CollabApi, pageId: string, auth: CommentAuth) { super(auth); this.api = api; this.pageId = pageId; }
  reload() {
    this.loading = this.loading.catch(() => {}).then(async () => {
      const { threads } = await this.api.comments(this.pageId);
      this.rows = threads;
      this.threads = new Map(threads.map(thread => [thread.id, threadData(thread)]));
      for (const listener of this.listeners) listener(this.threads);
    });
    return this.loading;
  }
  private async write<Result>(action: () => Promise<Result>): Promise<Result> {
    try {
      const result = await action();
      await this.reload();
      if (typeof window !== "undefined") window.dispatchEvent(new Event(commentsChanged));
      return result;
    } catch (error) { this.onError(error); throw error; }
  }
  async createThread(options: Parameters<ThreadStore["createThread"]>[0]) {
    return this.write(async () => {
      if (!this.auth.canCreateThread()) throw new Error("You do not have comment access.");
      const anchor = await this.getAnchor();
      const result = await this.api.comment(this.pageId, messageBody(options.initialComment.body), anchor);
      await this.reload();
      return this.getThread(result.id);
    });
  }
  async addComment(options: Parameters<ThreadStore["addComment"]>[0]) {
    return this.write(async () => {
      const result = await this.api.reply(this.pageId, options.threadId, messageBody(options.comment.body));
      await this.reload();
      return this.getThread(options.threadId).comments.find(comment => comment.id === result.id)!;
    });
  }
  async updateComment(options: Parameters<ThreadStore["updateComment"]>[0]) {
    await this.write(() => this.api.editMessage(this.pageId, options.threadId, options.commentId, messageBody(options.comment.body)));
  }
  async deleteComment(options: Parameters<ThreadStore["deleteComment"]>[0]) {
    await this.write(() => this.api.deleteMessage(this.pageId, options.threadId, options.commentId));
  }
  async resolveThread({ threadId }: { threadId: string }) { await this.write(() => this.api.resolve(this.pageId, threadId, true)); }
  async unresolveThread({ threadId }: { threadId: string }) { await this.write(() => this.api.resolve(this.pageId, threadId, false)); }
  async deleteThread(): Promise<void> { throw new Error("Thread deletion is not supported. Delete your messages instead."); }
  async addReaction(): Promise<void> { throw new Error("Comment reactions are not supported."); }
  async deleteReaction(): Promise<void> { throw new Error("Comment reactions are not supported."); }
  getThread(threadId: string) {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error("Comment thread not found.");
    return thread;
  }
  getThreads() { return this.threads; }
  subscribe(listener: (threads: Map<string, ThreadData>) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
