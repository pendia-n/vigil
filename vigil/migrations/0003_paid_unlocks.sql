CREATE TABLE unlock_attempts (
 account_id TEXT NOT NULL, installation_id TEXT NOT NULL, session_id TEXT NOT NULL,
 domain TEXT NOT NULL, ends_at INTEGER NOT NULL, attempt_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id, installation_id, session_id, domain, attempt_id)
);
CREATE INDEX unlock_attempt_scope ON unlock_attempts(account_id, installation_id, domain, ends_at);
CREATE TABLE unlock_orders (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, installation_id TEXT NOT NULL,
 domain TEXT NOT NULL, session_ids TEXT NOT NULL, scope_key TEXT NOT NULL UNIQUE,
 generation INTEGER NOT NULL DEFAULT 0, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 checkout_id TEXT UNIQUE, payment_intent TEXT, checkout_url TEXT,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX unlock_order_account ON unlock_orders(account_id, installation_id, status);
