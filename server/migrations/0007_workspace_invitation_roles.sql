ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
UPDATE memberships SET role = 'editor' WHERE role = 'member';
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('admin','editor','viewer'));

ALTER TABLE invitations ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'editor';
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS share_token_hash text;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS share_token_ciphertext text;
CREATE UNIQUE INDEX IF NOT EXISTS invitations_share_token_hash_idx ON invitations(share_token_hash);
