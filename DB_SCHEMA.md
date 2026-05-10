Based on the updated `schema.prisma` file you provided, here is the corrected and complete Database Schema documentation.

This schema includes the newly added `tier` fields, the new `PlanChangeAudit` table for upgrade tracking, and the updated Enums.

---

# Payment Service — Database Schema

## Enums

| Enum Name                 | Values                                                                                          | Description                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **PlanPeriod**            | `MONTHLY`, `YEARLY`                                                                             | The billing frequency of the plan.                                                    |
| **SubscriptionStatus**    | `PENDING`, `ACTIVE`, `AUTHENTICATED`, `CANCELLED`, `PAST_DUE`, `HALTED`, `COMPLETED`, `EXPIRED` | The current state of the subscription. Note the addition of `AUTHENTICATED`.          |
| **TransactionType**       | `AUTH`, `CHARGE`, `REFUND`, `ADDON`, `PRORATION`                                                | The nature of the transaction. Note the addition of `PRORATION` for instant upgrades. |
| **TransactionStatus**     | `PENDING`, `SUCCESS`, `FAILED`                                                                  | The outcome of the payment attempt.                                                   |
| **ChangeDirection**       | `UPGRADE`                                                                                       | Direction of a plan change (currently only upgrades are supported).                   |
| **PlanChangeAuditStatus** | `INITIATED`, `PAID`, `ACTIVATED`, `FAILED`                                                      | Lifecycle stages of a plan change attempt.                                            |

---

## 1. features

_Catalog of access features granted by subscriptions._

| Column        | DB Column     | Type          | Constraints / Defaults |
| ------------- | ------------- | ------------- | ---------------------- |
| `id`          | `id`          | String (UUID) | Primary Key            |
| `featureKey`  | `feature_key` | String        | UNIQUE, Not Null       |
| `name`        | `name`        | String        | Not Null               |
| `description` | `description` | String        | Nullable               |
| `createdAt`   | `created_at`  | DateTime      | Default: `now()`       |
| `updatedAt`   | `updated_at`  | DateTime      | Auto-updated           |

---

## 2. plans

_The billing plans offered to users._

| Column           | DB Column          | Type                | Constraints / Defaults |
| ---------------- | ------------------ | ------------------- | ---------------------- |
| `id`             | `id`               | String (UUID)       | Primary Key            |
| `name`           | `name`             | String              | Not Null               |
| `description`    | `description`      | String              | Nullable               |
| `razorpayPlanId` | `razorpay_plan_id` | String              | UNIQUE, Not Null       |
| `priceInPaise`   | `price_in_paise`   | Int                 | Not Null               |
| `currency`       | `currency`         | String              | Default: `"INR"`       |
| `period`         | `period`           | Enum (`PlanPeriod`) | Not Null               |
| `interval`       | `interval`         | Int                 | Default: `1`           |
| `totalCount`     | `total_count`      | Int                 | Not Null               |
| `tier`           | `tier`             | Int                 | Default: `0`           |
| `isActive`       | `is_active`        | Boolean             | Default: `true`        |
| `createdAt`      | `created_at`       | DateTime            | Default: `now()`       |
| `updatedAt`      | `updated_at`       | DateTime            | Auto-updated           |

---

## 3. plan_features_mapping

_Join table mapping plans to the features they unlock._

| Column      | DB Column    | Type          | Constraints / Defaults           |
| ----------- | ------------ | ------------- | -------------------------------- |
| `planId`    | `plan_id`    | String (UUID) | Composite PK, FK → `plans.id`    |
| `featureId` | `feature_id` | String (UUID) | Composite PK, FK → `features.id` |
| `createdAt` | `created_at` | DateTime      | Default: `now()`                 |

---

## 4. subscriptions

_Customer ledger of active and past subscriptions._

| Column                   | DB Column                  | Type                        | Constraints / Defaults                 |
| ------------------------ | -------------------------- | --------------------------- | -------------------------------------- |
| `id`                     | `id`                       | String (UUID)               | Primary Key                            |
| `userId`                 | `user_id`                  | String                      | Indexed, Not Null                      |
| `noshId`                 | `nosh_id`                  | String                      | Indexed, Not Null                      |
| `planId`                 | `plan_id`                  | String (UUID)               | Indexed, FK → `plans.id`               |
| `razorpaySubId`          | `razorpay_sub_id`          | String                      | UNIQUE, Not Null                       |
| `status`                 | `status`                   | Enum (`SubscriptionStatus`) | Indexed, Default: `PENDING`            |
| `periodStart`            | `period_start`             | DateTime                    | Nullable                               |
| `periodEnd`              | `period_end`               | DateTime                    | Nullable                               |
| `cancelledAt`            | `cancelled_at`             | DateTime                    | Nullable                               |
| `cancelReason`           | `cancel_reason`            | String                      | Nullable                               |
| `replacesSubscriptionId` | `replaces_subscription_id` | String (UUID)               | UNIQUE, Nullable (links upgraded subs) |
| `createdAt`              | `created_at`               | DateTime                    | Default: `now()`                       |
| `updatedAt`              | `updated_at`               | DateTime                    | Auto-updated                           |

