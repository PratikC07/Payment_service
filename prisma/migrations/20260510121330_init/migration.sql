-- CreateEnum
CREATE TYPE "PlanPeriod" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'AUTHENTICATED', 'CANCELLED', 'PAST_DUE', 'HALTED', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('AUTH', 'CHARGE', 'REFUND', 'ADDON', 'PRORATION');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ChangeDirection" AS ENUM ('UPGRADE');

-- CreateEnum
CREATE TYPE "PlanChangeAuditStatus" AS ENUM ('INITIATED', 'PAID', 'ACTIVATED', 'FAILED');

-- CreateTable
CREATE TABLE "features" (
    "id" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "razorpay_plan_id" TEXT NOT NULL,
    "price_in_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "period" "PlanPeriod" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "total_count" INTEGER NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features_mapping" (
    "plan_id" TEXT NOT NULL,
    "feature_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_features_mapping_pkey" PRIMARY KEY ("plan_id","feature_id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "nosh_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "razorpay_sub_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "replaces_subscription_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "razorpay_order_id" TEXT,
    "razorpay_pay_id" TEXT,
    "amount_in_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_change_audits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_subscription_id" TEXT NOT NULL,
    "to_subscription_id" TEXT,
    "from_plan_id" TEXT NOT NULL,
    "to_plan_id" TEXT NOT NULL,
    "direction" "ChangeDirection" NOT NULL,
    "charge_amount_in_paise" INTEGER NOT NULL DEFAULT 0,
    "days_remaining" INTEGER NOT NULL,
    "razorpay_order_id" TEXT,
    "idempotency_key" TEXT,
    "status" "PlanChangeAuditStatus" NOT NULL DEFAULT 'INITIATED',
    "effective_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_change_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" TEXT NOT NULL,
    "razorpay_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "processing_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "features_feature_key_key" ON "features"("feature_key");

-- CreateIndex
CREATE UNIQUE INDEX "plans_razorpay_plan_id_key" ON "plans"("razorpay_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_razorpay_sub_id_key" ON "subscriptions"("razorpay_sub_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_replaces_subscription_id_key" ON "subscriptions"("replaces_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "subscriptions_nosh_id_idx" ON "subscriptions"("nosh_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_razorpay_order_id_key" ON "transactions"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_razorpay_pay_id_key" ON "transactions"("razorpay_pay_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_idx" ON "transactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_change_audits_razorpay_order_id_key" ON "plan_change_audits"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_change_audits_idempotency_key_key" ON "plan_change_audits"("idempotency_key");

-- CreateIndex
CREATE INDEX "plan_change_audits_user_id_idx" ON "plan_change_audits"("user_id");

-- CreateIndex
CREATE INDEX "plan_change_audits_from_subscription_id_idx" ON "plan_change_audits"("from_subscription_id");

-- CreateIndex
CREATE INDEX "plan_change_audits_status_idx" ON "plan_change_audits"("status");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_logs_razorpay_event_id_key" ON "webhook_logs"("razorpay_event_id");

-- AddForeignKey
ALTER TABLE "plan_features_mapping" ADD CONSTRAINT "plan_features_mapping_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features_mapping" ADD CONSTRAINT "plan_features_mapping_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
