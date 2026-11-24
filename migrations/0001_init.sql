-- My Media Universe — initial schema
-- Every user-owned table carries user_id and every query filters on it.

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────
-- Users & authentication
-- ─────────────────────────────────────────────────────────────
CREATE TABLE users (
  id                        TEXT PRIMARY KEY,
  username                  TEXT NOT NULL,
  username_normalized       TEXT NOT NULL UNIQUE,
  email                     TEXT NOT NULL,
  email_normalized          TEXT NOT NULL UNIQUE,
  email_verified_at         INTEGER,
  password_hash             TEXT NOT NULL,
  password_salt             TEXT NOT NULL,
  password_algo             TEXT NOT NULL DEFAULT 'pbkdf2-sha256',
  recovery_key_hash         TEXT,
  recovery_key_updated_at   INTEGER,
  role                      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  preferences               TEXT NOT NULL DEFAULT '{"theme":"dark","language":"fa","autoBackup":false}',
  timezone                  TEXT,
  invited_by                TEXT,
  disabled_at               INTEGER,
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL
);

CREATE INDEX idx_users_role ON users(role) WHERE disabled_at IS NULL;

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  user_agent    TEXT,
  ip            TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);

CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE invitations (
  id          TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL UNIQUE,
  code_hint   TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  email_hint  TEXT,
  max_uses    INTEGER NOT NULL DEFAULT 1,
  use_count   INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  expires_at  INTEGER,
  revoked_at  INTEGER,
  used_by     TEXT REFERENCES users(id),
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_invitations_created ON invitations(created_at DESC);

CREATE TABLE email_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'recovery_session')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_email_tokens_user ON email_tokens(user_id, purpose);

