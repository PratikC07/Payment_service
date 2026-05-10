import { z } from "zod";
import { PlanPeriod } from "../../generated/prisma/enums.js";

export const createFeatureSchema = z.object({
  featureKey: z.string().min(3).toUpperCase(),
  name: z.string().min(3),
  description: z.string().optional(),
});

export const createPlanSchema = z.object({
  name: z.string().min(3),
  description: z.string().optional(),
  priceInPaise: z.number().int().positive(),
  currency: z.string().default("INR"),
  period: z.nativeEnum(PlanPeriod),
  interval: z.number().int().positive().default(1),
  totalCount: z.number().int().positive(),
  tier: z.number().int().positive().default(0),
  featureIds: z
    .array(z.string().uuid())
    .min(1, "Plan must have at least one feature"),
});
