// src/routes/admin.routes.ts
import { Router } from "express";
import { adminController } from "../controllers/admin.controller.js";
import { validate } from "../middlewares/validate.js";
import {
  createFeatureSchema,
  createPlanSchema,
} from "../schemas/admin.schema.js";

const router = Router();

router.post(
  "/features",
  validate(createFeatureSchema),
  adminController.createFeature,
);
router.post("/plans", validate(createPlanSchema), adminController.createPlan);

export default router;
