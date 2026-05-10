// src/controllers/device.controller.ts
import type { Request, Response, NextFunction } from "express";
import { deviceService } from "../services/device.service.js";

export const deviceController = {
  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const noshId = req.params.noshId as string;
      const status = await deviceService.getSubscriptionStatus(noshId);
      res.status(200).json({ success: true, data: status });
    } catch (error) {
      next(error);
    }
  },
};
