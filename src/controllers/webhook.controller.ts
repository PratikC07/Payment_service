// src/controllers/webhook.controller.ts
import type { Request, Response, NextFunction } from "express";
import { verifyRazorpaySignature } from "../utils/webhookUtils.js";
import { webhookService } from "../services/webhook.service.js";
import { logger } from "../utils/loggers.js";

export const webhookController = {
  async handleRazorpay(req: Request, res: Response, next: NextFunction) {
    try {
      const signature = req.headers["x-razorpay-signature"] as string;
      const eventId = req.headers["x-razorpay-event-id"] as string;
      const rawBody = (req as any).rawBody;

      if (!eventId) {
        logger.warn("Webhook received without x-razorpay-event-id header");
        return res
          .status(400)
          .json({ success: false, message: "Missing event ID header" });
      }

      if (!signature || !verifyRazorpaySignature(rawBody, signature)) {
        logger.warn("Invalid Webhook Signature Detected");
        return res
          .status(400)
          .json({ success: false, message: "Invalid Signature" });
      }

      try {
        await webhookService.saveReceipt(
          eventId,
          req.body.event,
          req.body.payload,
        );
      } catch (error: any) {
        if (error.message === "DUPLICATE_WEBHOOK") {
          return res.status(200).json({ received: true });
        }
        throw error;
      }

      const eventName = req.body.event;
      const payload = req.body.payload;

      if (eventName === "subscription.charged") {
        await webhookService.processFulfillment(eventId, payload);
      } else if (eventName === "subscription.authenticated") {
        await webhookService.processAuthenticated(eventId, payload);
      } else if (eventName === "subscription.cancelled") {
        await webhookService.processCancellation(eventId, payload);
      } else if (eventName === "subscription.halted") {
        await webhookService.processHalted(eventId, payload);
      } else if (eventName === "subscription.pending") {
        await webhookService.processPending(eventId, payload);
      } else if (eventName === "subscription.completed") {
        await webhookService.processCompleted(eventId, payload);
      } else if (eventName === "subscription.expired") {
        await webhookService.processExpired(eventId, payload);
      } else if (eventName === "payment.failed") {
        await webhookService.processPaymentFailure(eventId, payload);
      } else if (eventName === "order.paid") {
        await webhookService.processOrderPaid(eventId, payload);
      }

      res.status(200).json({ received: true });
    } catch (error) {
      next(error);
    }
  },
};
