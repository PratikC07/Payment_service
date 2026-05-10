// src/services/device.service.ts
import { prisma } from "../config/prisma.js";

export const deviceService = {
  async getSubscriptionStatus(noshId: string) {
    const subscription = await prisma.subscription.findFirst({
      where: {
        noshId: noshId,
        status: "ACTIVE",
        periodEnd: { gte: new Date() },
      },
      include: {
        plan: {
          include: {
            features: { include: { feature: true } },
          },
        },
      },
    });

    if (!subscription) {
      return { isActive: false, unlockedFeatures: [] };
    }

    return {
      isActive: true,
      planName: subscription.plan.name,
      periodEnd: subscription.periodEnd,
      unlockedFeatures: subscription.plan.features.map(
        (f) => f.feature.featureKey,
      ),
    };
  },
};
