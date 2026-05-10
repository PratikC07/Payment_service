import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";

export const internalAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const apiKey = req.headers["x-internal-api-key"];

  if (!apiKey || apiKey !== env.INTERNAL_API_KEY) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  next();
};
