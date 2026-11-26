import { pgTable, text, timestamp, boolean, primaryKey, unique, foreignKey, check, uuid, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const time = (name: string) => timestamp(name, { withTimezone: true });
export const user = pgTable("auth_users", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false), image: text("image"),
  createdAt: time("created_at").notNull().defaultNow(), updatedAt: time("updated_at").notNull().defaultNow(),
});
export const session = pgTable("auth_sessions", {
  id: text("id").primaryKey(), token: text("token").notNull().unique(), userId: text("user_id").notNull().references(() => user.id),
  expiresAt: time("expires_at").notNull(), createdAt: time("created_at").notNull().defaultNow(), updatedAt: time("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"),
});
export const account = pgTable("auth_accounts", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id), password: text("password"), accessToken: text("access_token"),
  refreshToken: text("refresh_token"), idToken: text("id_token"), scope: text("scope"),
  accessTokenExpiresAt: time("access_token_expires_at"), refreshTokenExpiresAt: time("refresh_token_expires_at"),
  createdAt: time("created_at").notNull().defaultNow(), updatedAt: time("updated_at").notNull().defaultNow(),
});
export const verification = pgTable("auth_verifications", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull().unique(), value: text("value").notNull(),
  expiresAt: time("expires_at").notNull(), createdAt: time("created_at").notNull().defaultNow(), updatedAt: time("updated_at").notNull().defaultNow(),
});
export const companies = pgTable("companies", {
  companyId: text("company_id").primaryKey(), name: text("name").notNull(), createdAt: time("created_at").notNull().defaultNow(),
});
export const memberships = pgTable("memberships", {
  companyId: text("company_id").notNull().references(() => companies.companyId), userId: text("user_id").notNull().references(() => user.id),
  role: text("role", { enum: ["admin", "editor", "viewer"] }).notNull(), status: text("status", { enum: ["active", "deactivated"] }).notNull().default("active"),
  createdAt: time("created_at").notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.companyId, table.userId] }), check("membership_role", sql`${table.role} in ('admin','editor','viewer')`), check("membership_status", sql`${table.status} in ('active','deactivated')`)]);
export const groups = pgTable("groups", {
  id: text("id").primaryKey(), companyId: text("company_id").notNull().references(() => companies.companyId), name: text("name").notNull(),
}, table => [unique().on(table.companyId, table.id), unique().on(table.companyId, table.name)]);
export const groupMembers = pgTable("group_members", {
  companyId: text("company_id").notNull(), groupId: text("group_id").notNull(), userId: text("user_id").notNull(),
}, table => [primaryKey({ columns: [table.companyId, table.groupId, table.userId] }),
  foreignKey({ columns: [table.companyId, table.groupId], foreignColumns: [groups.companyId, groups.id] }),
  foreignKey({ columns: [table.companyId, table.userId], foreignColumns: [memberships.companyId, memberships.userId] })]);
