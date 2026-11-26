import { api, apiPathSegment } from "./api.ts";
import type { Block, Review } from "./pagesApi";

export const commentsChanged = "wiki-comments-changed";
export const tagsChanged = "wiki-tags-changed";

// Typed client for the Step 3 page routes (comments, history, activity, review, backlinks, search).
// The server decides who may do what; these helpers only shape requests.
export type Anchor = { blockId: string; quote: string; prefix: string; suffix: string; from?: number; to?: number; sourceText?: string };
export type CommentMessage = { id: string; authorId: string; authorName: string; createdAt: string; editedAt: string | null; deleted: boolean; body: string; mentions: { userId: string; name: string }[] };
export type MentionMember = { userId: string; name: string; email: string };
export type MentionSuggestionKeyDisposition = "select" | "submit" | "ignore";
export function mentionSuggestionKeyDisposition(key: string, hasOpenSuggestions: boolean): MentionSuggestionKeyDisposition {
  if (hasOpenSuggestions && (key === "Enter" || key === "Tab")) return "select";
  if (!hasOpenSuggestions && key === "Enter") return "submit";
  return "ignore";
}
export function isInsideMentionPickerOrComposer<T>(path: readonly T[], target: T | null, picker: T, composer: T | null, contains: (container: T, target: T) => boolean) {
  return [picker, composer].some(surface => surface !== null && (path.includes(surface) || (target !== null && contains(surface, target))));
}
export type MentionAnchorRect = Pick<DOMRect, "left" | "right" | "top" | "bottom">;
export type MentionViewport = { width: number; height: number; offsetLeft?: number; offsetTop?: number; layoutWidth: number; layoutHeight: number };
export type MentionPopoverPlacement = { side: "below"; left: number; width: number; maxHeight: number; top: number } | { side: "above"; left: number; width: number; maxHeight: number; bottom: number };
export function mentionPopoverPlacement(anchor: MentionAnchorRect, viewport: MentionViewport, desiredMaxHeight = 240, gap = 4, margin = 8): MentionPopoverPlacement {
  const viewportLeft = Math.max(0, viewport.offsetLeft ?? 0) + margin;
  const viewportRight = Math.min(viewport.layoutWidth, (viewport.offsetLeft ?? 0) + viewport.width) - margin;
  const viewportTop = Math.max(0, viewport.offsetTop ?? 0) + margin;
  const viewportBottom = Math.min(viewport.layoutHeight, (viewport.offsetTop ?? 0) + viewport.height) - margin;
  const belowTop = Math.max(viewportTop, anchor.bottom + gap);
  const aboveBottom = Math.min(viewportBottom, anchor.top - gap);
  const belowSpace = Math.max(0, viewportBottom - belowTop);
  const aboveSpace = Math.max(0, aboveBottom - viewportTop);
  const side: "below" | "above" = belowSpace >= desiredMaxHeight || belowSpace >= aboveSpace ? "below" : "above";
  const maxHeight = Math.max(0, Math.min(desiredMaxHeight, side === "below" ? belowSpace : aboveSpace));
  const width = Math.max(0, Math.min(anchor.right - anchor.left, viewportRight - viewportLeft));
  const left = Math.max(viewportLeft, Math.min(anchor.left, viewportRight - width));
  if (side === "below") return { side, left, width, maxHeight, top: belowTop };
  return { side, left, width, maxHeight, bottom: viewport.layoutHeight - aboveBottom };
}
export function mentionQueryAt(value: string, caret: number) {
  const beforeCaret = value.slice(0, caret);
  const match = /(?:^|[^\w@.])@([^\s]*)$/u.exec(beforeCaret);
  if (!match) return null;
  return { start: caret - match[1].length - 1, end: caret, query: match[1] };
}
export function insertMentionToken(value: string, caret: number, email: string) {
  const query = mentionQueryAt(value, caret);
  if (!query) return { value, caret };
  const token = `@${email}`;
  return { value: `${value.slice(0, query.start)}${token}${value.slice(query.end)}`, caret: query.start + token.length };
}
export type Thread = {
  id: string; kind: "page" | "inline"; anchor: Anchor | null; anchorStatus: "attached" | "detached" | null; anchorBlockId: string | null;
  createdBy: string; createdByName: string; createdAt: string; resolved: boolean; resolvedAt: string | null; resolvedBy: string | null; resolvedByName: string | null;
  messages: CommentMessage[];
  placement?: { blockId: string; from: number; to: number } | null;
};
export type RevisionRow = { revision: number; authorId: string; authorName: string; createdAt: string };
export type ActivityRow = { id: string; action: string; detail: string | null; count: number; actorId: string; actorName: string; createdAt: string; updatedAt: string };
export type LinkedPage = { id: string; title: string; slug: string; spaceId: string | null };
export type SearchResult = LinkedPage & { spaceName: string | null; ownerId: string; ownerName: string; updatedAt: string; tags: string[]; snippet: string };
export type Notification = { id: string; kind: "mention" | "comment" | "access" | "review_due"; pageId: string | null; pageTitle: string | null; threadId: string | null; actorId: string | null; actorName: string | null; createdAt: string; readAt: string | null; emailStatus: "not_applicable" | "pending" | "sending" | "sent" | "failed" | "unavailable"; emailError: string | null };
export type ReviewDuePage = LinkedPage & { ownerId: string; ownerName: string; reviewIntervalDays: number | null; lastReviewedAt: string | null; state: "stale"; dueAt: string };
export type SearchFilters = { q?: string; ownerId?: string; spaceId?: string; tag?: string; updatedAfter?: string; updatedBefore?: string };
export type AuditEvent = { id: string; actorId: string; actorName: string; action: string; target: string; targetLabel: string | null; timestamp: string };

