CREATE UNIQUE INDEX IF NOT EXISTS spaces_company_id_idx ON spaces(company_id,id);
CREATE TABLE IF NOT EXISTS pages (
 id uuid PRIMARY KEY, company_id text NOT NULL REFERENCES companies(company_id), space_id text, parent_id uuid, owner_id text NOT NULL,
 title text NOT NULL DEFAULT '', slug text NOT NULL, position integer NOT NULL DEFAULT 0, inherits boolean NOT NULL DEFAULT true,
 content jsonb NOT NULL DEFAULT '[]'::jsonb, revision integer NOT NULL DEFAULT 1 CHECK(revision >= 1),
 archived_at timestamptz, archived_root_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id), UNIQUE(company_id,slug), CHECK(parent_id IS NULL OR parent_id <> id),
 CHECK((archived_at IS NULL) = (archived_root_id IS NULL)),
 FOREIGN KEY(company_id,space_id) REFERENCES spaces(company_id,id),
 FOREIGN KEY(company_id,parent_id) REFERENCES pages(company_id,id),
 FOREIGN KEY(company_id,archived_root_id) REFERENCES pages(company_id,id),
 FOREIGN KEY(company_id,owner_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX IF NOT EXISTS pages_tree_idx ON pages(company_id,parent_id,position);
CREATE INDEX IF NOT EXISTS pages_space_idx ON pages(company_id,space_id);
CREATE INDEX IF NOT EXISTS pages_archived_idx ON pages(company_id,archived_root_id);
CREATE TABLE IF NOT EXISTS page_revisions (
 company_id text NOT NULL REFERENCES companies(company_id), page_id uuid NOT NULL, revision integer NOT NULL, content jsonb NOT NULL,
 author_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,page_id,revision),
 FOREIGN KEY(company_id,page_id) REFERENCES pages(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,author_id) REFERENCES memberships(company_id,user_id)
);
CREATE TABLE IF NOT EXISTS page_grants (
 id uuid PRIMARY KEY, company_id text NOT NULL REFERENCES companies(company_id), page_id uuid, space_id text,
 principal_type text NOT NULL CHECK(principal_type IN ('user','group')), principal_id text NOT NULL,
 role text NOT NULL CHECK(role IN ('editor','commenter','viewer')), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((page_id IS NULL) <> (space_id IS NULL)),
 FOREIGN KEY(company_id,page_id) REFERENCES pages(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,space_id) REFERENCES spaces(company_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS page_grants_page_principal_idx ON page_grants(company_id,page_id,principal_type,principal_id) WHERE page_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS page_grants_space_principal_idx ON page_grants(company_id,space_id,principal_type,principal_id) WHERE space_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS page_grants_principal_idx ON page_grants(company_id,principal_type,principal_id);
CREATE TABLE IF NOT EXISTS page_favorites (
 company_id text NOT NULL REFERENCES companies(company_id), user_id text NOT NULL, page_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,user_id,page_id),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id),
 FOREIGN KEY(company_id,page_id) REFERENCES pages(company_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS page_visits (
 company_id text NOT NULL REFERENCES companies(company_id), user_id text NOT NULL, page_id uuid NOT NULL,
 visited_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,user_id,page_id),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id),
 FOREIGN KEY(company_id,page_id) REFERENCES pages(company_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS page_visits_user_idx ON page_visits(company_id,user_id,visited_at);
CREATE TABLE IF NOT EXISTS attachments (
 id uuid PRIMARY KEY, company_id text NOT NULL REFERENCES companies(company_id), page_id uuid NOT NULL, uploader_id text NOT NULL,
 filename text NOT NULL, mime_type text NOT NULL, size integer NOT NULL CHECK(size >= 0), storage_key text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,page_id) REFERENCES pages(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,uploader_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX IF NOT EXISTS attachments_page_idx ON attachments(company_id,page_id);
