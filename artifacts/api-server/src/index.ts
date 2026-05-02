import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupPresence } from "./presence";
import { scheduleWeeklyDigest } from "./weekly-digest";

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

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});

server.on("error", (err) => {
  logger.error({ err }, "Server error");
  process.exit(1);
});
