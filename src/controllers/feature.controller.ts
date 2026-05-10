import { featureService } from "../services/feature.service.js";
import type { Request, Response, NextFunction } from "express";

export const featureController = {
  async getAllFeatures(req: Request, res: Response, next: NextFunction) {
    try {
      const features = await featureService.getAllFeatures();
      res.status(200).json({ success: true, data: features });
    } catch (error) {
      next(error);
    }
  },
};
