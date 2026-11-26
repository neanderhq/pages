CREATE TABLE IF NOT EXISTS attachment_contents (
 attachment_id uuid PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
 body_base64 text NOT NULL,
 CONSTRAINT attachment_contents_size CHECK (octet_length(body_base64) <= 13981016)
);