export const spaces = pgTable("spaces", {
  id: text("id").primaryKey(), companyId: text("company_id").notNull().references(() => companies.companyId), name: text("name").notNull(),
  createdBy: text("created_by").notNull(), createdAt: time("created_at").notNull().defaultNow(),
}, table => [unique().on(table.companyId, table.name), uniqueIndex("spaces_company_id_idx").on(table.companyId, table.id), foreignKey({ columns: [table.companyId, table.createdBy], foreignColumns: [memberships.companyId, memberships.userId] })]);
export const invitations = pgTable("invitations", {
  id: text("id").primaryKey(), companyId: text("company_id").notNull().references(() => companies.companyId), email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(), shareTokenHash: text("share_token_hash").unique(), shareTokenCiphertext: text("share_token_ciphertext"),
  role: text("role", { enum: ["admin", "editor", "viewer"] }).notNull().default("editor"), invitedBy: text("invited_by").notNull(), expiresAt: time("expires_at").notNull(),
  usedAt: time("used_at"), createdAt: time("created_at").notNull().defaultNow(),
}, table => [foreignKey({ columns: [table.companyId, table.invitedBy], foreignColumns: [memberships.companyId, memberships.userId] })]);
export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(), companyId: text("company_id").notNull().references(() => companies.companyId), actor: text("actor").notNull(),
  action: text("action").notNull(), target: text("target").notNull(), timestamp: time("timestamp").notNull().defaultNow(),
}, table => [foreignKey({ columns: [table.companyId, table.actor], foreignColumns: [memberships.companyId, memberships.userId] })]);
// Step 2: page tree, history, sharing and per-user page lists. `inherits = false` marks a page with explicit grants;
// a space with no rows in page_grants gives every active company member editor access.
export const pages = pgTable("pages", {
  id: uuid("id").primaryKey(), companyId: text("company_id").notNull().references(() => companies.companyId), spaceId: text("space_id"),
  parentId: uuid("parent_id"), ownerId: text("owner_id").notNull(), title: text("title").notNull().default(""), slug: text("slug").notNull(),
  position: integer("position").notNull().default(0), inherits: boolean("inherits").notNull().default(true),
  content: jsonb("content").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`), revision: integer("revision").notNull().default(1),
  archivedAt: time("archived_at"), archivedRootId: uuid("archived_root_id"),
  createdAt: time("created_at").notNull().defaultNow(), updatedAt: time("updated_at").notNull().defaultNow(),
  // Step 3 part B (migration 0004): plain text for search (null = not computed yet) and review state.
  searchText: text("search_text"), reviewIntervalDays: integer("review_interval_days"),
  lastReviewedAt: time("last_reviewed_at"), lastReviewedBy: text("last_reviewed_by"),
}, table => [unique().on(table.companyId, table.id), unique().on(table.companyId, table.slug),
  check("pages_revision", sql`${table.revision} >= 1`), check("pages_not_own_parent", sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`),
  check("pages_archive_pair", sql`(${table.archivedAt} is null) = (${table.archivedRootId} is null)`),
  foreignKey({ columns: [table.companyId, table.spaceId], foreignColumns: [spaces.companyId, spaces.id] }),
  foreignKey({ columns: [table.companyId, table.parentId], foreignColumns: [table.companyId, table.id] }),
  foreignKey({ columns: [table.companyId, table.archivedRootId], foreignColumns: [table.companyId, table.id] }),
  foreignKey({ columns: [table.companyId, table.ownerId], foreignColumns: [memberships.companyId, memberships.userId] }),
  index("pages_tree_idx").on(table.companyId, table.parentId, table.position), index("pages_space_idx").on(table.companyId, table.spaceId),
  index("pages_archived_idx").on(table.companyId, table.archivedRootId)]);
export const pageRevisions = pgTable("page_revisions", {
  companyId: text("company_id").notNull().references(() => companies.companyId), pageId: uuid("page_id").notNull(), revision: integer("revision").notNull(),
  content: jsonb("content").$type<unknown[]>().notNull(), authorId: text("author_id").notNull(), createdAt: time("created_at").notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.companyId, table.pageId, table.revision] }),
  foreignKey({ columns: [table.companyId, table.pageId], foreignColumns: [pages.companyId, pages.id] }).onDelete("cascade"),
  foreignKey({ columns: [table.companyId, table.authorId], foreignColumns: [memberships.companyId, memberships.userId] })]);
export const publicPageSnapshots = pgTable("public_page_snapshots", {
  companyId: text("company_id").notNull(), pageId: uuid("page_id").notNull(), tokenHash: text("token_hash").notNull().unique(),
  title: text("title").notNull(), slug: text("slug").notNull(), content: jsonb("content").$type<unknown[]>().notNull(),
  revision: integer("revision").notNull(), createdAt: time("created_at").notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.companyId, table.pageId] }), check("public_page_snapshot_revision", sql`${table.revision} >= 1`),
  foreignKey({ columns: [table.companyId, table.pageId], foreignColumns: [pages.companyId, pages.id] }).onDelete("cascade")]);
export const pageGrants = pgTable("page_grants", {
  id: uuid("id").primaryKey(), companyId: text("company_id").notNull().references(() => companies.companyId), pageId: uuid("page_id"), spaceId: text("space_id"),
  principalType: text("principal_type", { enum: ["user", "group"] }).notNull(), principalId: text("principal_id").notNull(),
  role: text("role", { enum: ["editor", "commenter", "viewer"] }).notNull(), createdAt: time("created_at").notNull().defaultNow(),
}, table => [check("page_grants_principal_type", sql`${table.principalType} in ('user','group')`),
  check("page_grants_role", sql`${table.role} in ('editor','commenter','viewer')`), check("page_grants_one_target", sql`(${table.pageId} is null) <> (${table.spaceId} is null)`),
  foreignKey({ columns: [table.companyId, table.pageId], foreignColumns: [pages.companyId, pages.id] }).onDelete("cascade"),
  foreignKey({ columns: [table.companyId, table.spaceId], foreignColumns: [spaces.companyId, spaces.id] }).onDelete("cascade"),
  uniqueIndex("page_grants_page_principal_idx").on(table.companyId, table.pageId, table.principalType, table.principalId).where(sql`${table.pageId} is not null`),
  uniqueIndex("page_grants_space_principal_idx").on(table.companyId, table.spaceId, table.principalType, table.principalId).where(sql`${table.spaceId} is not null`),
  index("page_grants_principal_idx").on(table.companyId, table.principalType, table.principalId)]);