export function collabApi(companyId: string) {
  const base = `/api/companies/${apiPathSegment(companyId)}`;
  const page = (id: string) => `${base}/pages/${apiPathSegment(id)}`;
  const thread = (id: string, threadId: string) => `${page(id)}/comments/${apiPathSegment(threadId)}`;
  return {
    comments: (id: string) => api<{ threads: Thread[] }>(`${page(id)}/comments`),
    mentionMembers: (id: string, query: string, limit = 8) => api<{ members: MentionMember[] }>(`${page(id)}/comments/mentions?q=${encodeURIComponent(query)}&limit=${limit}`),
    comment: (id: string, body: string, anchor?: Anchor) => api<{ id: string; anchorStatus: string | null }>(`${page(id)}/comments`, "POST", anchor ? { body, kind: "inline", anchor } : { body }),
    reply: (id: string, threadId: string, body: string) => api<{ id: string }>(`${thread(id, threadId)}/replies`, "POST", { body }),
    resolve: (id: string, threadId: string, resolved: boolean) => api<{ ok: true }>(`${thread(id, threadId)}/${resolved ? "resolve" : "reopen"}`, "POST", {}),
    editMessage: (id: string, threadId: string, messageId: string, body: string) => api<{ ok: true }>(`${thread(id, threadId)}/messages/${apiPathSegment(messageId)}`, "PATCH", { body }),
    deleteMessage: (id: string, threadId: string, messageId: string) => api<{ ok: true }>(`${thread(id, threadId)}/messages/${apiPathSegment(messageId)}`, "DELETE", {}),
    revisions: (id: string) => api<{ revisions: RevisionRow[] }>(`${page(id)}/revisions`),
    revision: (id: string, n: number) => api<{ revision: { revision: number; content: Block[]; authorId: string; createdAt: string } }>(`${page(id)}/revisions/${n}`),
    restoreRevision: (id: string, n: number) => api<{ revision: number; restoredFrom: number; content: Block[] }>(`${page(id)}/revisions/${n}/restore`, "POST", {}),
    activity: (id: string) => api<{ activity: ActivityRow[] }>(`${page(id)}/activity`),
    review: (id: string) => api<{ review: Review }>(`${page(id)}/review`),
    updateReview: (id: string, body: { ownerId?: string; reviewIntervalDays?: number | null }) => api<{ review: Review }>(`${page(id)}/review`, "PATCH", body),
    markReviewed: (id: string) => api<{ review: Review }>(`${page(id)}/review`, "POST", {}),
    backlinks: (id: string) => api<{ pages: LinkedPage[] }>(`${page(id)}/backlinks`),
    pageTags: (id: string) => api<{ tags: string[] }>(`${page(id)}/tags`),
    updateTags: (id: string, tags: string[]) => api<{ tags: string[] }>(`${page(id)}/tags`, "PUT", { tags }),
    search: (filters: SearchFilters, limit = 50) => {
      const params = new URLSearchParams({ limit: String(limit) });
      for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
      return api<{ results: SearchResult[]; total: number }>(`${base}/search?${params}`);
    },
    tags: () => api<{ tags: { tag: string; count: number }[] }>(`${base}/tags`),
    reviewDue: (mine = false) => api<{ pages: ReviewDuePage[] }>(`${base}/review-due${mine ? "?mine=1" : ""}`),
    notifications: () => api<{ notifications: Notification[]; unread: number }>(`${base}/notifications`),
    auditLog: (offset = 0, limit = 25) => api<{ events: AuditEvent[]; total: number; limit: number; offset: number }>(`${base}/audit-log?${new URLSearchParams({ offset: String(offset), limit: String(limit) })}`),
    retryNotificationEmail: (id: string) => api<{ ok: boolean; emailStatus: Notification["emailStatus"]; emailError: string | null }>(`${base}/notifications/${apiPathSegment(id)}/retry-email`, "POST", {}),
    markNotificationRead: (id: string) => api<{ ok: true }>(`${base}/notifications/${apiPathSegment(id)}/read`, "POST", {}),
    markAllNotificationsRead: () => api<{ ok: true; unread: number }>(`${base}/notifications/read-all`, "POST", {}),
  };
}
export type CollabApi = ReturnType<typeof collabApi>;

// Short, friendly date and time for lists.
export function when(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
