import { prisma } from "../config/prisma.js";
import { razorpay } from "../config/razorpay.js";
import { verifyFrontendSignature } from "../utils/webhookUtils.js";
import {
  Prisma,
  ChangeDirection,
  PlanChangeAuditStatus,
} from "../../generated/prisma/client.js";
import { logger } from "../utils/loggers.js";
import { daysRemaining, evaluateUpgrade } from "../utils/proration.util.js";

interface InitiateParams {
  userId: string;
  noshId: string;
  planId: string;
}

interface ChangePlanParams {
  userId: string;
  subscriptionId: string;
  newPlanId: string;
  idempotencyKey: string;
}

const BLOCKING_INITIATE_STATUSES = [
  "ACTIVE",
  "PAST_DUE",
  "PENDING",
] satisfies Array<"ACTIVE" | "PAST_DUE" | "PENDING">;

export const subscriptionService = {
  async initiateSubscription({ userId, noshId, planId }: InitiateParams) {
    const plan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan || !plan.isActive) {
      throw new Error("Plan not found or inactive");
    }

    // Block /initiate if the user has an upgrade in flight (proration order
    // not yet paid, or new sub still PENDING for cycle-end takeover).
    const upgradeInFlight = await prisma.planChangeAudit.findFirst({
      where: {
        userId,
        status: {
          in: [PlanChangeAuditStatus.INITIATED, PlanChangeAuditStatus.PAID],
        },
      },
    });

    if (upgradeInFlight) {
      throw new Error(
        "You have an upgrade in progress. Complete the existing checkout before starting a new subscription.",
      );
    }

    const existingActiveSub = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: BLOCKING_INITIATE_STATUSES },
      },
      include: { plan: { select: { name: true } } },
    });

    if (existingActiveSub) {
      if (existingActiveSub.status === "PENDING") {
        throw new Error(
          "You already have a pending subscription. Complete or cancel it first.",
        );
      }
      throw new Error(
        `You already have an active subscription (${existingActiveSub.plan.name}). Cancel it before subscribing to a new plan.`,
      );
    }

    const razorpaySubscription = await razorpay.subscriptions.create({
      plan_id: plan.razorpayPlanId,
      total_count: plan.totalCount,
    });

    console.log("razorpaySubscription", razorpaySubscription);

    logger.info(
      { razorpaySubId: razorpaySubscription.id },
      "Razorpay subscription created",
    );

    await prisma.subscription.create({
      data: {
        userId: userId,
        noshId: noshId,
        planId: planId,
        razorpaySubId: razorpaySubscription.id,
        status: "PENDING",
      },
    });

    return {
      razorpaySubscriptionId: razorpaySubscription.id,
      amountInPaise: plan.priceInPaise,
      currency: plan.currency,
      totalCount: plan.totalCount,
    };
  },

  async verifyPayment(data: {
    userId: string;
    razorpaySubscriptionId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }) {
    const isValid = verifyFrontendSignature(
      data.razorpayPaymentId,
      data.razorpaySubscriptionId,
      data.razorpaySignature,
    );

    if (!isValid) throw new Error("INVALID_SIGNATURE");

    const payment = await razorpay.payments.fetch(data.razorpayPaymentId);
    const rpSub = await razorpay.subscriptions.fetch(
      data.razorpaySubscriptionId,
    );

    if (
      payment.subscription_id &&
      payment.subscription_id !== data.razorpaySubscriptionId
    ) {
      throw new Error("Payment does not belong to this subscription");
    }

    const startAtMs = (rpSub.current_start ?? 0) * 1000;
    const isDeferredStart = startAtMs > Date.now();

    if (isDeferredStart) {
      logger.info(
        {
          razorpaySubId: data.razorpaySubscriptionId,
          razorpayPaymentId: data.razorpayPaymentId,
          startAtMs,
        },
        "Deferred-start AUTH payment verified; skipping DB writes (webhook handles activation)",
      );
      return {
        success: true,
        message:
          "Upgrade scheduled. New plan billing starts at end of current cycle.",
      };
    }

    const plan = await prisma.plan.findUnique({
      where: { razorpayPlanId: rpSub.plan_id },
    });

    if (plan && plan.priceInPaise !== payment.amount) {
      throw new Error("Payment amount does not match the plan price");
    }

    const amountInPaise = payment.amount;
    if (typeof amountInPaise !== "number" || Number.isNaN(amountInPaise)) {
      throw new Error("Invalid payment amount from Razorpay");
    }

    try {
      await prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.findUnique({
          where: { razorpaySubId: data.razorpaySubscriptionId },
        });

        if (!subscription) {
          throw new Error("Subscription not found");
        }

        if (subscription.userId !== data.userId) {
          throw new Error("Subscription user ID mismatch");
        }

        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: "ACTIVE",
            periodStart: new Date(rpSub.current_start! * 1000),
            periodEnd: new Date(rpSub.current_end! * 1000),
          },
        });

        const existingTransaction = await tx.transaction.findUnique({
          where: { razorpayPaymentId: data.razorpayPaymentId },
        });

        if (!existingTransaction) {
          await tx.transaction.create({
            data: {
              userId: subscription.userId,
              subscriptionId: subscription.id,
              razorpayPaymentId: data.razorpayPaymentId,
              amountInPaise,
              currency: payment.currency,
              type: "CHARGE",
              status: "SUCCESS",
            },
          });
        }
      });

      return { success: true, message: "Subscription instantly activated" };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        logger.info(
          "Frontend verification ignored; Webhook already processed this payment.",
        );
        return { success: true, message: "Subscription activated" };
      }
      throw error;
    }
  },

  async cancelSubscription(
    userId: string,
    subscriptionId: string,
    cancelReason?: string,
  ) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new Error("Subscription not found");
    }

    if (subscription.userId !== userId) {
      throw new Error("Unauthorized: You do not own this subscription");
    }

    const CANCELLABLE_STATUSES = ["ACTIVE", "PAST_DUE"] as const;

    if (!CANCELLABLE_STATUSES.includes(subscription.status as any)) {
      throw new Error(
        `Cannot cancel a subscription with status "${subscription.status}". Only ACTIVE or PAST_DUE subscriptions can be cancelled.`,
      );
    }

    const upgradeInFlight = await prisma.planChangeAudit.findFirst({
      where: {
        fromSubscriptionId: subscription.id,
        status: {
          in: [PlanChangeAuditStatus.INITIATED, PlanChangeAuditStatus.PAID],
        },
      },
    });
    if (upgradeInFlight) {
      throw Object.assign(
        new Error(
          "Cannot cancel: a plan upgrade is in progress. Complete or abandon the upgrade first.",
        ),
        { statusCode: 409 },
      );
    }

    await razorpay.subscriptions.cancel(subscription.razorpaySubId, true);

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        cancelledAt: new Date(),
        cancelReason: cancelReason ?? null,
      },
    });

    logger.info(
      { subscriptionId, cancelReason },
      "Subscription cancel-at-cycle-end requested",
    );

    return {
      subscriptionId,
      message: "Will cancel at end of current billing cycle",
    };
  },

  async getBillingHistory(userId: string) {
    return await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        subscription: {
          include: { plan: true },
        },
      },
    });
  },

  async getCurrentSubscription(userId: string) {
    const now = new Date();

    // Fetch all potential candidates
    const subs = await prisma.subscription.findMany({
      where: {
        userId,
        OR: [
          { status: "ACTIVE" },
          { status: "PAST_DUE" },
          { status: "CANCELLED", periodEnd: { gte: now } }, // Still active until cycle end
          { status: "HALTED" },
        ],
      },
      include: {
        plan: {
          include: { features: { include: { feature: true } } },
        },
      },
      // Don't just sort by createdAt; we need to evaluate them in memory
    });

    if (subs.length === 0) return null;

    // 1. Prioritize the subscription that is currently active for TODAY
    const currentlyFulfilling = subs.find(
      (sub) =>
        sub.periodStart &&
        sub.periodEnd &&
        sub.periodStart <= now &&
        sub.periodEnd >= now,
    );

    if (currentlyFulfilling) return currentlyFulfilling;

    // 2. Fallback to the most recently created one (if they are in a weird grace period)
    return subs.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
  },

  // ============================================================
  // PLAN CHANGE — UPGRADE ONLY, flat-difference charge
  // ------------------------------------------------------------
  // Single happy path:
  //   • Validate active sub + new plan + tier upgrade.
  //   • Compute chargeAmount = newPrice − oldPrice (flat, NOT day-prorated).
  //   • Reject if not an upgrade (downgrade/lateral) → user must cancel + re-subscribe.
  //   • Reject if chargeAmount < ₹1 (Razorpay minimum order).
  //   • Create deferred Razorpay sub (start_at = old sub's periodEnd).
  //   • Create one-time Razorpay order for the proration delta.
  //   • Frontend runs TWO Razorpay Checkouts in sequence:
  //       1. Pay the proration order  → instant access via order.paid webhook
  //       2. Authorize the new mandate → cycle-end takeover via subscription.charged
  //   • The OLD Razorpay sub is NOT cancelled here. It's cancelled at cycle end
  //     by the order.paid webhook, AFTER money is actually collected. This means
  //     an abandoned checkout safely leaves the user on the old plan.
  // ============================================================
  async changePlan({
    userId,
    subscriptionId,
    newPlanId,
    idempotencyKey,
  }: ChangePlanParams) {
    // ---------- Idempotency replay ----------
    const existingAudit = await prisma.planChangeAudit.findUnique({
      where: { idempotencyKey },
    });

    if (existingAudit) {
      if (
        existingAudit.userId !== userId ||
        existingAudit.fromSubscriptionId !== subscriptionId ||
        existingAudit.toPlanId !== newPlanId
      ) {
        throw Object.assign(
          new Error(
            "Idempotency-Key reused with different request parameters. Use a fresh key.",
          ),
          { statusCode: 409 },
        );
      }
      if (existingAudit.status === PlanChangeAuditStatus.FAILED) {
        throw Object.assign(
          new Error(
            "This upgrade attempt failed. Please use a new Idempotency-Key to retry.",
          ),
          { statusCode: 409 },
        );
      }

      return await this._buildIdempotentResponse(existingAudit.id);
    }

    // ---------- Load + validate ----------
    const oldSub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });

    if (!oldSub || oldSub.userId !== userId) {
      throw new Error("Subscription not found or unauthorized");
    }

    if (oldSub.status !== "ACTIVE") {
      throw new Error("You can only change an active subscription");
    }

    if (!oldSub.periodEnd || !oldSub.periodStart) {
      throw new Error(
        "Cannot change plan: current billing cycle has not been established yet.",
      );
    }

    // In-flight check: any earlier upgrade for this sub still pending?
    // A different idempotency key could otherwise create a parallel order.
    const inFlight = await prisma.planChangeAudit.findFirst({
      where: {
        fromSubscriptionId: oldSub.id,
        status: {
          in: [PlanChangeAuditStatus.INITIATED, PlanChangeAuditStatus.PAID],
        },
      },
    });

    if (inFlight) {
      throw Object.assign(
        new Error(
          "An upgrade is already in progress for this subscription. Complete the existing checkout first.",
        ),
        { statusCode: 409 },
      );
    }

    const newPlan = await prisma.plan.findUnique({
      where: { id: newPlanId },
    });

    if (!newPlan || !newPlan.isActive) {
      throw new Error("The selected plan is invalid or inactive");
    }

    if (oldSub.planId === newPlanId) {
      throw new Error("You are already on this plan");
    }

    // ---------- Direction + charge ----------
    const evaluation = evaluateUpgrade({
      oldPlan: oldSub.plan,
      newPlan,
    });

    if (!evaluation.ok) {
      if (evaluation.reason === "NOT_AN_UPGRADE") {
        throw Object.assign(
          new Error(
            "Plan change is only available for upgrades. To switch to a lower or equivalent-tier plan, cancel your current subscription and subscribe to the new plan after your current cycle ends.",
          ),
          { statusCode: 400, code: "NOT_AN_UPGRADE" },
        );
      }
      // CHARGE_BELOW_MIN
      throw Object.assign(
        new Error(
          "Upgrade amount is below the minimum chargeable value. Please choose a higher-tier plan with a larger price difference.",
        ),
        { statusCode: 400, code: "CHARGE_BELOW_MIN" },
      );
    }

    return await this._initiateImmediateUpgrade({
      oldSub,
      newPlan,
      chargeAmountInPaise: evaluation.chargeAmountInPaise,
      daysRemaining: daysRemaining(oldSub.periodEnd),
      idempotencyKey,
    });
  },

  async getPendingUpgradeAuthorization(userId: string) {
    // Find an upgrade where the proration is PAID, but the new sub isn't ACTIVATED
    const stuckUpgrade = await prisma.planChangeAudit.findFirst({
      where: {
        userId,
        status: PlanChangeAuditStatus.PAID,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!stuckUpgrade || !stuckUpgrade.toSubscriptionId) return null;

    const newSub = await prisma.subscription.findUnique({
      where: { id: stuckUpgrade.toSubscriptionId },
      include: { plan: true },
    });

    // If the new sub is already ACTIVE or PAST_DUE, they don't need to authorize
    if (!newSub || newSub.status !== "PENDING") return null;

    // Return the data needed to trigger Razorpay Checkout for the subscription
    return {
      razorpaySubscriptionId: newSub.razorpaySubId,
      amountInPaise: newSub.plan.priceInPaise,
      currency: newSub.plan.currency,
    };
  },

  // ------------------------------------------------------------
  // Instant upgrade with prorated charge
  // ------------------------------------------------------------
  async _initiateImmediateUpgrade(args: {
    oldSub: NonNullable<
      Awaited<ReturnType<typeof prisma.subscription.findUnique>>
    > & {
      plan: NonNullable<Awaited<ReturnType<typeof prisma.plan.findUnique>>>;
    };
    newPlan: NonNullable<Awaited<ReturnType<typeof prisma.plan.findUnique>>>;
    chargeAmountInPaise: number;
    daysRemaining: number;
    idempotencyKey: string;
  }) {
    const {
      oldSub,
      newPlan,
      chargeAmountInPaise,
      daysRemaining,
      idempotencyKey,
    } = args;

    // 1. Create deferred-start Razorpay sub. Mandate auth happens later via
    //    Razorpay Checkout; first real charge fires at oldSub.periodEnd.
    const startAt = Math.floor(oldSub.periodEnd!.getTime() / 1000);
    const newRpSub = await razorpay.subscriptions.create({
      plan_id: newPlan.razorpayPlanId,
      total_count: newPlan.totalCount,
      start_at: startAt,
    });
    console.log("newRpSub", newRpSub);

    logger.info(
      {
        oldSubId: oldSub.id,
        newRazorpaySubId: newRpSub.id,
        startAt,
      },
      "Created replacement Razorpay subscription for upgrade",
    );

    // 2. Create one-time Razorpay order for the proration delta. Notes carry
    //    our internal IDs so order.paid webhook can reconcile.
    //    The result is asserted because the Razorpay SDK exposes both promise
    //    and node-callback overloads of `create`, and ReturnType<> resolves
    //    to the latter (`void`).
    const prorationOrder = (await razorpay.orders
      .create({
        amount: chargeAmountInPaise,
        currency: newPlan.currency,
        receipt: `proration-${oldSub.id.slice(0, 8)}-${Date.now()}`,
        notes: {
          type: "PLAN_UPGRADE_PRORATION",
          userId: oldSub.userId,
          oldSubscriptionId: oldSub.id,
          oldRazorpaySubId: oldSub.razorpaySubId,
          newRazorpaySubId: newRpSub.id,
          oldPlanId: oldSub.planId,
          newPlanId: newPlan.id,
          idempotencyKey,
        },
      })
      .catch(async (err: unknown) => {
        // Roll back the Razorpay sub we just created — proration order failed.
        await razorpay.subscriptions.cancel(newRpSub.id, false).catch(() => {});
        throw err;
      })) as { id: string; amount: number; currency: string };

    console.log("prorationOrder", prorationOrder);

    // 3. Mirror in DB atomically. The OLD Razorpay sub is NOT cancelled here;
    //    that's deferred to the order.paid webhook so an abandoned checkout
    //    leaves the user safely on their old plan.
    const { newSub, audit } = await prisma.$transaction(async (tx) => {
      const created = await tx.subscription.create({
        data: {
          userId: oldSub.userId,
          noshId: oldSub.noshId,
          planId: newPlan.id,
          razorpaySubId: newRpSub.id,
          status: "PENDING",
          replacesSubscriptionId: oldSub.id,
        },
      });

      await tx.transaction.create({
        data: {
          userId: oldSub.userId,
          subscriptionId: created.id,
          razorpayOrderId: prorationOrder.id,
          amountInPaise: chargeAmountInPaise,
          currency: newPlan.currency,
          type: "PRORATION",
          status: "PENDING",
        },
      });

      const auditRow = await tx.planChangeAudit.create({
        data: {
          userId: oldSub.userId,
          fromSubscriptionId: oldSub.id,
          toSubscriptionId: created.id,
          fromPlanId: oldSub.planId,
          toPlanId: newPlan.id,
          direction: ChangeDirection.UPGRADE,
          chargeAmountInPaise,
          daysRemaining,
          razorpayOrderId: prorationOrder.id,
          idempotencyKey,
          status: PlanChangeAuditStatus.INITIATED,
        },
      });

      return { newSub: created, audit: auditRow };
    });

    logger.info(
      {
        oldSubId: oldSub.id,
        newSubId: newSub.id,
        newPlanId: newPlan.id,
        chargeAmountInPaise,
        razorpayOrderId: prorationOrder.id,
        auditId: audit.id,
      },
      "Immediate upgrade initiated; awaiting order.paid",
    );

    return {
      mode: "UPGRADE_IMMEDIATE" as const,
      direction: ChangeDirection.UPGRADE,
      chargeAmountInPaise,
      currency: newPlan.currency,
      // Step 1 of frontend Razorpay Checkout: pay this order.
      prorationOrder: {
        razorpayOrderId: prorationOrder.id,
        amountInPaise: chargeAmountInPaise,
        currency: newPlan.currency,
      },
      // Step 2 of frontend Razorpay Checkout: authorize the new mandate.
      newSubscription: {
        razorpaySubscriptionId: newRpSub.id,
        amountInPaise: newPlan.priceInPaise,
        currency: newPlan.currency,
        totalCount: newPlan.totalCount,
        effectiveAt: oldSub.periodEnd!.toISOString(),
      },
      message:
        "Pay the proration order first to unlock the new plan instantly. Then authorize the new mandate so billing continues at cycle end.",
    };
  },

  // Re-build the change-plan response from a previously-stored audit row.
  // Used by the Idempotency-Key short-circuit so a retry returns the same shape.
  async _buildIdempotentResponse(auditId: string) {
    const audit = await prisma.planChangeAudit.findUnique({
      where: { id: auditId },
    });
    if (!audit) throw new Error("Audit row vanished mid-request");

    const newSub = audit.toSubscriptionId
      ? await prisma.subscription.findUnique({
          where: { id: audit.toSubscriptionId },
          include: { plan: true },
        })
      : null;

    if (!newSub) {
      throw new Error(
        "Replacement subscription missing for this idempotency key.",
      );
    }

    if (!audit.razorpayOrderId) {
      throw new Error("Audit row missing razorpayOrderId — corrupt state.");
    }

    return {
      mode: "UPGRADE_IMMEDIATE" as const,
      direction: audit.direction,
      chargeAmountInPaise: audit.chargeAmountInPaise,
      currency: newSub.plan.currency,
      prorationOrder: {
        razorpayOrderId: audit.razorpayOrderId,
        amountInPaise: audit.chargeAmountInPaise,
        currency: newSub.plan.currency,
      },
      newSubscription: {
        razorpaySubscriptionId: newSub.razorpaySubId,
        amountInPaise: newSub.plan.priceInPaise,
        currency: newSub.plan.currency,
        totalCount: newSub.plan.totalCount,
        effectiveAt: audit.effectiveAt?.toISOString() ?? null,
      },
      message:
        "Idempotent replay — same upgrade is already initiated; finish the original Razorpay Checkout.",
      idempotent: true,
    };
  },
};
