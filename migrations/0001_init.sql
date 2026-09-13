CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  rev INTEGER NOT NULL
);

CREATE TABLE feeds (
  id TEXT PRIMARY KEY,
  folder_id TEXT,
  title TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  site_url TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  rev INTEGER NOT NULL
);

CREATE TABLE feed_state (
  feed_id TEXT PRIMARY KEY,
  etag TEXT,
  last_modified TEXT,
  last_fetch_at INTEGER,
  next_fetch_at INTEGER NOT NULL DEFAULT 0,
  interval_seconds INTEGER NOT NULL DEFAULT 1200,
  last_status INTEGER,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  rev INTEGER NOT NULL
);

CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL,
  guid TEXT NOT NULL,
  url TEXT,
  title TEXT,
  author TEXT,
  summary TEXT,
  content TEXT,
  published_at INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  rev INTEGER NOT NULL
);

CREATE TABLE article_state (
  article_id TEXT PRIMARY KEY,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  read_at INTEGER,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL
);

CREATE TABLE sync_rev (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL
);

INSERT INTO sync_rev (id, value) VALUES (1, 0);

CREATE UNIQUE INDEX articles_feed_guid ON articles (feed_id, guid);
CREATE INDEX articles_rev_id ON articles (rev, id);
CREATE INDEX articles_published ON articles (published_at);
CREATE INDEX article_state_rev_id ON article_state (rev, article_id);
CREATE INDEX article_state_starred ON article_state (is_starred);
CREATE INDEX feeds_rev_id ON feeds (rev, id);
CREATE INDEX folders_rev_id ON folders (rev, id);
CREATE INDEX feed_state_rev_id ON feed_state (rev, feed_id);
CREATE INDEX feed_state_next_fetch ON feed_state (next_fetch_at);
