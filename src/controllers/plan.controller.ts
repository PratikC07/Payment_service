import type { Request, Response, NextFunction } from "express";
import { planService } from "../services/plan.service.js";

function formatPlan(plan: any) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceInPaise: plan.priceInPaise,
    currency: plan.currency,
    period: plan.period,
    interval: plan.interval,
    totalCount: plan.totalCount,
    isActive: plan.isActive,
    features: plan.features.map((f: any) => ({
      featureKey: f.feature.featureKey,
      name: f.feature.name,
      description: f.feature.description,
    })),
  };
}

export const planController = {
  async getPlans(req: Request, res: Response, next: NextFunction) {
    try {
      const plans = await planService.getActivePlans();

      const formattedPlans = plans.map(formatPlan);

      res.status(200).json({ success: true, data: formattedPlans });
    } catch (error) {
      next(error);
    }
  },

  async getPlanById(req: Request, res: Response, next: NextFunction) {
    try {
      const plan = await planService.getPlanById(req.params.id as string);

      if (!plan) {
        return res
          .status(404)
          .json({ success: false, message: "Plan not found" });
      }

      const formattedPlan = formatPlan(plan);
      res.status(200).json({ success: true, data: formattedPlan });
    } catch (error) {
      next(error);
    }
  },
};