-- Fixed-window counters. Rows are only written when a limit is actually hit
-- or a counter rolls over, to stay well inside D1's free write allowance.
CREATE TABLE rate_limits (
  key           TEXT PRIMARY KEY,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

-- ─────────────────────────────────────────────────────────────
-- Library
-- ─────────────────────────────────────────────────────────────
CREATE TABLE media_items (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source               TEXT NOT NULL DEFAULT 'tmdb' CHECK (source IN ('tmdb', 'manual')),
  tmdb_id              INTEGER,
  kind                 TEXT NOT NULL CHECK (kind IN ('movie', 'series')),
  is_anime             INTEGER NOT NULL DEFAULT 0,
  title                TEXT NOT NULL,
  original_title       TEXT,
  overview             TEXT,
  overview_en          TEXT,
  poster_path          TEXT,
  backdrop_path        TEXT,
  custom_poster_data   TEXT,
  release_date         TEXT,
  year                 INTEGER,
  genres               TEXT NOT NULL DEFAULT '[]',
  runtime_minutes      INTEGER,
  country              TEXT,
  language             TEXT,
  director             TEXT,
  cast_list            TEXT NOT NULL DEFAULT '[]',
  status               TEXT NOT NULL DEFAULT 'plan'
                       CHECK (status IN ('plan', 'watching', 'completed', 'onhold', 'dropped')),
  rating_method        TEXT NOT NULL DEFAULT 'direct' CHECK (rating_method IN ('direct', 'criteria')),
  rating_direct        REAL,
  criteria             TEXT NOT NULL DEFAULT '{}',
  rating_final         REAL,
  final_series_rating  REAL,
  notes                TEXT,
  quotes               TEXT NOT NULL DEFAULT '[]',
  is_spoiler           INTEGER NOT NULL DEFAULT 0,
  tags                 TEXT NOT NULL DEFAULT '[]',
  watch_date           TEXT,
  favorite             INTEGER NOT NULL DEFAULT 0,
  added_at             INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  removed_at           INTEGER
);

CREATE UNIQUE INDEX idx_media_unique_tmdb
  ON media_items(user_id, source, tmdb_id)
  WHERE tmdb_id IS NOT NULL AND removed_at IS NULL;

CREATE INDEX idx_media_user ON media_items(user_id, removed_at, updated_at DESC);
CREATE INDEX idx_media_kind ON media_items(user_id, kind, is_anime, removed_at, status);
CREATE INDEX idx_media_rating ON media_items(user_id, rating_final DESC) WHERE rating_final IS NOT NULL;

CREATE TABLE episodes (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_item_id      TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  tmdb_episode_id    INTEGER,
  season_number      INTEGER NOT NULL,
  episode_number     INTEGER NOT NULL,
  name               TEXT NOT NULL,
  original_name      TEXT,
  overview           TEXT,
  still_path         TEXT,
  air_date           TEXT,
  runtime_minutes    INTEGER,
  watched            INTEGER NOT NULL DEFAULT 0,
  rating_method      TEXT NOT NULL DEFAULT 'direct' CHECK (rating_method IN ('direct', 'criteria')),
  rating_direct      REAL,
  criteria           TEXT NOT NULL DEFAULT '{}',
  rating_final       REAL,
  notes              TEXT,
  quotes             TEXT NOT NULL DEFAULT '[]',
  tags               TEXT NOT NULL DEFAULT '[]',
  is_spoiler         INTEGER NOT NULL DEFAULT 0,
  watch_date         TEXT,
  added_at           INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  UNIQUE (user_id, media_item_id, season_number, episode_number)
);

CREATE INDEX idx_episodes_media ON episodes(media_item_id, season_number, episode_number);
CREATE INDEX idx_episodes_watched ON episodes(user_id, watched, rating_final) WHERE rating_final IS NOT NULL;

CREATE TABLE seasons (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_item_id   TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  tmdb_season_id  INTEGER,
  season_number   INTEGER NOT NULL,
  name            TEXT,
  overview        TEXT,
  poster_path     TEXT,
  air_date        TEXT,
  episode_count   INTEGER NOT NULL DEFAULT 0,
  added_at        INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (user_id, media_item_id, season_number)
);

CREATE INDEX idx_seasons_media ON seasons(media_item_id, season_number);

-- ─────────────────────────────────────────────────────────────
-- Viewing history (rewatches) — append-only, never overwritten
-- ─────────────────────────────────────────────────────────────
CREATE TABLE watch_events (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_item_id  TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  episode_id     TEXT REFERENCES episodes(id) ON DELETE CASCADE,
  watched_at     TEXT NOT NULL,
  rating         REAL,
  rating_method  TEXT,
  criteria       TEXT NOT NULL DEFAULT '{}',
  notes          TEXT,
  quotes         TEXT NOT NULL DEFAULT '[]',
  created_at     INTEGER NOT NULL
);

CREATE INDEX idx_watch_events_item ON watch_events(media_item_id, watched_at DESC);
CREATE INDEX idx_watch_events_user ON watch_events(user_id, watched_at DESC);

-- ─────────────────────────────────────────────────────────────
-- Categories (classification) & lists (ordered collections)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE category_items (
  category_id   TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (category_id, media_item_id)
);

CREATE INDEX idx_category_items_media ON category_items(media_item_id);

CREATE TABLE lists (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  sort_mode    TEXT NOT NULL DEFAULT 'manual'
               CHECK (sort_mode IN ('manual', 'rating', 'date', 'title')),
  is_watchlist INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_lists_watchlist ON lists(user_id) WHERE is_watchlist = 1;

CREATE TABLE list_items (
  list_id       TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  position      REAL NOT NULL,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (list_id, media_item_id)
);

CREATE INDEX idx_list_items_media ON list_items(media_item_id);

-- ─────────────────────────────────────────────────────────────
-- Offline sync / idempotency
-- ─────────────────────────────────────────────────────────────
CREATE TABLE sync_ops (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  op_id        TEXT NOT NULL,
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  status_code  INTEGER,
  response     TEXT,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, op_id)
);

-- ─────────────────────────────────────────────────────────────
-- TMDB response cache (server-side, shared across users)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE tmdb_cache (
  cache_key   TEXT PRIMARY KEY,
  body        TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX idx_tmdb_cache_expiry ON tmdb_cache(expires_at);

-- ─────────────────────────────────────────────────────────────
-- Google Drive connection & backups
-- ─────────────────────────────────────────────────────────────
CREATE TABLE google_connections (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_account_id   TEXT,
  google_email        TEXT,
  access_token_enc    TEXT,
  refresh_token_enc   TEXT NOT NULL,
  access_expires_at   INTEGER,
  scope               TEXT NOT NULL,
  folder_id           TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE backups (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drive_file_id   TEXT NOT NULL,
  name            TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  schema_version  INTEGER NOT NULL,
  item_count      INTEGER NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'auto')),
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_backups_user ON backups(user_id, created_at DESC);

CREATE TABLE oauth_states (
  state         TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  expires_at    INTEGER NOT NULL
);
