import type { Workspace } from "./api.ts";
import type { Grant } from "./pagesApi.ts";

export function sharingPrincipals(members: Workspace["members"], groups: Workspace["groups"]) {
  return [
    ...members.filter(member => member.status === "active").map(member => ({ key: `user:${member.userId}`, type: "user" as const, id: member.userId, name: `${member.name} (${member.email})${member.role === "admin" ? " — admin (permanent edit access)" : ""}` })),
    ...groups.map(group => ({ key: `group:${group.id}`, type: "group" as const, id: group.id, name: `Group: ${group.name}` })),
  ];
}

export function availablePrincipals(principals: ReturnType<typeof sharingPrincipals>, grants: Grant[]) {
  return principals.filter(entry => !grants.some(grant => grant.principalType === entry.type && grant.principalId === entry.id));
}

export function moveNeedsReview(impact: { changed: boolean; token: string }, preview: { token: string } | null, acknowledged: boolean) {
  return impact.changed && (!acknowledged || preview?.token !== impact.token);
}

export function emptyGrantMessage(kind: "page" | "space") {
  return kind === "page" ? "An empty explicit page list excludes everyone except active workspace administrators. Non-admin editors may not be able to undo this." : "An empty space list means workspace access, not private access.";
}
