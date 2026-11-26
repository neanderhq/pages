ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'not_applicable'
  CHECK (email_status IN ('not_applicable', 'pending', 'sending', 'sent', 'failed', 'unavailable'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_error text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0 CHECK (email_attempts >= 0);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_attempted_at timestamptz;
