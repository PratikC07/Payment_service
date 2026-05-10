# Payment Service — Full API Documentation

---

## Table of Contents

1. [Base URL & Authentication](https://www.google.com/search?q=%23base-url--authentication)
2. [Error Format](https://www.google.com/search?q=%23error-format)
3. [Plans](https://www.google.com/search?q=%23plans)
4. [Subscriptions (Customer Facing)](https://www.google.com/search?q=%23subscriptions)
5. [Devices (Hardware Access)](https://www.google.com/search?q=%23devices)
6. [Admin (Internal Tools)](https://www.google.com/search?q=%23admin)

---

## Base URL & Authentication

```
Base URL: /api

```

### Required Headers

| Header               | Value              | Description                                                                                    |
| -------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `x-internal-api-key` | `<your-api-key>`   | Internal service key. Must be present on every request except `/health` and `/api/webhooks/*`. |
| `x-user-id`          | `<userId>`         | The logged-in user's ID. Required on all `/subscriptions/*` endpoints.                         |
| `Content-Type`       | `application/json` | Required on all POST requests.                                                                 |
| `Idempotency-Key`    | `<uuid>`           | Required ONLY for `POST /api/subscriptions/change-plan` to prevent duplicate charges.          |

---

## Error Format

All standard errors return the same shape:

```json
{
  "success": false,
  "message": "Human-readable error message"
}
```

Validation errors (400) return field-level details:

```json
{
  "success": false,
  "message": "Validation Error",
  "errors": {
    "planId": ["Invalid Plan ID format"],
    "noshId": ["Nosh Device ID is required"]
  }
}
```

---

## Plans

### GET `/api/plans`

Returns all active plans with their features. Use this to build the plan selection screen.

**Response `200**`

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Pro Monthly",
      "description": "Full access, billed monthly",
      "priceInPaise": 49900,
      "currency": "INR",
      "period": "MONTHLY",
      "interval": 1,
      "totalCount": 12,
      "tier": 1,
      "isActive": true,
      "features": [
        {
          "featureKey": "UNLIMITED_RECIPES",
          "name": "Unlimited Recipes",
          "description": "Access all recipe categories"
        }
      ]
    }
  ]
}
```

### GET `/api/plans/:id`

Returns a single plan by its UUID.

**Response `200**` — same shape as a single item from the list above.

---

## Subscriptions

All subscription endpoints require the `x-user-id` header.

### 1. Initiate Subscription

`POST /api/subscriptions/initiate`

Creates a new subscription on Razorpay and returns the checkout details.

**Request Body**

```json
{
  "noshId": "NOSH-DEVICE-001",
  "planId": "uuid-of-the-plan"
}
```

**Response `200**`

```json
{
  "success": true,
  "data": {
    "razorpaySubscriptionId": "sub_XXXXXXXXXXXXXXXX",
    "razorpayKeyId": "rzp_live_XXXXXXXX",
    "amountInPaise": 49900,
    "currency": "INR",
    "totalCount": 12
  }
}
```

### 2. Verify Payment

`POST /api/subscriptions/verify`

Call this immediately after the Razorpay checkout succeeds on the frontend to activate the subscription instantly.

**Request Body**

```json
{
  "razorpaySubscriptionId": "sub_XXXXXXXXXXXXXXXX",
  "razorpayPaymentId": "pay_XXXXXXXXXXXXXXXX",
  "razorpaySignature": "signature-string-from-razorpay-callback"
}
```

**Response `200**`

```json
{
  "success": true,
  "message": "Subscription instantly activated"
}
```

### 3. Get Current Subscription

`GET /api/subscriptions/me`

Returns the user's active (or most relevant) subscription. Returns `null` if none exists.

**Response `200**`

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "userId": "user-123",
    "noshId": "NOSH-DEVICE-001",
    "planId": "uuid",
    "razorpaySubId": "sub_XXXXXXXXXXXXXXXX",
    "status": "ACTIVE",
    "periodStart": "2026-05-01T00:00:00.000Z",
    "periodEnd": "2026-06-01T00:00:00.000Z",
    "cancelledAt": null,
    "cancelReason": null,
    "replacesSubscriptionId": null,
    "plan": { ... }
  }
}

```

### 4. Get Billing History

`GET /api/subscriptions/history`

Returns all past transactions for the user, newest first.

**Response `200**`

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "razorpayPaymentId": "pay_SmqvKzggTZIgoZ",
      "amountInPaise": 59900,
      "currency": "INR",
      "type": "CHARGE",
      "status": "SUCCESS",
      "createdAt": "2026-05-08T11:25:46.310Z"
    }
  ]
}
```

### 5. Cancel Subscription

`POST /api/subscriptions/:subscriptionId/cancel`

Schedules the subscription to cancel at the end of the current billing cycle.

**Request Body**

```json
{
  "cancelReason": "Optional feedback"
}
```

**Response `200**`

```json
{
  "success": true,
  "message": "Subscription will be cancelled at the end of the current billing cycle.",
  "data": {
    "subscriptionId": "uuid",
    "message": "Will cancel at end of current billing cycle"
  }
}
```

### 6. Change Plan (Instant Upgrade)

`POST /api/subscriptions/change-plan`

**Requires `Idempotency-Key` header.** Charges the prorated flat difference and sets up the new mandate.

**Request Body**

```json
{
  "subscriptionId": "uuid-of-current-subscription",
  "newPlanId": "uuid-of-target-plan"
}
```

**Response `200**`

```json
{
  "success": true,
  "data": {
    "mode": "UPGRADE_IMMEDIATE",
    "direction": "UPGRADE",
    "chargeAmountInPaise": 30000,
    "currency": "INR",
    "razorpayKeyId": "rzp_live_XXXXXXXX",
    "prorationOrder": {
      "razorpayOrderId": "order_XXXXXXXXXXXXXXXX",
      "amountInPaise": 30000,
      "currency": "INR"
    },
    "newSubscription": {
      "razorpaySubscriptionId": "sub_XXXXXXXXXXXXXXXX",
      "amountInPaise": 49900,
      "currency": "INR",
      "totalCount": 12,
      "effectiveAt": "2026-06-07T18:30:00.000Z"
    },
    "message": "Pay the proration order first to unlock the new plan instantly. Then authorize the new mandate so billing continues at cycle end."
  }
}
```

### 7. Get Pending Upgrade

`GET /api/subscriptions/pending-upgrade`

Checks if the user has paid for a plan upgrade (proration order) but hasn't yet completed the new subscription mandate checkout. Use this to resume interrupted upgrade flows on app launch.

**Response `200` (If an upgrade is stuck)**

```json
{
  "success": true,
  "data": {
    "razorpaySubscriptionId": "sub_XXXXXXXXXXXXXXXX",
    "amountInPaise": 49900,
    "currency": "INR",
    "razorpayKeyId": "rzp_test_XXXXXX"
  }
}
```

**Response `200` (If no upgrade is stuck)**

```json
{
  "success": true,
  "data": null
}
```

---

## Devices

### GET `/api/devices/:noshId/subscription`

Designed for device-level access control. Checks if the machine has active features unlocked.

**Response `200**`

```json
{
  "success": true,
  "data": {
    "isActive": true,
    "planName": "Pro Monthly",
    "periodEnd": "2026-06-01T00:00:00.000Z",
    "unlockedFeatures": ["UNLIMITED_RECIPES", "MEAL_PLANNER"]
  }
}
```

---

## Admin

_Note: These endpoints are meant for internal admin dashboards to create products._

### POST `/api/admin/features`

Creates a new unlockable feature.

**Request Body**

```json
{
  "featureKey": "UNLIMITED_RECIPES",
  "name": "Unlimited Recipes",
  "description": "Allows endless cooking"
}
```

### POST `/api/admin/plans`

Creates a new billing plan and automatically registers it with Razorpay.

**Request Body**

```json
{
  "name": "Pro Monthly",
  "description": "All access",
  "priceInPaise": 49900,
  "currency": "INR",
  "period": "MONTHLY",
  "interval": 1,
  "totalCount": 12,
  "tier": 1,
  "featureIds": ["uuid-of-feature-1", "uuid-of-feature-2"]
}
```
