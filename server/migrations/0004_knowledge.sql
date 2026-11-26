ALTER TABLE pages ADD COLUMN IF NOT EXISTS search_text text;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS review_interval_days integer CHECK(review_interval_days BETWEEN 1 AND 3650);
ALTER TABLE pages ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS last_reviewed_by text;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pages_last_reviewed_by_fk') THEN
  ALTER TABLE pages ADD CONSTRAINT pages_last_reviewed_by_fk FOREIGN KEY(company_id,last_reviewed_by) REFERENCES memberships(company_id,user_id);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS page_tags (
 company_id text NOT NULL REFERENCES companies(company_id), page_id uuid NOT NULL, tag text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,page_id,tag),
 CHECK(length(tag) BETWEEN 1 AND 40 AND tag = lower(tag)),
 FOREIGN KEY(company_id,page_id) REFERENCES pages(company_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS page_tags_tag_idx ON page_tags(company_id,tag);
CREATE TABLE IF NOT EXISTS page_links (
 company_id text NOT NULL REFERENCES companies(company_id), source_id uuid NOT NULL, target_id uuid NOT NULL,
 PRIMARY KEY(company_id,source_id,target_id), CHECK(source_id <> target_id),
 FOREIGN KEY(company_id,source_id) REFERENCES pages(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,target_id) REFERENCES pages(company_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS page_links_target_idx ON page_links(company_id,target_id);
