export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
// Identifiers occupy one path segment, never a route, query or fragment.
export function apiPathSegment(value: string): string {
  if (value === "." || value === "..") throw new ApiError("Invalid resource identifier.", 400);
  return encodeURIComponent(value);
}
export async function api<Type>(path: string, method = "GET", body?: unknown): Promise<Type> {
  let response: Response;
  try { response = await fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new ApiError("Could not reach the workspace server. Please try again.", 0); }
  let data: any;
  try { data = await response.json(); }
  catch { throw new ApiError("The workspace server returned an unexpected response. Please try again.", response.status); }
  if (!response.ok) throw new ApiError(data.message || "The request could not be completed.", response.status);
  return data as Type;
}
export type WorkspaceRole = "admin" | "editor" | "viewer";
export type Identity = { user: { id: string; name: string; email: string }; companies: { companyId: string; name: string; role: WorkspaceRole }[] };
export type Member = { userId: string; name: string; email: string; role: WorkspaceRole; status: "active" | "deactivated" };
export type Workspace = {
  company: { companyId: string; name: string };
  membership: { role: WorkspaceRole };
  members: Member[];
  groups: { id: string; name: string }[];
  groupMembers: { groupId: string; userId: string }[];
  spaces: { id: string; name: string; createdBy: string; createdAt: string }[];
  invitations: { id: string; email: string; expiresAt: string; usedAt: string | null; role: WorkspaceRole }[];
};
