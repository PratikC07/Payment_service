// src/controllers/admin.controller.ts
import type { Request, Response, NextFunction } from "express";
import { adminService } from "../services/admin.service.js";

export const adminController = {
  async createFeature(req: Request, res: Response, next: NextFunction) {
    try {
      const feature = await adminService.createFeature(req.body);
      res.status(201).json({ success: true, data: feature });
    } catch (error) {
      next(error);
    }
  },

  async createPlan(req: Request, res: Response, next: NextFunction) {
    try {
      const plan = await adminService.createPlan(req.body);
      res.status(201).json({ success: true, data: plan });
    } catch (error) {
      next(error);
    }
  },
};
