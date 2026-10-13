import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupPresence } from "./presence";
import { scheduleWeeklyDigest } from "./weekly-digest";
import { pool } from "@workspace/db";
import { bootstrapInvite } from "./lib/bootstrapInvite";
import { grantEarlyBetaBadges } from "./lib/earlyBeta";
import { ensurePublicationSchema } from "./lib/publicationSchema";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

// Attach WebSocket presence server
setupPresence(server);

async function start() {
  // Production schema is applied by Publish, never by every autoscale instance.
  if (process.env.NODE_ENV !== "production") await ensurePublicationSchema();
  server.listen(port, () => {
    logger.info({ port }, "Server listening");
    // Autoscale health must not wait on database maintenance or digest reports.
    const maintenance = setTimeout(() => {
      void grantEarlyBetaBadges().catch(error => logger.error({ error }, "Early beta maintenance failed"));
      void scheduleWeeklyDigest().catch(error => logger.error({ error }, "Digest scheduling failed"));
      if (process.env.NODE_ENV === "production") {
        void bootstrapInvite(pool).catch(error => logger.error({ error }, "Invitation bootstrap failed"));
      }
    }, 5_000);
    maintenance.unref();
  });
}

void start().catch((error) => {
  logger.error({ error }, "Startup failed; check production database schema");
  process.exit(1);
});

server.on("error", (err) => {
  logger.error({ err }, "Server error");
  process.exit(1);
});
