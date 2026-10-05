-- Additive only: no changes to existing content, profiles or object references.
CREATE TABLE IF NOT EXISTS media_objects (
  object_path text PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES users(id),
  visibility text NOT NULL DEFAULT 'unbound',
  created_at timestamptz NOT NULL DEFAULT now()
);