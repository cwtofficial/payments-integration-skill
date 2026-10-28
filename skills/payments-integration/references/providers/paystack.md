# Paystack

Docs: https://paystack.com/docs — API: https://paystack.com/docs/api. Markets include Nigeria, Ghana, Kenya, South Africa, Côte d'Ivoire, Egypt, Rwanda (check current list and per-market features).

## Keys
`pk_test_`/`pk_live_` public, `sk_test_`/`sk_live_` secret. Base URL `https://api.paystack.co`, `Authorization: Bearer <secret>`. Test and live use the same base URL; the key decides the mode.

## Amounts
Integer subunits: kobo (NGN), pesewas (GHS), cents (ZAR, KES, USD). `amount: 500000` = ₦5,000. Responses also report subunits. Paystack has minimum amounts per currency.

## One-off payment

```js
// initialize (server)
const res = await fetch('https://api.paystack.co/transaction/initialize', {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: user.email,
    amount: order.amountMinor,         // from DB, in kobo
    currency: 'NGN',
    reference: payment.reference,      // your unique ref, stored before this call
    callback_url: `${APP_URL}/payments/paystack/callback`,
    metadata: { orderId: order.id },
  }),
});
// → data.authorization_url (redirect) / data.access_code (Popup/Inline)
```

Verify (server, on callback and/or after webhook):

```js
const { data } = await (await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
  headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
})).json();

const ok = data.status === 'success'
  && data.amount === payment.amountMinor
  && data.currency === payment.currency
  && data.reference === payment.reference;
```

The callback URL receives `?trxref=…&reference=…` — use it only to know *which* reference to verify.

## Webhooks
- Header `x-paystack-signature`: HMAC-SHA512 (hex) of the raw body using your **secret key** (there is no separate webhook secret).
- Return 200 quickly. Paystack retries failed deliveries (live mode: periodically for up to ~72 hours; check docs for current schedule).
- Webhook source IPs are published (currently `52.31.139.75`, `52.49.173.169`, `52.214.14.220`) — optional extra check only.
- No top-level unique event ID. Dedupe on `event` + `data.id` (or `data.reference`) + status.

```js
const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
const sig = req.headers['x-paystack-signature'] || '';
const valid = sig.length === hash.length && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(sig));
```

Key events: `charge.success`, `transfer.success`, `transfer.failed`, `transfer.reversed`, `refund.pending`/`refund.processed`/`refund.failed`, `charge.dispute.create`/`charge.dispute.resolve`, `subscription.create`, `subscription.disable`, `subscription.not_renew`, `invoice.create`/`invoice.update`/`invoice.payment_failed`, `customeridentification.success`/`failed`, `dedicatedaccount.assign.success` (dedicated virtual accounts).

## Saved cards / recurring
`charge.success` data includes `authorization.authorization_code` with `reusable: true` when the card can be charged again. Charge later with `POST /transaction/charge_authorization` (`email`, `amount`, `authorization_code`, `reference`). Store `authorization_code` with the customer's email — Paystack ties it to the email used.

Plans/Subscriptions: `POST /plan`, then initialize a transaction with `plan`, or `POST /subscription`. Renewals arrive as `charge.success` with plan info, plus `invoice.*` events. No automatic proration.

## Dedicated virtual accounts (bank transfer wallets)
`POST /dedicated_account` assigns a NUBAN per customer. Incoming transfers arrive as `charge.success` with `channel: 'dedicated_nuban'`. Credit the wallet idempotently on the transaction reference. Customers may send any amount — credit what was actually received.

## Transfers (payouts)
1. Resolve: `GET /bank/resolve?account_number=…&bank_code=…` → account name, show to the user.
2. Recipient: `POST /transferrecipient` (`type: 'nuban'`, `name`, `account_number`, `bank_code`, `currency`) → `recipient_code`. Store it.
3. Transfer: `POST /transfer` (`source: 'balance'`, `amount`, `recipient`, `reference`, `reason`).
   - `reference` must be unique; reuse it on retry so a retry cannot create a second transfer. Paystack constrains the format (lowercase alphanumerics, `-` and `_`, length limits) — check docs.
   - Response status may be `pending`, `otp`, `success`, `failed`. If OTP is enabled on the account, finalize via `POST /transfer/finalize_transfer`; for automated payouts disable OTP in the dashboard and put strong controls in your own app.
4. Final status by webhook: `transfer.success`, `transfer.failed`, `transfer.reversed`. Failed and reversed must restore the user's balance.
5. Bulk: `POST /transfer/bulk`. Verify a transfer: `GET /transfer/verify/:reference`.

## Splits
Subaccounts (`POST /subaccount`) and split groups (`POST /split`). Pass `subaccount` or `split_code` on initialize; `bearer` sets who pays fees.

## Refunds
`POST /refund` with `transaction` (reference or ID) and optional `amount` for partial. Refunds are async — handle `refund.processed`/`refund.failed`.

## Gotchas
- Fulfilling on the callback redirect without calling verify.
- Verify checks `status` only — not `amount`/`currency`/that the reference is yours.
- Hashing `JSON.stringify(req.body)` instead of the raw body — works until the payload has characters that re-serialize differently.
- Using the public key for HMAC.
- `transfer.reversed` not handled — user loses the withdrawn amount.
- Amount sent in naira instead of kobo (100× undercharge).

## Testing
Test cards and bank/USSD simulations: https://paystack.com/docs/payments/test-payments. Transfers in test mode succeed without moving money; test failure paths with the documented test recipients where available.
