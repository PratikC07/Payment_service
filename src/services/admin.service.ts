// src/services/admin.service.ts
import { prisma } from "../config/prisma.js";
import { PlanPeriod } from "../../generated/prisma/enums.js";
import { razorpay } from "../config/razorpay.js";

interface CreateFeatureDTO {
  featureKey: string;
  name: string;
  description?: string;
}

interface CreatePlanDTO {
  name: string;
  description?: string;
  priceInPaise: number;
  currency: string;
  period: PlanPeriod;
  interval: number;
  totalCount: number;
  tier: number;
  featureIds: string[];
}

export const adminService = {
  async createFeature(data: CreateFeatureDTO) {
    return await prisma.feature.create({
      data,
    });
  },

  async createPlan(data: CreatePlanDTO) {
    const razorpayPlan = await razorpay.plans.create({
      period: data.period.toLowerCase() as "monthly" | "yearly", // Razorpay expects "monthly", "yearly", etc.
      interval: data.interval ?? 1, // Billed every 1 period
      item: {
        name: data.name,
        amount: data.priceInPaise,
        currency: data.currency,
        description: data.description ?? "",
      },
    });

    return await prisma.plan.create({
      data: {
        name: data.name,
        description: data.description ?? "",
        razorpayPlanId: razorpayPlan.id,
        priceInPaise: data.priceInPaise,
        currency: data.currency,
        period: data.period,
        interval: data.interval,
        totalCount: data.totalCount,
        tier: data.tier,
        features: {
          create: data.featureIds.map((id) => ({
            featureId: id,
          })),
        },
      },
      include: {
        features: {
          include: {
            feature: true,
          },
        },
      },
    });
  },
};
