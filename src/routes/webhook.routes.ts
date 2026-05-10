// src/routes/webhook.routes.ts
import { Router } from "express";
import { webhookController } from "../controllers/webhook.controller.js";

const router = Router();

// Notice we do NOT use Zod here. We must accept the exact payload Razorpay sends.
router.post("/razorpay", webhookController.handleRazorpay);

export default router;
