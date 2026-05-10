import { Router } from "express";
import { featureController } from "../controllers/feature.controller.js";

const router = Router();
router.get("/", featureController.getAllFeatures);
export default router;