export const pageFavorites = pgTable("page_favorites", {
  companyId: text("company_id").notNull().references(() => companies.companyId), userId: text("user_id").notNull(), pageId: uuid("page_id").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.companyId, table.userId, table.pageId] }),
  foreignKey({ columns: [table.companyId, table.userId], foreignColumns: [memberships.companyId, memberships.userId] }),
  foreignKey({ columns: [table.companyId, table.pageId], foreignColumns: [pages.companyId, pages.id] }).onDelete("cascade")]);
export const pageVisits = pgTable("page_visits", {
  companyId: text("company_id").notNull().references(() => companies.companyId), userId: text("user_id").notNull(), pageId: uuid("page_id").notNull(),
  visitedAt: time("visited_at").notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.companyId, table.userId, table.pageId] }),
  foreignKey({ columns: [table.companyId, table.userId], foreignColumns: [memberships.companyId, memberships.userId] }),
  foreignKey({ columns: [table.companyId, table.pageId], foreignColumns: [pages.companyId, pages.id] }).onDelete("cascade"),
  index("page_visits_user_idx").on(table.companyId, table.userId, table.visitedAt)]);
// storage_key names a private server-side object; it is never exposed as a public URL.
export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey(), companyId: text("company_id").notNull().references(() => companies.companyId), pageId: uuid("page_id").notNull(),
  uploaderId: text("uploader_id").notNull(), filename: text("filename").notNull(), mimeType: text("mime_type").notNull(), size: integer("size").notNull(),
  storageKey: text("storage_key").notNull().unique(), createdAt: time("created_at").notNull().defaultNow(),
}, table => [check("attachments_size", sql`${table.size} >= 0`),
  foreignKey({ columns: [table.companyId, table.pageId], foreignColumns: [pages.companyId, pages.id] }).onDelete("cascade"),
  foreignKey({ columns: [table.companyId, table.uploaderId], foreignColumns: [memberships.companyId, memberships.userId] }),
  index("attachments_page_idx").on(table.companyId, table.pageId)]);
// Step 3: comments, page activity and in-app notifications (migration 0003).
export type CommentAnchor = { blockId: string; quote: string; prefix: string; suffix: string; from?: number; to?: number; sourceText?: string };
export const commentThreads = pgTable("comment_threads", {
  id: uuid("id").primaryKey(), companyId: text("company_id").notNull().references(() => companies.companyId), pageId: uuid("page_id").notNull(),
  kind: text("kind", { enum: ["page", "inline"] }).notNull(), anchor: jsonb("anchor").$type<CommentAnchor>(),
  anchorStatus: text("anchor_status", { enum: ["attached", "detached"] }), anchorBlockId: text("anchor_block_id"),
  createdBy: text("created_by").notNull(), createdAt: time("created_at").notNull().defaultNow(), updatedAt: time("updated_at").notNull().defaultNow(),
  resolvedAt: time("resolved_at"), resolvedBy: text("resolved_by"),
}, table => [unique().on(table.companyId, table.id), check("comment_threads_kind", sql`${table.kind} in ('page','inline')`),
  check("comment_threads_anchor", sql`(${table.kind} = 'inline') = (${table.anchor} is not null)`),
  foreignKey({ columns: [table.companyId, table.pageId], foreignColumns: [pages.companyId, pages.id] }).onDelete("cascade"),
  foreignKey({ columns: [table.companyId, table.createdBy], foreignColumns: [memberships.companyId, memberships.userId] }),
  foreignKey({ columns: [table.companyId, table.resolvedBy], foreignColumns: [memberships.companyId, memberships.userId] }),
  index("comment_threads_page_idx").on(table.companyId, table.pageId, table.createdAt)]);
