import { Router } from "express";
import { subscriptionController } from "../controllers/subscription.controller.js";
import { validate } from "../middlewares/validate.js";
import {
  initiateSubscriptionSchema,
  verifySubscriptionSchema,
  changePlanSchema,
  cancelSubscriptionSchema,
} from "../schemas/subscription.schema.js";
import { extractUserId } from "../utils/extractUserId.js";
import { idempotencyKey } from "../middlewares/idempotency.js";

const router = Router();
router.post(
  "/initiate",
  extractUserId,
  validate(initiateSubscriptionSchema),
  subscriptionController.initiate,
);
router.post(
  "/verify",
  extractUserId,
  validate(verifySubscriptionSchema),
  subscriptionController.verify,
);

router.post(
  "/:subscriptionId/cancel",
  extractUserId,
  validate(cancelSubscriptionSchema),
  subscriptionController.cancelSubscription,
);

router.get("/history", extractUserId, subscriptionController.getHistory);
router.get("/me", extractUserId, subscriptionController.getCurrent);
router.post(
  "/change-plan",
  extractUserId,
  idempotencyKey,
  validate(changePlanSchema),
  subscriptionController.changePlan,
);
// Add this near your other GET routes
router.get(
  "/pending-upgrade",
  extractUserId,
  subscriptionController.getPendingUpgrade,
);
export default router;
