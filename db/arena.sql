CREATE TABLE IF NOT EXISTS arena_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  nickname text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz
);
CREATE TABLE IF NOT EXISTS arena_login_tokens (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS arena_login_email ON arena_login_tokens (email, expires_at);
CREATE TABLE IF NOT EXISTS arena_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES arena_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS arena_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  invite_hash text NOT NULL UNIQUE,
  owner_id uuid NOT NULL REFERENCES arena_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS arena_members (
  group_id uuid NOT NULL REFERENCES arena_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES arena_users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS arena_picks (
  user_id uuid NOT NULL REFERENCES arena_users(id) ON DELETE CASCADE,
  key text NOT NULL,
  selection text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS arena_results (
  game_id text PRIMARY KEY,
  home_score integer NOT NULL CHECK (home_score >= 0),
  away_score integer NOT NULL CHECK (away_score >= 0 AND away_score <> home_score),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS arena_season_results (
  id integer PRIMARY KEY CHECK (id = 1),
  champion text NOT NULL,
  final_four jsonb NOT NULL
);
