import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { protectApi } from "./lib/walletAuth";
import { privateResponses } from "./lib/contentPrivacy";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Browser same-origin clients do not need permissive cross-origin access.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", (_req, res, next) => {
  // Include authentication failures in the no-cache policy.
  res.setHeader("Cache-Control", "private, no-store");
  res.vary("Cookie");
  next();
}, protectApi, privateResponses, router);

export default app;
