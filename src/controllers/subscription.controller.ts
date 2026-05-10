import type { Request, Response, NextFunction } from "express";
import { subscriptionService } from "../services/subscription.service.js";
import { env } from "../config/env.js";

export const subscriptionController = {
  async initiate(req: Request, res: Response, next: NextFunction) {
    try {
      const checkoutData = await subscriptionService.initiateSubscription({
        userId: req.userId as string,
        noshId: req.body.noshId,
        planId: req.body.planId,
      });

      res.status(200).json({
        success: true,
        data: {
          ...checkoutData,
          razorpayKeyId: env.RAZORPAY_KEY_ID,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await subscriptionService.verifyPayment({
        userId: req.userId as string,
        razorpaySubscriptionId: req.body.razorpaySubscriptionId,
        razorpayPaymentId: req.body.razorpayPaymentId,
        razorpaySignature: req.body.razorpaySignature,
      });
      res.status(200).json(result);
    } catch (error: any) {
      if (error.message === "INVALID_SIGNATURE") {
        res.status(400).json({
          success: false,
          message: "Cryptographic signature verification failed",
        });
      } else {
        next(error);
      }
    }
  },

  async cancelSubscription(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.userId;
      const subscriptionId = req.params.subscriptionId as string;
      const { cancelReason } = req.body;

      if (!userId) {
        throw new Error("UserID is required");
      }

      const result = await subscriptionService.cancelSubscription(
        userId,
        subscriptionId,
        cancelReason ?? "No reason provided",
      );

      res.status(200).json({
        success: true,
        message:
          "Subscription will be cancelled at the end of the current billing cycle.",
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  },

  async getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.userId;
      if (!userId) throw new Error("UserID is required");

      const history = await subscriptionService.getBillingHistory(userId);
      res.status(200).json({ success: true, data: history });
    } catch (error) {
      next(error);
    }
  },

  async getCurrent(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.userId;
      if (!userId) {
        throw new Error("UserID is required");
      }

      const subscription =
        await subscriptionService.getCurrentSubscription(userId);

      if (!subscription) {
        return res.status(200).json({
          success: true,
          message: "No active subscription found",
          data: null,
        });
      }

      res.status(200).json({ success: true, data: subscription });
    } catch (error) {
      next(error);
    }
  },

  async changePlan(req: Request, res: Response, next: NextFunction) {
    try {
      const { subscriptionId, newPlanId } = req.body;

      if (!subscriptionId || !newPlanId) {
        throw new Error("All fields are required");
      }

      const result = await subscriptionService.changePlan({
        userId: req.userId!,
        subscriptionId,
        newPlanId,
        idempotencyKey: req.idempotencyKey!,
      });

      // Always returns mode: "UPGRADE_IMMEDIATE" with both prorationOrder and
      // newSubscription. Frontend opens Razorpay Checkout TWICE in sequence:
      //   1. Pay prorationOrder    → instant access via order.paid webhook
      //   2. Authorize newSubscription mandate → cycle-end takeover
      res.status(200).json({
        success: true,
        data: {
          ...result,
          razorpayKeyId: env.RAZORPAY_KEY_ID,
        },
      });
    } catch (error: any) {
      next(error);
    }
  },

  // Inside subscriptionController object...
  async getPendingUpgrade(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.userId;
      if (!userId) {
        throw new Error("UserID is required");
      }

      const pendingAuth =
        await subscriptionService.getPendingUpgradeAuthorization(userId);

      // If pendingAuth is null, they have no stuck upgrades.
      // If it returns an object, they need to complete Razorpay checkout.
      res.status(200).json({
        success: true,
        data: pendingAuth
          ? { ...pendingAuth, razorpayKeyId: env.RAZORPAY_KEY_ID }
          : null,
      });
    } catch (error) {
      next(error);
    }
  },
};
