# Square

Docs: https://developer.squareup.com/docs. US, Canada, UK, Ireland, Australia, Japan, France, Spain. Strong for in-person + online.

## Credentials
Access token (server), application ID and location ID (client, Web Payments SDK). Sandbox `https://connect.squareupsandbox.com`, production `https://connect.squareup.com`. Set `Square-Version` header.

## Amounts
`amount_money: { amount: <integer minor units>, currency: 'USD' }` (JPY whole units).

## Payments
- Client: Web Payments SDK tokenizes the card → `source_id` (nonce).
- Server: `POST /v2/payments` with `source_id`, `idempotency_key` (required, unique per payment attempt), `amount_money` (from your DB), `reference_id`/`order_id`, `location_id`. `autocomplete: false` to authorize then `CompletePayment` later.
- Status: `APPROVED` (authorized), `COMPLETED`, `CANCELED`, `FAILED`.
- Alternative: Payment Links / Checkout API (`/v2/online-checkout/payment-links`) for hosted checkout.

## Webhooks
- Header `x-square-hmacsha256-signature`: base64 HMAC-SHA256 of `notification_url + raw_body` with the subscription's signature key. The URL must be exactly the one registered (scheme, host, path, query). SDK helper: `WebhooksHelper.isValidWebhookEventSignature(body, signature, signatureKey, notificationUrl)`.
- `event_id` is unique — dedupe on it.
- Key events: `payment.created`, `payment.updated`, `refund.created`, `refund.updated`, `dispute.created`, `dispute.state.updated`, `subscription.*`, `invoice.*`, `order.updated`.

## Refunds
`POST /v2/refunds` with `idempotency_key`, `payment_id`, `amount_money`. Refund status `PENDING` → `COMPLETED`/`REJECTED`/`FAILED`.

## Gotchas
- Generating a new `idempotency_key` on every retry.
- Signature verification failing behind proxies because the URL used in verification differs from the registered one (http vs https, trailing slash, host rewritten).