export const commentMessages = pgTable("comment_messages", {
  id: uuid("id").primaryKey(), companyId: text("company_id").notNull().references(() => companies.companyId), threadId: uuid("thread_id").notNull(),
  authorId: text("author_id").notNull(), body: text("body").notNull(), mentions: jsonb("mentions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: time("created_at").notNull().defaultNow(), editedAt: time("edited_at"), deletedAt: time("deleted_at"),
}, table => [check("comment_messages_body", sql`length(${table.body}) <= 5000`),
  foreignKey({ columns: [table.companyId, table.threadId], foreignColumns: [commentThreads.companyId, commentThreads.id] }).onDelete("cascade"),
  foreignKey({ columns: [table.companyId, table.authorId], foreignColumns: [memberships.companyId, memberships.userId] }),
  index("comment_messages_thread_idx").on(table.companyId, table.threadId, table.createdAt)]);
export const activityActions = ["created", "renamed", "edited", "moved", "archived", "restored", "restored_revision", "commented", "resolved", "reopened", "access_changed", "reviewed", "verified"] as const;
export const pageActivity = pgTable("page_activity", {
  id: uuid("id").primaryKey(), companyId: text("company_id").notNull().references(() => companies.companyId), pageId: uuid("page_id").notNull(),
  actorId: text("actor_id").notNull(), action: text("action", { enum: activityActions }).notNull(), detail: text("detail"), count: integer("count").notNull().default(1),
  createdAt: time("created_at").notNull().defaultNow(), updatedAt: time("updated_at").notNull().defaultNow(),
}, table => [foreignKey({ columns: [table.companyId, table.pageId], foreignColumns: [pages.companyId, pages.id] }).onDelete("cascade"),
  foreignKey({ columns: [table.companyId, table.actorId], foreignColumns: [memberships.companyId, memberships.userId] }),
  index("page_activity_page_idx").on(table.companyId, table.pageId, table.updatedAt)]);
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey(), companyId: text("company_id").notNull().references(() => companies.companyId), recipientId: text("recipient_id").notNull(),
  kind: text("kind", { enum: ["mention", "comment", "access", "review_due"] }).notNull(), pageId: uuid("page_id"), actorId: text("actor_id"), threadId: uuid("thread_id"),
  dedupeKey: text("dedupe_key"), emailStatus: text("email_status", { enum: ["not_applicable", "pending", "sending", "sent", "failed", "unavailable"] }).notNull().default("not_applicable"),
  emailError: text("email_error"), emailAttempts: integer("email_attempts").notNull().default(0), emailAttemptedAt: time("email_attempted_at"),
  createdAt: time("created_at").notNull().defaultNow(), readAt: time("read_at"),
}, table => [foreignKey({ columns: [table.companyId, table.recipientId], foreignColumns: [memberships.companyId, memberships.userId] }),
  foreignKey({ columns: [table.companyId, table.pageId], foreignColumns: [pages.companyId, pages.id] }).onDelete("cascade"),
  foreignKey({ columns: [table.companyId, table.actorId], foreignColumns: [memberships.companyId, memberships.userId] }),
  index("notifications_recipient_idx").on(table.companyId, table.recipientId, table.createdAt),
  uniqueIndex("notifications_dedupe_idx").on(table.companyId, table.recipientId, table.dedupeKey).where(sql`${table.dedupeKey} is not null`)]);
// Step 3 part B: tags (lowercase, up to 40 characters) and internal links extracted from page content on save.
export const pageTags = pgTable("page_tags", {
  companyId: text("company_id").notNull().references(() => companies.companyId), pageId: uuid("page_id").notNull(), tag: text("tag").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.companyId, table.pageId, table.tag] }),
  check("page_tags_tag", sql`length(${table.tag}) between 1 and 40 and ${table.tag} = lower(${table.tag})`),
  foreignKey({ columns: [table.companyId, table.pageId], foreignColumns: [pages.companyId, pages.id] }).onDelete("cascade"),
  index("page_tags_tag_idx").on(table.companyId, table.tag)]);
export const pageLinks = pgTable("page_links", {
  companyId: text("company_id").notNull().references(() => companies.companyId), sourceId: uuid("source_id").notNull(), targetId: uuid("target_id").notNull(),
}, table => [primaryKey({ columns: [table.companyId, table.sourceId, table.targetId] }), check("page_links_not_self", sql`${table.sourceId} <> ${table.targetId}`),
  foreignKey({ columns: [table.companyId, table.sourceId], foreignColumns: [pages.companyId, pages.id] }).onDelete("cascade"),
  foreignKey({ columns: [table.companyId, table.targetId], foreignColumns: [pages.companyId, pages.id] }).onDelete("cascade"),
  index("page_links_target_idx").on(table.companyId, table.targetId)]);

// Private bounded upload bytes live with their metadata in the managed database.
// A transaction commits both, and normal database backup/restore includes both.
export const attachmentContents = pgTable("attachment_contents", {
  attachmentId: uuid("attachment_id").primaryKey().references(() => attachments.id, { onDelete: "cascade" }),
  bodyBase64: text("body_base64").notNull(),
});
