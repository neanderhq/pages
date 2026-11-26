import type { WorkspaceRole } from "./api";
import type { PageRole } from "./pagesApi";

export type TreeAction = "open" | "share" | "subpage" | "rename" | "duplicate" | "move" | "up" | "down" | "archive";

export function visiblePageTreeActions(role: PageRole): TreeAction[] {
  return role === "editor" ? ["open", "share", "subpage", "rename", "duplicate", "move", "up", "down", "archive"] : ["open", "share"];
}

export function canManageWorkspacePages(role: WorkspaceRole | undefined) {
  return role === "admin" || role === "editor";
}

export function canReviewPage(role: PageRole, workspaceRole: WorkspaceRole | undefined, isOwner: boolean) {
  return canManageWorkspacePages(workspaceRole) && (role === "editor" || isOwner);
}
