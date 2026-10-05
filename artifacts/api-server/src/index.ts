import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupPresence } from "./presence";
import { scheduleWeeklyDigest } from "./weekly-digest";
import { pool } from "@workspace/db";
import { bootstrapInvite } from "./lib/bootstrapInvite";

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

// Schedule weekly digest (runs every Sunday midnight)
scheduleWeeklyDigest().catch((e) =>
  logger.error({ e }, "Failed to schedule weekly digest"),
);

async function start() {
  if (process.env.NODE_ENV === "production") {
    if (await bootstrapInvite(pool)) {
      logger.info("Initial team invitation created. Retrieve privately from the production database.");
    }
  }
  server.listen(port, () => {
    logger.info({ port }, "Server listening");
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
