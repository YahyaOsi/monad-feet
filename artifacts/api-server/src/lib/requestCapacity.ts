import type { RequestHandler } from "express";

// Bound in-flight work without trusting spoofable forwarded IP headers or
// applying one shared rate quota to every user behind the deployment proxy.
export function requestCapacity(limit = 64): RequestHandler {
  let active = 0;
  return (_req, res, next) => {
    if (active >= limit) {
      res.setHeader("Retry-After", "3");
      res.status(503).json({ error: "The service is busy. Please retry shortly." });
      return;
    }
    active++;
    let released = false;
    const release = () => {
      if (!released) { released = true; active--; }
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}
