// src/middlewares/errorHandler.ts
import type { Request, Response, NextFunction } from "express";
import { type ZodTypeAny, ZodError } from "zod";
import { logger } from "../utils/loggers.js";
import { env } from "../config/env.js";

export const errorHandler = (
  err: Error & { statusCode?: number },
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: "Validation Error",
      errors: err.flatten().fieldErrors,
    });
    return;
  }

  const status = err.statusCode ?? 500;

  if (status >= 500) {
    logger.error({ err, reqId: req.id }, "Unhandled Exception");
  } else {
    logger.warn({ err, reqId: req.id }, "Client Error");
  }

  res.status(status).json({
    success: false,
    message: status < 500 ? err.message : "Internal Server Error",
    stack: env.NODE_ENV === "development" ? err.stack : undefined,
  });
};
