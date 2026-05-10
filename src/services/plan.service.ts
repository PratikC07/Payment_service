import { prisma } from "../config/prisma.js";

export const planService = {
  async getActivePlans() {
    return await prisma.plan.findMany({
      where: { isActive: true },
      include: {
        features: {
          include: { feature: true },
        },
      },
    });
  },

  async getPlanById(id: string) {
    return await prisma.plan.findUnique({
      where: { id: id },
      include: {
        features: { include: { feature: true } },
      },
    });
  },
};
