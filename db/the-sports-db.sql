CREATE TABLE IF NOT EXISTS arena_provider_sync (
  source text PRIMARY KEY,
  last_synced_at timestamptz,
  lease_until timestamptz,
  last_error text
);

CREATE TABLE IF NOT EXISTS arena_provider_games (
  game_id text PRIMARY KEY,
  provider_event_id text,
  status text,
  home_score integer CHECK (home_score IS NULL OR home_score >= 0),
  away_score integer CHECK (away_score IS NULL OR away_score >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS arena_provider_games_updated
  ON arena_provider_games (updated_at DESC);
