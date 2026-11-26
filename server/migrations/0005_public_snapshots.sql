CREATE TABLE IF NOT EXISTS public_page_snapshots (
 company_id text NOT NULL,
 page_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE,
 title text NOT NULL,
 slug text NOT NULL,
 content jsonb NOT NULL,
 revision integer NOT NULL CHECK(revision >= 1),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,page_id),
 FOREIGN KEY(company_id,page_id) REFERENCES pages(company_id,id) ON DELETE CASCADE
);
