import { prisma } from "../config/prisma.js";

export const featureService = {
  async getAllFeatures() {
    return await prisma.feature.findMany();
  },
};
