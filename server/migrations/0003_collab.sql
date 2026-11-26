CREATE TABLE IF NOT EXISTS comment_threads (
 id uuid PRIMARY KEY, company_id text NOT NULL REFERENCES companies(company_id), page_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('page','inline')), anchor jsonb,
 anchor_status text CHECK(anchor_status IN ('attached','detached')), anchor_block_id text,
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz, resolved_by text,
 UNIQUE(company_id,id), CHECK((kind = 'inline') = (anchor IS NOT NULL)),
 FOREIGN KEY(company_id,page_id) REFERENCES pages(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,created_by) REFERENCES memberships(company_id,user_id),
 FOREIGN KEY(company_id,resolved_by) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX IF NOT EXISTS comment_threads_page_idx ON comment_threads(company_id,page_id,created_at);
CREATE TABLE IF NOT EXISTS comment_messages (
 id uuid PRIMARY KEY, company_id text NOT NULL REFERENCES companies(company_id), thread_id uuid NOT NULL,
 author_id text NOT NULL, body text NOT NULL, mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), edited_at timestamptz, deleted_at timestamptz,
 CHECK(length(body) <= 5000),
 FOREIGN KEY(company_id,thread_id) REFERENCES comment_threads(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,author_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX IF NOT EXISTS comment_messages_thread_idx ON comment_messages(company_id,thread_id,created_at);
CREATE TABLE IF NOT EXISTS page_activity (
 id uuid PRIMARY KEY, company_id text NOT NULL REFERENCES companies(company_id), page_id uuid NOT NULL, actor_id text NOT NULL,
 action text NOT NULL CHECK(action IN ('created','renamed','edited','moved','archived','restored','restored_revision','commented','resolved','reopened','access_changed','reviewed','verified')),
 detail text, count integer NOT NULL DEFAULT 1 CHECK(count >= 1),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,page_id) REFERENCES pages(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,actor_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX IF NOT EXISTS page_activity_page_idx ON page_activity(company_id,page_id,updated_at);
CREATE TABLE IF NOT EXISTS notifications (
 id uuid PRIMARY KEY, company_id text NOT NULL REFERENCES companies(company_id), recipient_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('mention','comment','access','review_due')), page_id uuid, actor_id text, thread_id uuid,
 dedupe_key text, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
 FOREIGN KEY(company_id,recipient_id) REFERENCES memberships(company_id,user_id),
 FOREIGN KEY(company_id,page_id) REFERENCES pages(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,actor_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(company_id,recipient_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx ON notifications(company_id,recipient_id,dedupe_key) WHERE dedupe_key IS NOT NULL;
