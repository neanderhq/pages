import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type WorkspaceRole = "admin" | "editor" | "viewer";

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return value === "admin" || value === "editor" || value === "viewer";
}

export function encryptInvitationToken(token: string, secret: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), nonce);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `${nonce.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${ciphertext.toString("hex")}`;
}

export function decryptInvitationToken(value: string, secret: string) {
  const [nonce, tag, ciphertext] = value.split(".");
  if (!nonce || !tag || !ciphertext) throw new Error("Invitation link is unavailable.");
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), Buffer.from(nonce, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "hex")), decipher.final()]).toString("utf8");
}
