import pino from "pino";
import { pinoHttp } from "pino-http";
import crypto from "crypto";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: () => crypto.randomUUID(),
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
});
