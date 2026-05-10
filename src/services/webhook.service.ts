// src/services/webhook.service.ts
import { prisma } from "../config/prisma.js";
import { razorpay } from "../config/razorpay.js";
import {
  Prisma,
  PlanChangeAuditStatus,
  SubscriptionStatus,
} from "../../generated/prisma/client.js";
import { logger } from "../utils/loggers.js";

export const webhookService = {
  async saveReceipt(eventId: string, eventType: string, payload: any) {
    const existing = await prisma.webhookLog.findUnique({
      where: { razorpayEventId: eventId },
    });
    if (existing) {
      // if the webhook is already processed, throw an error to avoid duplicate processing
      if (existing.processed) {
        throw new Error("DUPLICATE_WEBHOOK");
      }
      // if the webhook is not processed, allow retry
      logger.warn(
        { eventId, retryCount: existing.retryCount },
        "Re-processing previously failed webhook",
      );
      return existing; // Return existing log; processing will continue
    }

    try {
      return await prisma.webhookLog.create({
        data: {
          razorpayEventId: eventId,
          eventType: eventType,
          payload: payload,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new Error("DUPLICATE_WEBHOOK");
      }
      throw error; // Database is likely down, let it crash to return 500
    }
  },

  // Process the subscription charged when first time as well as recurring
  async processFulfillment(eventId: string, payload: any) {
    const subscriptionEntity = payload.subscription?.entity;
    const paymentEntity = payload.payment?.entity;

    if (!subscriptionEntity) return;

    try {
      await prisma.$transaction(async (tx) => {
        const existingSub = await tx.subscription.findUnique({
          where: { razorpaySubId: subscriptionEntity.id },
        });
        if (!existingSub) {
          logger.warn(
            { eventId, razorpaySubId: subscriptionEntity.id },
            "Received charged event for a subscription not found in database",
          );
          // Still mark the webhook log as processed so Razorpay stops retrying
          await tx.webhookLog.update({
            where: { razorpayEventId: eventId },
            data: { processed: true },
          });
          return;
        }

        // Activate the subscription
        const subscription = await tx.subscription.update({
          where: { razorpaySubId: subscriptionEntity.id },
          data: {
            status: "ACTIVE",
            ...(subscriptionEntity.current_start && {
              periodStart: new Date(subscriptionEntity.current_start * 1000),
            }),
            ...(subscriptionEntity.current_end && {
              periodEnd: new Date(subscriptionEntity.current_end * 1000),
            }),
          },
        });

        // If this subscription is the "to" side of an upgrade, the audit row
        // moves PAID → ACTIVATED (full lifecycle for finance/CS dashboards).
        if (subscription.replacesSubscriptionId) {
          await tx.planChangeAudit.updateMany({
            where: {
              fromSubscriptionId: subscription.replacesSubscriptionId,
              toSubscriptionId: subscription.id,
              status: {
                in: [
                  PlanChangeAuditStatus.PAID,
                  PlanChangeAuditStatus.INITIATED,
                ],
              },
            },
            data: {
              status: PlanChangeAuditStatus.ACTIVATED,
              effectiveAt: subscriptionEntity.current_start
                ? new Date(subscriptionEntity.current_start * 1000)
                : new Date(),
            },
          });
        }

        // handling the transaction for first time as well as recurring payments
        if (paymentEntity) {
          const existing = await tx.transaction.findUnique({
            where: { razorpayPaymentId: paymentEntity.id },
          });

          if (!existing) {
            await tx.transaction.create({
              data: {
                userId: subscription.userId,
                subscriptionId: subscription.id,
                razorpayPaymentId: paymentEntity.id,
                amountInPaise: paymentEntity.amount,
                currency: paymentEntity.currency ?? "INR",
                type: "CHARGE",
                status: "SUCCESS",
              },
            });
          } else {
            if (existing.subscriptionId !== subscription.id) {
              logger.warn(
                { eventId, paymentId: paymentEntity.id },
                "Transaction row linked to different subscription; reconciling from webhook",
              );
            }
            await tx.transaction.update({
              where: { razorpayPaymentId: paymentEntity.id },
              data: {
                userId: subscription.userId,
                subscriptionId: subscription.id,
                amountInPaise: paymentEntity.amount,
                currency: paymentEntity.currency,
                type: "CHARGE",
                status: "SUCCESS",
              },
            });
          }
        }

        // Mark the webhook log as processed
        await tx.webhookLog.update({
          where: { razorpayEventId: eventId },
          data: { processed: true },
        });
      });

      logger.info(
        `✅ Successfully fulfilled subscription ${subscriptionEntity.id}`,
      );
    } catch (error) {
      await webhookService.markWebhookFailed(eventId, error as Error); // ✅
      logger.error({ err: error, eventId }, "Failed to process webhook");
      throw error;
    }
  },

  // Process the subscription cancelled when user cancels the subscription
  async processCancellation(eventId: string, payload: any) {
    const subscriptionEntity = payload.subscription?.entity;
    if (!subscriptionEntity) return;

    try {
      await prisma.$transaction(async (tx) => {
        const existingSub = await tx.subscription.findUnique({
          where: { razorpaySubId: subscriptionEntity.id },
        });

        if (!existingSub) {
          logger.warn(
            { eventId, razorpaySubId: subscriptionEntity.id },
            "Received cancellation for a subscription not found in database",
          );
        } else {
          await tx.subscription.update({
            where: { razorpaySubId: subscriptionEntity.id },
            data: {
              status: "CANCELLED",
              cancelledAt: subscriptionEntity.ended_at
                ? new Date(subscriptionEntity.ended_at * 1000)
                : new Date(),
            },
          });
        }

        await tx.webhookLog.update({
          where: { razorpayEventId: eventId },
          data: { processed: true },
        });
      });

      logger.info(
        `✅ Successfully processed cancellation for subscription ${subscriptionEntity.id}`,
      );
    } catch (error) {
      await webhookService.markWebhookFailed(eventId, error as Error); // ✅
      logger.error({ err: error, eventId }, "Failed to process webhook");
      throw error;
    }
  },

  // Process the subscription halted when user's payment fails multiple times
  async processHalted(eventId: string, payload: any) {
    const subscriptionEntity = payload.subscription?.entity;
    if (!subscriptionEntity) return;

    try {
      await prisma.$transaction(async (tx) => {
        const existingSub = await tx.subscription.findUnique({
          where: { razorpaySubId: subscriptionEntity.id },
        });

        if (!existingSub) {
          logger.warn(
            { eventId, razorpaySubId: subscriptionEntity.id },
            "Received halted event for a subscription not found in database",
          );
        } else {
          await tx.subscription.update({
            where: { razorpaySubId: subscriptionEntity.id },
            data: { status: "HALTED" },
          });
        }

        await tx.webhookLog.update({
          where: { razorpayEventId: eventId },
          data: { processed: true },
        });
      });

      logger.info(
        `⛔ Successfully halted subscription ${subscriptionEntity.id} due to payment failure`,
      );
    } catch (error) {
      await webhookService.markWebhookFailed(eventId, error as Error); // ✅
      logger.error({ err: error, eventId }, "Failed to process webhook");
      throw error;
    }
  },

  // subscription.pending — charge attempt failed, Razorpay is retrying → PAST_DUE
  async processPending(eventId: string, payload: any) {
    const subscriptionEntity = payload.subscription?.entity;
    if (!subscriptionEntity) return;

    try {
      await prisma.$transaction(async (tx) => {
        const existingSub = await tx.subscription.findUnique({
          where: { razorpaySubId: subscriptionEntity.id },
        });

        if (!existingSub) {
          logger.warn(
            { eventId, razorpaySubId: subscriptionEntity.id },
            "Received pending event for a subscription not found in database",
          );
        } else {
          await tx.subscription.update({
            where: { razorpaySubId: subscriptionEntity.id },
            data: { status: "PAST_DUE" },
          });
        }

        await tx.webhookLog.update({
          where: { razorpayEventId: eventId },
          data: { processed: true },
        });
      });

      logger.info(
        `⏳ Subscription ${subscriptionEntity.id} marked PAST_DUE — Razorpay retrying charge`,
      );
    } catch (error) {
      await webhookService.markWebhookFailed(eventId, error as Error);
      logger.error({ err: error, eventId }, "Failed to process webhook");
      throw error;
    }
  },

  // subscription.completed — all billing cycles finished naturally → COMPLETED
  async processCompleted(eventId: string, payload: any) {
    const subscriptionEntity = payload.subscription?.entity;
    if (!subscriptionEntity) return;

    try {
      await prisma.$transaction(async (tx) => {
        const existingSub = await tx.subscription.findUnique({
          where: { razorpaySubId: subscriptionEntity.id },
        });

        if (!existingSub) {
          logger.warn(
            { eventId, razorpaySubId: subscriptionEntity.id },
            "Received completed event for a subscription not found in database",
          );
        } else {
          await tx.subscription.update({
            where: { razorpaySubId: subscriptionEntity.id },
            data: { status: "COMPLETED" },
          });
        }

        await tx.webhookLog.update({
          where: { razorpayEventId: eventId },
          data: { processed: true },
        });
      });

      logger.info(
        `🏁 Subscription ${subscriptionEntity.id} completed all billing cycles`,
      );
    } catch (error) {
      await webhookService.markWebhookFailed(eventId, error as Error);
      logger.error({ err: error, eventId }, "Failed to process webhook");
      throw error;
    }
  },

  // subscription.expired — user never completed checkout before expiry window → EXPIRED
  async processExpired(eventId: string, payload: any) {
    const subscriptionEntity = payload.subscription?.entity;
    if (!subscriptionEntity) return;

    try {
      await prisma.$transaction(async (tx) => {
        const existingSub = await tx.subscription.findUnique({
          where: { razorpaySubId: subscriptionEntity.id },
        });

        if (!existingSub) {
          logger.warn(
            { eventId, razorpaySubId: subscriptionEntity.id },
            "Received expired event for a subscription not found in database",
          );
        } else {
          await tx.subscription.update({
            where: { razorpaySubId: subscriptionEntity.id },
            data: { status: "EXPIRED" },
          });
        }

        await tx.webhookLog.update({
          where: { razorpayEventId: eventId },
          data: { processed: true },
        });
      });

      logger.info(
        `💀 Subscription ${subscriptionEntity.id} expired — user never completed checkout`,
      );
    } catch (error) {
      await webhookService.markWebhookFailed(eventId, error as Error);
      logger.error({ err: error, eventId }, "Failed to process webhook");
      throw error;
    }
  },

  // Process the payment failure when user's payment fails
  async processPaymentFailure(eventId: string, payload: any) {
    const paymentEntity = payload?.payment?.entity;

    if (!paymentEntity) {
      logger.warn(
        { eventId },
        "payment.failed received without payment.entity; marking processed and skipping",
      );
      await prisma.webhookLog.update({
        where: { razorpayEventId: eventId },
        data: { processed: true },
      });
      return;
    }

    if (!paymentEntity.subscription_id) {
      logger.warn(
        { eventId, paymentId: paymentEntity.id },
        "payment.failed has no subscription_id, skipping",
      );
      await prisma.webhookLog.update({
        where: { razorpayEventId: eventId },
        data: { processed: true },
      });
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.findUnique({
          where: { razorpaySubId: paymentEntity.subscription_id },
        });

        if (!subscription) {
          logger.warn(
            { eventId, razorpaySubId: paymentEntity.subscription_id },
            "Received payment failure for a subscription not found in database",
          );
        } else {
          await tx.transaction.upsert({
            where: { razorpayPaymentId: paymentEntity.id },
            update: {
              status: "FAILED",
              failureReason: paymentEntity.error_description ?? null,
            },
            create: {
              userId: subscription.userId,
              subscriptionId: subscription.id,
              razorpayPaymentId: paymentEntity.id,
              amountInPaise: paymentEntity.amount,
              type: "CHARGE",
              status: "FAILED",
              failureReason: paymentEntity.error_description ?? null,
            },
          });
        }

        await tx.webhookLog.update({
          where: { razorpayEventId: eventId },
          data: { processed: true },
        });
      });

      logger.info(
        `⚠️ Successfully logged payment failure for payment ${paymentEntity.id}`,
      );
    } catch (error) {
      await webhookService.markWebhookFailed(eventId, error as Error); // ✅
      logger.error({ err: error, eventId }, "Failed to process webhook");
      throw error;
    }
  },

  async processOrderPaid(eventId: string, payload: any) {
    const orderEntity = payload?.order?.entity;
    const paymentEntity = payload?.payment?.entity;

    if (!orderEntity) {
      logger.warn({ eventId }, "order.paid received without order.entity");
      await prisma.webhookLog.update({
        where: { razorpayEventId: eventId },
        data: { processed: true },
      });
      return;
    }

    // Only handle orders we created for plan upgrades. Other one-time orders
    // (future signup fees, addons, etc.) will be handled separately.
    const notes = orderEntity.notes ?? {};
    if (notes.type !== "PLAN_UPGRADE_PRORATION") {
      logger.info(
        { eventId, orderId: orderEntity.id, type: notes.type },
        "order.paid ignored — not a plan-upgrade proration",
      );
      await prisma.webhookLog.update({
        where: { razorpayEventId: eventId },
        data: { processed: true },
      });
      return;
    }

    try {
      // Capture the old razorpaySubId BEFORE the DB transaction so we can
      // call Razorpay's cancel API after the local commit succeeds.
      let oldRazorpaySubId: string | null = null;
      let oldSubAlreadyCancelled = false;

      await prisma.$transaction(async (tx) => {
        const txnRow = await tx.transaction.findUnique({
          where: { razorpayOrderId: orderEntity.id },
        });

        if (!txnRow) {
          logger.warn(
            { eventId, orderId: orderEntity.id },
            "order.paid for unknown PRORATION order; marking processed",
          );
          await tx.webhookLog.update({
            where: { razorpayEventId: eventId },
            data: { processed: true },
          });
          return;
        }

        // Idempotent: if already SUCCESS, just close the webhook.
        if (txnRow.status === "SUCCESS") {
          logger.info(
            { eventId, orderId: orderEntity.id },
            "order.paid replay — transaction already SUCCESS",
          );
          await tx.webhookLog.update({
            where: { razorpayEventId: eventId },
            data: { processed: true },
          });
          return;
        }

        const newSub = await tx.subscription.findUnique({
          where: { id: txnRow.subscriptionId! },
        });
        if (!newSub) {
          throw new Error(
            `New (replacement) subscription ${txnRow.subscriptionId} not found`,
          );
        }
        if (!newSub.replacesSubscriptionId) {
          throw new Error(
            `Replacement sub ${newSub.id} has no replacesSubscriptionId — corrupt state`,
          );
        }

        const oldSub = await tx.subscription.findUnique({
          where: { id: newSub.replacesSubscriptionId },
        });
        if (!oldSub) {
          throw new Error(
            `Old subscription ${newSub.replacesSubscriptionId} not found`,
          );
        }

        oldRazorpaySubId = oldSub.razorpaySubId;
        oldSubAlreadyCancelled = !!oldSub.cancelledAt;

        // 1. Mark proration transaction SUCCESS, attach payment id.
        await tx.transaction.update({
          where: { id: txnRow.id },
          data: {
            status: "SUCCESS",
            razorpayPaymentId: paymentEntity?.id ?? null,
          },
        });

        // 2. Instant access switch: bump oldSub's plan to the new plan.
        //    The Razorpay sub itself still bills at the old plan until cycle
        //    end — that's intentional, the user already paid for that cycle.
        await tx.subscription.update({
          where: { id: oldSub.id },
          data: { planId: newSub.planId },
        });

        // 3. Mark audit PAID.
        await tx.planChangeAudit.updateMany({
          where: {
            razorpayOrderId: orderEntity.id,
            status: PlanChangeAuditStatus.INITIATED,
          },
          data: {
            status: PlanChangeAuditStatus.PAID,
            effectiveAt: new Date(),
          },
        });

        await tx.webhookLog.update({
          where: { razorpayEventId: eventId },
          data: { processed: true },
        });
      });

      // 4. Schedule old Razorpay sub cancellation at cycle end. Done OUTSIDE
      //    the DB transaction because Razorpay calls aren't transactional.
      //    If this fails the DB is already consistent (user has access);
      //    we'll just log and let an admin retry.
      if (oldRazorpaySubId && !oldSubAlreadyCancelled) {
        try {
          await razorpay.subscriptions.cancel(oldRazorpaySubId, true);
          await prisma.subscription.updateMany({
            where: { razorpaySubId: oldRazorpaySubId },
            data: { cancelReason: "plan-upgrade-paid" },
          });
        } catch (cancelErr) {
          logger.error(
            { err: cancelErr, eventId, oldRazorpaySubId },
            "Failed to schedule old sub cancellation post-upgrade — manual cleanup needed",
          );
        }
      }

      logger.info(
        { eventId, orderId: orderEntity.id },
        "✅ Proration order.paid processed; user upgraded instantly",
      );
    } catch (error) {
      await webhookService.markWebhookFailed(eventId, error as Error);
      logger.error(
        { err: error, eventId },
        "Failed to process order.paid webhook",
      );
      throw error;
    }
  },

  async markWebhookFailed(eventId: string, error: Error) {
    await prisma.webhookLog.update({
      where: { razorpayEventId: eventId },
      data: {
        processingError: error.message,
        retryCount: { increment: 1 },
      },
    });
  },

  // Process subscription.authenticated — card linked successfully for a deferred start
  async processAuthenticated(eventId: string, payload: any) {
    const subscriptionEntity = payload.subscription?.entity;
    if (!subscriptionEntity) return;

    try {
      await prisma.$transaction(async (tx) => {
        const existingSub = await tx.subscription.findUnique({
          where: { razorpaySubId: subscriptionEntity.id },
        });

        if (!existingSub) {
          logger.warn(
            { eventId, razorpaySubId: subscriptionEntity.id },
            "Received authenticated event for a subscription not found in database",
          );
        } else {
          await tx.subscription.update({
            where: { razorpaySubId: subscriptionEntity.id },
            data: { status: "AUTHENTICATED" as any },
          });
        }

        await tx.webhookLog.update({
          where: { razorpayEventId: eventId },
          data: { processed: true },
        });
      });

      logger.info(
        `💳 Subscription ${subscriptionEntity.id} marked AUTHENTICATED (card linked for deferred start)`,
      );
    } catch (error) {
      await webhookService.markWebhookFailed(eventId, error as Error);
      logger.error({ err: error, eventId }, "Failed to process webhook");
      throw error;
    }
  },
};
