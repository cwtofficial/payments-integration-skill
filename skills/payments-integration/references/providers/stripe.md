# Stripe

Docs: https://docs.stripe.com — API reference: https://docs.stripe.com/api. Confirm event names and SDK signatures against the API version pinned on the account (`Stripe-Version`) or in the SDK.

## Keys and modes
- `pk_test_`/`pk_live_` publishable (client), `sk_test_`/`sk_live_` secret (server), `rk_` restricted keys. Webhook endpoint secrets are `whsec_…` and are per endpoint (and the Stripe CLI gives its own).
- Every object has `livemode`. Check it in webhook handlers if a single code path could see both.
- Pin the API version in the SDK constructor so upgrades are deliberate.

## Amounts
Integer minor units (`amount: 2000` = $20.00). Zero-decimal currencies (JPY, KRW, VND, etc.) are whole units. Three-decimal currencies (BHD, JOD, KWD, OMR, TND) are in minor units but must be divisible by 10. Stripe has per-currency minimums (e.g. $0.50 USD). Current list: https://docs.stripe.com/currencies.

## Choosing the integration
- **Checkout Sessions** (hosted page or embedded): default. Handles payment methods, 3DS, subscriptions, tax, and promotion codes.
- **Payment Element + PaymentIntents**: custom page. Server creates the PaymentIntent with the amount; client gets only `client_secret` and calls `stripe.confirmPayment`.
- **SetupIntents**: save a payment method for later without charging.
- Avoid the legacy Charges API and Sources for new code.

## One-off payment (Checkout)

```js
// server
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [{ price: product.stripePriceId, quantity: 1 }],   // price from your DB, not the client
  client_reference_id: order.id,
  metadata: { orderId: order.id },
  success_url: `${APP_URL}/orders/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${APP_URL}/cart`,
}, { idempotencyKey: `checkout:${order.id}:${attempt}` });
```

Fulfil in the webhook:
- `checkout.session.completed` → if `payment_status === 'paid'` fulfil; if `'unpaid'` (async methods) wait for
- `checkout.session.async_payment_succeeded` → fulfil; `checkout.session.async_payment_failed` → mark failed.
- `checkout.session.expired` → release the order.

Verify `session.amount_total` and `session.currency` against your order, and find the order via `client_reference_id`/`metadata`, before fulfilling.

## Webhooks

```js
// Express — raw body on this route only
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send('Invalid signature');
  }
  // dedupe on event.id, then process
  res.sendStatus(200);
});
```

- Header `Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]`. Signed payload is `${t}.${rawBody}`, HMAC-SHA256 with the endpoint secret. Default timestamp tolerance 300s. There can be several `v1` values during secret rotation.
- Retries with exponential backoff for up to 3 days in live mode.
- Event IDs (`evt_…`) are unique — dedupe on them. Different events about the same object are common, so fulfilment must also be idempotent on the PaymentIntent/Session ID.
- Ordering isn't guaranteed. For subscriptions, fetch the latest object (`stripe.subscriptions.retrieve`) when processing `customer.subscription.*` if you depend on ordering.
- "Thin" events (`v2` event destinations) contain only a reference; fetch the object.

Key events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.processing`, `charge.refunded`, `refund.updated`/`refund.failed`, `charge.dispute.created`/`closed`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `customer.subscription.created`/`updated`/`deleted`, `payout.paid`/`payout.failed`, `account.updated` (Connect).

## Idempotency
`Idempotency-Key` header on POSTs (`{ idempotencyKey }` option in SDKs). Keys expire after ~24h. Reusing a key with different parameters returns an error — a useful signal of a bug.

## Subscriptions (Billing)
Create via Checkout (`mode: 'subscription'`) or `subscriptions.create` with `payment_behavior: 'default_incomplete'` and confirm the first invoice's PaymentIntent on the client. Statuses: `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `unpaid`, `canceled`, `paused`. Customer portal (`billingPortal.sessions.create`) handles cancel/update card. See `../subscriptions.md`.

## Connect (marketplaces)
- Destination charges: `transfer_data: { destination: acct }`, `application_fee_amount`. Platform is merchant of record.
- Separate charges and transfers: charge on platform, later `transfers.create({ destination, amount, transfer_group })` — idempotency key required in practice.
- Direct charges: `{ stripeAccount: acct }` request option (`Stripe-Account` header).
- Webhooks for connected accounts arrive at a Connect endpoint with `event.account` set — route by it.
- Check `charges_enabled`/`payouts_enabled` before letting a seller sell; refunds with `reverse_transfer: true` and `refund_application_fee: true` as policy dictates.

## Gotchas
- `constructEvent` fails if the body was parsed — the number one Stripe webhook issue.
- Using the API secret key instead of `whsec_` for verification.
- Using the CLI's `whsec_` in production or vice versa.
- Treating `checkout.session.completed` as paid for async methods.
- `payment_intent.succeeded` and `checkout.session.completed` both firing → double fulfilment without object-level idempotency.
- Creating a new Customer on every checkout instead of reusing the stored `customer` ID.
- Radar and 3DS: server-only confirmation fails for cards requiring authentication; use the client SDK.

## Testing
Stripe CLI: `stripe listen --forward-to localhost:3000/webhooks/stripe`, `stripe trigger <event>`. Test clocks for subscription time travel. Test cards: https://docs.stripe.com/testing.
