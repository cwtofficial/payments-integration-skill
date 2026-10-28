# Mercado Pago

Docs: https://www.mercadopago.com/developers. Latin America (Argentina, Brazil, Mexico, Chile, Colombia, Peru, Uruguay). Supports Pix, Boleto, OXXO and local cards — many async methods.

## Credentials
Public key (client), access token (server, `Authorization: Bearer`). Test credentials and test users are separate from production.

## Amounts
Major units as decimal numbers (`transaction_amount: 100.5`, `unit_price: 100.5`). Currency is implied by the account's country (`currency_id` on items). Convert from minor units at the boundary.

## Checkout Pro (hosted)
`POST /checkout/preferences` with `items` (price from your DB), `external_reference` (your order ref), `notification_url`, `back_urls`, `auto_return`. Redirect to `init_point`. Return URLs include `payment_id`, `status`, `external_reference` — **not proof**.

## Checkout API / Bricks
`POST /v1/payments` with `transaction_amount`, `token` (from client), `payment_method_id`, `payer`, `external_reference`, header `X-Idempotency-Key`.

## Notifications (webhooks)
- Body/query contain `type` (e.g. `payment`) and `data.id` — essentially a pointer. **Fetch the payment** `GET /v1/payments/{id}` with your access token and use that response, checking `status === 'approved'`, `transaction_amount`, `currency_id`, and `external_reference`.
- Signature: header `x-signature: ts=<ts>,v1=<hex>` and `x-request-id`. Manifest: `id:{data.id};request-id:{x-request-id};ts:{ts};` (omit parts that are absent; `data.id` from the query string, lowercased if alphanumeric). HMAC-SHA256 with the webhook secret from your app's notification settings.
- Respond 200/201 quickly; retries otherwise.
- Older IPN notifications (`topic`/`id` query params) exist — prefer Webhooks for new code.

Payment `status`: `pending`, `approved`, `authorized`, `in_process`, `in_mediation`, `rejected`, `cancelled`, `refunded`, `charged_back`. Pix/Boleto/OXXO sit in `pending` until paid (Boleto can take days and may expire).

## Refunds
`POST /v1/payments/{id}/refunds` (optional `amount` for partial), with `X-Idempotency-Key`.

## Gotchas
- Fulfilling from `back_urls` status.
- Not handling long-pending cash/voucher methods and their expiry.
- Not handling `charged_back` and `in_mediation` (disputes).
