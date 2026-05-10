// src/middlewares/idempotency.ts
//
// Lightweight idempotency-key middleware. The header value is forwarded to the
// service layer, which uses it as a unique key on PlanChangeAudit (and any other
// resource it creates). A repeat call with the same key returns the existing
// resource instead of creating a duplicate.
//
// Stricter implementations cache the full HTTP response keyed by (userId, key)
// in Redis. We don't need that here: the service-layer uniqueness constraint on
// PlanChangeAudit.idempotencyKey gives us correctness, and a duplicate call just
// re-builds the same response from the existing audit row.

import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      idempotencyKey?: string;
    }
  }
}

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;

export const idempotencyKey = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const raw = req.headers["idempotency-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;

  if (!key || typeof key !== "string" || key.trim() === "") {
    return res.status(400).json({
      success: false,
      message:
        "Idempotency-Key header is required for this endpoint. Use any unique string of 8–128 chars (e.g. a UUID).",
    });
  }

  const trimmed = key.trim();

  if (!KEY_PATTERN.test(trimmed)) {
    return res.status(400).json({
      success: false,
      message:
        "Idempotency-Key must be 8–128 chars, [A-Za-z0-9_-:.] only (e.g. a UUID).",
    });
  }

  req.idempotencyKey = trimmed;
  next();
};
