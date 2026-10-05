-- Development-only additive repair, matching src/schema/registrations.ts.
-- Read-only schema comparison found this was the ONLY missing declared table.
-- No evidence is populated; existing users still require independently verified
-- registration receipts. Do not infer evidence from users.registration_tx_hash.
--
-- Production prerequisite (not performed here):
-- First confirm whether the DEPLOYED app uses Replit-managed PostgreSQL or an
-- external database. DATABASE_URL in this workspace does not establish that.
-- For confirmed Replit-managed production, review the additive schema diff in
-- Publish and publish through Replit's supported migration flow; do not select
-- overwrite-data. For external production, use its documented, authorized
-- migration workflow after confirming the target. Verify the deployed schema
-- before treating authentication as operational. Do not run startup-time DDL
-- or attach this file to deployment/build hooks.
BEGIN;
CREATE TABLE IF NOT EXISTS public.verified_registrations (
  user_id integer PRIMARY KEY REFERENCES public.users(id),
  tx_hash text NOT NULL UNIQUE,
  verified_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;