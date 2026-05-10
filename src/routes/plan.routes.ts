import { Router } from "express";
import { planController } from "../controllers/plan.controller.js";

const router = Router();
router.get("/", planController.getPlans);
router.get("/:id", planController.getPlanById);
export default router;
