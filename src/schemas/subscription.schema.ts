// src/schemas/subscription.schema.ts
import { z } from "zod";

export const initiateSubscriptionSchema = z.object({
  noshId: z.string().min(1, "Nosh Device ID is required"),
  planId: z.string().uuid("Invalid Plan ID format"),
});

// Add this to src/schemas/subscription.schema.ts
export const verifySubscriptionSchema = z.object({
  razorpaySubscriptionId: z.string().startsWith("sub_"),
  razorpayPaymentId: z.string().startsWith("pay_"),
  razorpaySignature: z.string().min(1),
});

// Add this to src/schemas/subscription.schema.ts
export const changePlanSchema = z.object({
  subscriptionId: z.string().uuid("Invalid Subscription ID"),
  newPlanId: z.string().uuid("Invalid Plan ID"),
});

export const cancelSubscriptionSchema = z.object({
  cancelReason: z.string().max(500).optional(),
});

export const userIdSchema = z.object({
  userId: z.string().min(1),
});