---

## 5. transactions

_Records of all individual payment attempts and outcomes._

| Column              | DB Column           | Type                       | Constraints / Defaults            |
| ------------------- | ------------------- | -------------------------- | --------------------------------- |
| `id`                | `id`                | String (UUID)              | Primary Key                       |
| `userId`            | `user_id`           | String                     | Indexed, Not Null                 |
| `subscriptionId`    | `subscription_id`   | String (UUID)              | Nullable, FK → `subscriptions.id` |
| `razorpayOrderId`   | `razorpay_order_id` | String                     | UNIQUE, Nullable                  |
| `razorpayPaymentId` | `razorpay_pay_id`   | String                     | UNIQUE, Nullable                  |
| `amountInPaise`     | `amount_in_paise`   | Int                        | Not Null                          |
| `currency`          | `currency`          | String                     | Default: `"INR"`                  |
| `type`              | `type`              | Enum (`TransactionType`)   | Not Null                          |
| `status`            | `status`            | Enum (`TransactionStatus`) | Default: `PENDING`                |
| `failureReason`     | `failure_reason`    | String                     | Nullable                          |
| `createdAt`         | `created_at`        | DateTime                   | Default: `now()`                  |
| `updatedAt`         | `updated_at`        | DateTime                   | Auto-updated                      |

---

## 6. plan_change_audits

_Audit trail tracking plan upgrades and proration charges._

| Column                | DB Column                | Type                           | Constraints / Defaults        |
| --------------------- | ------------------------ | ------------------------------ | ----------------------------- |
| `id`                  | `id`                     | String (UUID)                  | Primary Key                   |
| `userId`              | `user_id`                | String                         | Indexed, Not Null             |
| `fromSubscriptionId`  | `from_subscription_id`   | String (UUID)                  | Indexed, Not Null             |
| `toSubscriptionId`    | `to_subscription_id`     | String (UUID)                  | Nullable                      |
| `fromPlanId`          | `from_plan_id`           | String (UUID)                  | Not Null                      |
| `toPlanId`            | `to_plan_id`             | String (UUID)                  | Not Null                      |
| `direction`           | `direction`              | Enum (`ChangeDirection`)       | Not Null                      |
| `chargeAmountInPaise` | `charge_amount_in_paise` | Int                            | Default: `0`                  |
| `daysRemaining`       | `days_remaining`         | Int                            | Not Null                      |
| `razorpayOrderId`     | `razorpay_order_id`      | String                         | UNIQUE, Nullable              |
| `idempotencyKey`      | `idempotency_key`        | String                         | UNIQUE, Nullable              |
| `status`              | `status`                 | Enum (`PlanChangeAuditStatus`) | Indexed, Default: `INITIATED` |
| `effectiveAt`         | `effective_at`           | DateTime                       | Nullable                      |
| `createdAt`           | `created_at`             | DateTime                       | Default: `now()`              |
| `updatedAt`           | `updated_at`             | DateTime                       | Auto-updated                  |

---

## 7. webhook_logs

_Idempotency logging for Razorpay webhooks._

| Column            | DB Column           | Type          | Constraints / Defaults |
| ----------------- | ------------------- | ------------- | ---------------------- |
| `id`              | `id`                | String (UUID) | Primary Key            |
| `razorpayEventId` | `razorpay_event_id` | String        | UNIQUE, Not Null       |
| `eventType`       | `event_type`        | String        | Not Null               |
| `payload`         | `payload`           | Json          | Not Null               |
| `processed`       | `processed`         | Boolean       | Default: `false`       |
| `retryCount`      | `retry_count`       | Int           | Default: `0`           |
| `processingError` | `processing_error`  | String        | Nullable               |
| `createdAt`       | `created_at`        | DateTime      | Default: `now()`       |
| `updatedAt`       | `updated_at`        | DateTime      | Auto-updated           |

---

## Relationships

| Relation                         | Type        | Description                                                               |
| -------------------------------- | ----------- | ------------------------------------------------------------------------- |
| `Plan` ↔ `PlanFeatureMapping`    | One-to-Many | A plan unlocks multiple features.                                         |
| `Feature` ↔ `PlanFeatureMapping` | One-to-Many | A feature can belong to multiple plans.                                   |
| `Plan` ↔ `Subscription`          | One-to-Many | A subscription is tied to a specific plan.                                |
| `Subscription` ↔ `Transaction`   | One-to-Many | A subscription records multiple transactions (charges, retries, refunds). |
