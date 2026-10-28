# PayPal

Docs: https://developer.paypal.com/docs — REST API: https://developer.paypal.com/api/rest.

## Auth and environments
OAuth2 client credentials: `POST /v1/oauth2/token` with client ID/secret (Basic auth) → bearer token (cache until expiry). Sandbox `https://api-m.sandbox.paypal.com`, live `https://api-m.paypal.com`. Credentials are per environment.

## Amounts
Decimal **strings** in major units with currency-specific decimals: `{ currency_code: 'USD', value: '10.00' }`, `JPY` has no decimals (`'1000'`). Build the string from minor units — don't format a float.

## Orders v2 (checkout)

```js
// create (server)
const order = await paypal('POST', '/v2/checkout/orders', {
  intent: 'CAPTURE',
  purchase_units: [{
    reference_id: order.id,
    custom_id: order.id,
    invoice_id: payment.reference,     // must be unique per account if used
    amount: { currency_code: 'USD', value: toDecimalString(order.amountMinor, 'USD') },
  }],
}, { 'PayPal-Request-Id': `create:${payment.reference}` });
// client: PayPal JS SDK createOrder → returns order.id; onApprove → call your server to capture
```

```js
// capture (server, after buyer approval)
const result = await paypal('POST', `/v2/checkout/orders/${paypalOrderId}/capture`, null,
  { 'PayPal-Request-Id': `capture:${paypalOrderId}` });
const capture = result.purchase_units[0].payments.captures[0];
```

Verify before fulfilling: `result.status === 'COMPLETED'`, `capture.status === 'COMPLETED'` (it can be `PENDING` — e.g. eCheck, payment review — wait for `PAYMENT.CAPTURE.COMPLETED`), `capture.amount` equals your expected amount/currency, and `custom_id`/`invoice_id` maps to the order. Make sure the PayPal order ID being captured is the one your server created for *this* order — not an arbitrary ID from the client.

`intent: 'AUTHORIZE'` → authorize now, capture later (`/v2/payments/authorizations/{id}/capture`); authorizations expire.

## Webhooks
- Configure in the developer dashboard; each webhook has a `webhook_id`.
- Verify via `POST /v1/notifications/verify-webhook-signature` with `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time` (from headers `PAYPAL-AUTH-ALGO`, `PAYPAL-CERT-URL`, `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-TRANSMISSION-TIME`), your `webhook_id`, and the `webhook_event` (the parsed event). Response `verification_status: 'SUCCESS'`. Offline verification with the cert (CRC32 of raw body in the signed string) is also possible — if you do it yourself, validate that `cert_url` is a PayPal domain.
- Event `id` is unique — dedupe on it. Retries up to ~3 days on non-2xx.
- Key events: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `CUSTOMER.DISPUTE.CREATED`/`UPDATED`/`RESOLVED`, `BILLING.SUBSCRIPTION.*`, `PAYMENT.SALE.COMPLETED` (subscription payments), `PAYMENT.PAYOUTSBATCH.*`/`PAYMENT.PAYOUTS-ITEM.*`.

## Idempotency
`PayPal-Request-Id` header on POSTs (create order, capture, refund, payouts). Use a key derived from your operation.

## Subscriptions
Products + Plans (`/v1/billing/plans`), then subscription created via JS SDK `createSubscription`. Statuses `APPROVAL_PENDING`, `ACTIVE`, `SUSPENDED`, `CANCELLED`, `EXPIRED`. Renewals as `PAYMENT.SALE.COMPLETED`.

## Payouts
`POST /v1/payments/payouts` with `sender_batch_header.sender_batch_id` (unique — idempotency) and items with `sender_item_id`. Items can end `UNCLAIMED` (recipient has no account) and are returned after 30 days — handle `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`/`RETURNED`/`FAILED` to restore balances.

## Refunds
`POST /v2/payments/captures/{capture_id}/refund` with optional amount and `PayPal-Request-Id`.

## Gotchas
- Fulfilling in `onApprove` on the client, or before capture.
- Capturing an order ID supplied by the client without checking it belongs to this order.
- Treating `PENDING` captures as paid.
- Not handling `PAYMENT.CAPTURE.REVERSED` (buyer reversal) and disputes.
- Formatting amounts with floats (`(19.99).toString()` is fine, `0.1+0.2` is not).

## Testing
Sandbox accounts via the developer dashboard; negative testing with the `PayPal-Mock-Response` header on sandbox.
