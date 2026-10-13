import { pool } from "@workspace/db";

/** Additive, idempotent schema prerequisites; no historical rows are deleted. */
export async function ensurePublicationSchema() {
  await pool.query(`
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS chain_verified_at timestamptz;
    ALTER TABLE post_likes ADD COLUMN IF NOT EXISTS chain_verified_at timestamptz;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS admission_method text NOT NULL DEFAULT 'invite';
    CREATE TABLE IF NOT EXISTS post_drafts (
      id integer PRIMARY KEY,
      author_id integer NOT NULL REFERENCES users(id),
      content text NOT NULL,
      image_url text NOT NULL,
      is_paid boolean NOT NULL DEFAULT false,
      content_uri text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
