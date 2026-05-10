import type { Request, Response, NextFunction } from "express";

// Extend the Express Request type once, project-wide
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const extractUserId = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Internal services pass userId as a trusted header after their own auth
  const userId = req.headers["x-user-id"] as string | undefined;

  if (!userId || userId.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "x-user-id header is required",
    });
  }

  req.userId = userId.trim();
  next();
};
