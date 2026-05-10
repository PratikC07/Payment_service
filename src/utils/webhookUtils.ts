// src/utils/webhookUtils.ts
import crypto from "crypto";
import { env } from "../config/env.js";

export const verifyRazorpaySignature = (
  rawBody: string,
  signature: string,
): boolean => {
  const expectedSignature = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch {
    // Buffer lengths differ → definitely invalid
    return false;
  }
};

export const verifyFrontendSignature = (
  paymentId: string,
  subscriptionId: string,
  signature: string,
): boolean => {
  const text = paymentId + "|" + subscriptionId;
  const expectedSignature = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(text)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
};
