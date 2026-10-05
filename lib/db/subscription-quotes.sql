CREATE TABLE IF NOT EXISTS subscription_quotes (
  id text PRIMARY KEY,
  subscriber_id integer NOT NULL REFERENCES users(id),
  creator_id integer NOT NULL REFERENCES users(id),
  subscriber_wallet text NOT NULL,
  creator_wallet text NOT NULL,
  price numeric(18,8) NOT NULL CHECK (price > 0),
  chain_id integer NOT NULL,
  contract text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_hash text UNIQUE,
  CHECK (expires_at > created_at)
);