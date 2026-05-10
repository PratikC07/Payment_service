// src/utils/proration.util.ts
//
// Plan-change pricing math. Pure functions — no DB, no Razorpay. Easy to unit-test.
//
// We use a FLAT-DIFFERENCE model (not day-prorated):
//
//   chargeAmount = newPlan.priceInPaise - oldPlan.priceInPaise
//
// /change-plan is UPGRADE-ONLY. Downgrades and lateral switches must use
// cancel + re-subscribe; this keeps the codebase free of deferred-change state
// machines, abort flows, and partially-billed subscriptions.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Razorpay's minimum order amount is ₹1 (100 paise). Upgrades whose flat
// difference falls below this are rejected — see decision (5) in the design.
export const MIN_RAZORPAY_ORDER_PAISE = 100;

interface PlanLike {
  tier: number;
  priceInPaise: number;
}

/**
 * Whole-day count between `now` and `periodEnd`. Floor — partial days don't count.
 * Used only for audit logging (PlanChangeAudit.daysRemaining).
 */
export function daysRemaining(periodEnd: Date, now: Date = new Date()): number {
  const ms = periodEnd.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / MS_PER_DAY);
}

/**
 * Result type for `evaluateUpgrade`. A discriminated union so callers can
 * switch cleanly: `if (!result.ok) return 400(result.reason)`.
 */
export type UpgradeEvaluation =
  | { ok: true; chargeAmountInPaise: number }
  | {
      ok: false;
      reason: "NOT_AN_UPGRADE" | "CHARGE_BELOW_MIN";
      chargeAmountInPaise: number;
    };

/**
 * Decide whether a plan change qualifies as a chargeable upgrade.
 *
 * Two reject paths:
 *   - NOT_AN_UPGRADE   → newPlan.tier <= oldPlan.tier (downgrade or lateral)
 *   - CHARGE_BELOW_MIN → upgrade gap is below Razorpay's minimum order amount
 *
 * Both should produce a 400 with an actionable message ("cancel and re-subscribe").
 */
export function evaluateUpgrade(args: {
  oldPlan: PlanLike;
  newPlan: PlanLike;
}): UpgradeEvaluation {
  const isUpgrade = args.newPlan.tier > args.oldPlan.tier;
  const charge = args.newPlan.priceInPaise - args.oldPlan.priceInPaise;

  if (!isUpgrade) {
    return {
      ok: false,
      reason: "NOT_AN_UPGRADE",
      chargeAmountInPaise: Math.max(0, charge),
    };
  }

  if (charge < MIN_RAZORPAY_ORDER_PAISE) {
    return {
      ok: false,
      reason: "CHARGE_BELOW_MIN",
      chargeAmountInPaise: charge,
    };
  }

  return { ok: true, chargeAmountInPaise: charge };
}
