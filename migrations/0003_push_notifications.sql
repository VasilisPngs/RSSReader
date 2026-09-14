ALTER TABLE feeds ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;

CREATE TABLE push_keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_jwk TEXT NOT NULL,
  subject TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
