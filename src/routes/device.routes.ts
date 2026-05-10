// src/routes/device.routes.ts
import { Router } from "express";
import { deviceController } from "../controllers/device.controller.js";

const router = Router();
router.get("/:noshId/subscription", deviceController.getStatus);
export default router;
