import { api, apiPathSegment, ApiError } from "./api";

// Typed client for the Step 2 page routes in server/pages.ts. The server decides access; these helpers only shape requests.
export type PageRole = "editor" | "commenter" | "viewer";
export type Block = Record<string, unknown>;
export type TreePage = { id: string; parentId: string | null; spaceId: string | null; title: string; slug: string; position: number; inherits: boolean; updatedAt: string; role: PageRole };
export type PageLink = { id: string; title: string; spaceId: string | null };
export type PageDetail = {
  id: string; title: string; slug: string; spaceId: string | null; parentId: string | null; ownerId: string;
  content: Block[]; revision: number; inherits: boolean; updatedAt: string; role: PageRole; favorite: boolean;
  tags?: string[]; review?: Review;
};
export type Review = {
  ownerId: string; ownerName: string; reviewIntervalDays: number | null; lastReviewedAt: string | null;
  lastReviewedBy: string | null; lastReviewedByName: string | null; state: "verified" | "stale" | "unreviewed"; dueAt: string | null;
};
export type Conflict = { message: string; current: { revision: number; content: Block[] }; yours: { baseRevision: number; content: Block[] } };
export type ArchivedPage = { id: string; title: string; spaceId: string | null; archivedAt: string };
export type PageTemplate = { id: string; name: string; description: string; title: string };

export class ConflictError extends Error {
  conflict: Conflict;
  constructor(conflict: Conflict) { super(conflict.message); this.conflict = conflict; }
}

export function pagesApi(companyId: string) {
  const base = `/api/companies/${apiPathSegment(companyId)}`;
  return {
    tree: () => api<{ pages: TreePage[] }>(`${base}/pages`),
    favorites: () => api<{ pages: PageLink[] }>(`${base}/favorites`),
    recent: () => api<{ pages: PageLink[] }>(`${base}/recent`),
    archived: () => api<{ pages: ArchivedPage[] }>(`${base}/pages/archived`),
    page: (id: string) => api<{ page: PageDetail; breadcrumbs: { id: string; title: string }[] }>(`${base}/pages/${apiPathSegment(id)}`),
    publicSnapshotStatus: (id: string) => api<{ published: boolean }>(`${base}/pages/${apiPathSegment(id)}/public-snapshot`),
    publishSnapshot: (id: string) => api<{ published: true; url: string }>(`${base}/pages/${apiPathSegment(id)}/public-snapshot`, "POST", {}),
    revokeSnapshot: (id: string) => api<{ ok: true; published: false }>(`${base}/pages/${apiPathSegment(id)}/public-snapshot`, "DELETE", {}),
    templates: () => api<{ templates: PageTemplate[] }>(`${base}/templates`),
    create: (body: { title?: string; parentId?: string | null; spaceId?: string | null; templateId?: string }) => api<{ id: string; slug: string }>(`${base}/pages`, "POST", body),
    importMarkdown: (spaceId: string | null, files: { path: string; content: string }[]) => api<{ imported: number; pages: { id: string; title: string; path: string }[] }>(`${base}/pages/import-markdown`, "POST", { spaceId, files }),
    async exportMarkdown(id: string) {
      let response: Response;
      try { response = await fetch(`${base}/pages/${apiPathSegment(id)}/export-markdown`, { credentials: "same-origin" }); }
      catch { throw new ApiError("Could not reach the workspace server. Please try again.", 0); }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError(data.message || "Markdown export failed.", response.status);
      }
      return response.blob();
    },
    rename: (id: string, title: string) => api<{ ok: true; title: string }>(`${base}/pages/${apiPathSegment(id)}`, "PATCH", { title }),
    duplicate: (id: string) => api<{ id: string; count: number }>(`${base}/pages/${apiPathSegment(id)}/duplicate`, "POST", {}),
    access: (target: SharingTarget) => api<AccessSummary>(`${base}/${target.kind === "page" ? "pages" : "spaces"}/${apiPathSegment(target.id)}/grants`),
    saveAccess: (target: SharingTarget, body: { inherits: boolean; grants: Grant[]; confirmSelfLockout: boolean }) => api<{ ok: true }>(`${base}/${target.kind === "page" ? "pages" : "spaces"}/${apiPathSegment(target.id)}/grants`, "PUT", body),
    moveImpact: (id: string, body: { parentId: string | null; spaceId: string | null }) => api<{ changed: boolean; token: string }>(`${base}/pages/${apiPathSegment(id)}/move-impact`, "POST", body),
    move: (id: string, body: { parentId: string | null; spaceId?: string | null; beforeId?: string; accessAcknowledgement?: string }) => api<{ ok: true }>(`${base}/pages/${apiPathSegment(id)}/move`, "POST", body),
    archive: (id: string) => api<{ ok: true }>(`${base}/pages/${apiPathSegment(id)}/archive`, "POST", {}),
    restore: (id: string) => api<{ id: string }>(`${base}/pages/${apiPathSegment(id)}/restore`, "POST", {}),
    favorite: (id: string, on: boolean) => api<{ ok: true }>(`${base}/favorites/${apiPathSegment(id)}`, on ? "PUT" : "DELETE", {}),
    // Autosave: a 409 becomes a ConflictError carrying both versions so the editor never overwrites silently.
    async save(id: string, content: Block[], baseRevision: number) {
      const response = await fetch(`${base}/pages/${apiPathSegment(id)}/content`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, baseRevision }) })
        .catch(() => { throw new ApiError("You seem to be offline. Your changes are kept here.", 0); });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.current) throw new ConflictError(data as Conflict);
      if (!response.ok) throw new ApiError(data.message || "Your changes could not be saved.", response.status);
      return data as { revision: number; content: Block[] };
    },
    // Uploads go to the authorized attachment route; the returned URL only works for people who can view the page.
    async upload(id: string, file: File) {
      const response = await fetch(`${base}/pages/${apiPathSegment(id)}/attachments`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) }, body: file })
        .catch(() => { throw new ApiError("The file could not be uploaded. Check your connection and try again.", 0); });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError(data.message || "The file could not be uploaded.", response.status);
      return data as { id: string; url: string; filename: string; mimeType: string; size: number };
    },
  };
}
export type PagesApi = ReturnType<typeof pagesApi>;
export type Grant = { principalType: "user" | "group"; principalId: string; role: PageRole; name?: string };
export type AccessSummary = {
  workspaceRole?: "admin" | "editor" | "viewer";
  inherits: boolean; role: PageRole | null; canManage: boolean; grants: Grant[]; workspaceAccess?: boolean;
  inherited?: { source: string; grants: Grant[]; entriesVisible: boolean; workspaceAccess: boolean };
};
export type SharingTarget = { kind: "page" | "space"; id: string; name: string };
