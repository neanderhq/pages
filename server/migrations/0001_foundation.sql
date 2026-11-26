CREATE TABLE IF NOT EXISTS auth_users (
 id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, email_verified boolean NOT NULL DEFAULT false,
 image text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 id text PRIMARY KEY, token text NOT NULL UNIQUE, user_id text NOT NULL REFERENCES auth_users(id), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), ip_address text, user_agent text
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_accounts (
 id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES auth_users(id), password text,
 access_token text, refresh_token text, id_token text, scope text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider_id, account_id)
);
CREATE TABLE IF NOT EXISTS auth_verifications (
 id text PRIMARY KEY, identifier text NOT NULL UNIQUE, value text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS companies (company_id text PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS memberships (
 company_id text NOT NULL REFERENCES companies(company_id), user_id text NOT NULL REFERENCES auth_users(id),
 role text NOT NULL CHECK(role IN ('admin','member')), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','deactivated')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
CREATE TABLE IF NOT EXISTS groups (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(company_id), name text NOT NULL,
 UNIQUE(company_id,id), UNIQUE(company_id,name)
);
CREATE TABLE IF NOT EXISTS group_members (
 company_id text NOT NULL, group_id text NOT NULL, user_id text NOT NULL, PRIMARY KEY(company_id,group_id,user_id),
 FOREIGN KEY(company_id,group_id) REFERENCES groups(company_id,id), FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id)
);
CREATE TABLE IF NOT EXISTS spaces (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(company_id), name text NOT NULL, created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,name),
 FOREIGN KEY(company_id,created_by) REFERENCES memberships(company_id,user_id)
);
CREATE TABLE IF NOT EXISTS invitations (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(company_id), email text NOT NULL, token_hash text NOT NULL UNIQUE,
 invited_by text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,invited_by) REFERENCES memberships(company_id,user_id)
);
CREATE TABLE IF NOT EXISTS audit_events (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(company_id), actor text NOT NULL, action text NOT NULL,
 target text NOT NULL, timestamp timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,actor) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX IF NOT EXISTS audit_company_idx ON audit_events(company_id,timestamp);
