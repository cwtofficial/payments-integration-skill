# Razorpay

Docs: https://razorpay.com/docs — API: https://razorpay.com/docs/api. India-focused (cards, UPI, netbanking, wallets, EMI); also Malaysia and international cards.

## Keys
`key_id` (`rzp_test_…`/`rzp_live_…`, safe for client) and `key_secret` (server). Basic auth with `key_id:key_secret`. Webhook secret is **separate**, set per webhook in the dashboard.

## Amounts
Integer minor units (paise). `amount: 50000` = ₹500.

## Payment lifecycle
`created → authorized → captured` (or `failed`; later `refunded`). An `authorized` payment is not money you have. Enable auto-capture in the dashboard or on the order (`payment_capture`), or call `POST /payments/:id/capture` with the amount. Authorized payments not captured within the window are auto-refunded.

## Checkout flow

```js
// 1. server creates an order
const order = await razorpay.orders.create({
  amount: dbOrder.amountMinor, currency: 'INR', receipt: payment.reference, notes: { orderId: dbOrder.id },
});
// 2. client opens Razorpay Checkout with key_id + order.id; on success the handler receives
//    razorpay_payment_id, razorpay_order_id, razorpay_signature → send to server
```

```js
// 3. server verifies the checkout signature
const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET)
  .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
// constant-time compare with razorpay_signature
// AND check razorpay_order_id === the order ID you stored for this dbOrder
```

The checkout signature proves the payment ID belongs to that order ID — it does not by itself prove capture. For fulfilment, rely on `payment.captured` / `order.paid` webhooks, or fetch the payment (`GET /payments/:id`) and check `status === 'captured'`, `amount`, `currency`, `order_id`.

## Webhooks
- Header `X-Razorpay-Signature`: HMAC-SHA256 (hex) of the raw body with the **webhook secret**. SDK: `Razorpay.validateWebhookSignature(rawBody, signature, secret)`.
- Header `x-razorpay-event-id` is unique per event — dedupe on it.
- Retries on non-2xx for up to 24 hours; webhooks can be disabled after sustained failures.
- Key events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.created`/`refund.processed`/`refund.failed`, `payment.dispute.*`, `subscription.*`, `payout.*` (RazorpayX), `transfer.*` (Route).

## Subscriptions
Plans + `POST /subscriptions`, customer authorizes via Checkout with `subscription_id`. Events: `subscription.authenticated`, `activated`, `charged`, `pending`, `halted`, `cancelled`, `completed`. RBI e-mandate rules apply to recurring card/UPI payments (pre-debit notifications, limits for auto-debit without additional auth).

## Payouts (RazorpayX)
Contacts → Fund accounts (bank/VPA) → `POST /payouts` with `reference_id` and header `X-Payout-Idempotency`. Statuses: `queued`, `pending`, `processing`, `processed`, `reversed`, `cancelled`, `rejected`, `failed`. Handle `payout.reversed`/`payout.failed`/`payout.rejected` by restoring the balance.

## Route (marketplace splits)
Linked accounts + transfers on payment (`transfers` array on order or `POST /payments/:id/transfers`). Reversals on refund as per policy.

## Gotchas
- Verifying the checkout signature with the webhook secret, or the webhook with `key_secret`.
- Treating `authorized` as paid; never capturing.
- Not checking the returned order ID matches the server-side order.
- Fulfilling from the client handler without server verification.

## Testing
Test cards/UPI: https://razorpay.com/docs/payments/payments/test-card-details.
