# Other providers

Shorter notes. The invariants in SKILL.md apply unchanged; these are the details that differ. Confirm against current docs before relying on them.

## Contents
- Monnify (Nigeria)
- M-Pesa Daraja (Kenya)
- Mollie (Europe)
- Braintree
- Checkout.com
- Paddle and Lemon Squeezy (merchant of record)
- Xendit (Southeast Asia)
- Providers not listed

## Monnify (Nigeria)
Docs: https://developers.monnify.com.
- Auth: `POST /api/v1/auth/login` with Basic `apiKey:secretKey` → bearer token. Sandbox `https://sandbox.monnify.com`, live `https://api.monnify.com`.
- Amounts in **naira (major units)**.
- Init: `POST /api/v1/merchant/transactions/init-transaction` with `amount`, `paymentReference` (yours, unique), `contractCode`, `redirectUrl`, customer details → `checkoutUrl`, `transactionReference`.
- Verify: `GET /api/v2/transactions/{transactionReference}` (URL-encode it) → `paymentStatus` (`PAID`, `PENDING`, `OVERPAID`, `PARTIALLY_PAID`, `EXPIRED`, `FAILED`...), `amountPaid`, `paymentReference`.
- Webhook signature: header `monnify-signature` = HMAC-SHA512 (hex) of the raw body with your **client secret key**.
- Reserved accounts (virtual accounts for wallet funding): customers can transfer any amount — credit `amountPaid` (or settlement amount per your fee policy), idempotent on `transactionReference`. Handle `OVERPAID`/`PARTIALLY_PAID` explicitly for invoice-style flows.
- Disbursements: `POST /api/v2/disbursements/single` with unique `reference`; may require OTP authorization unless disabled; final status via webhook or `GET /api/v2/disbursements/single/summary?reference=…`. Restore balance on failure/reversal.

## M-Pesa Daraja (Kenya, Safaricom)
Docs: https://developer.safaricom.co.ke.
- OAuth: `GET /oauth/v1/generate?grant_type=client_credentials` with Basic consumer key/secret. Sandbox `https://sandbox.safaricom.co.ke`, live `https://api.safaricom.co.ke`.
- Amounts are **whole KES integers**.
- STK Push (Lipa na M-Pesa Online): `POST /mpesa/stkpush/v1/processrequest` with `BusinessShortCode`, `Password = base64(Shortcode + Passkey + Timestamp)`, `Timestamp` (`YYYYMMDDHHmmss`), `TransactionType`, `Amount`, `PartyA` (phone), `PartyB`, `PhoneNumber`, `CallBackURL`, `AccountReference`, `TransactionDesc` → `CheckoutRequestID`, `MerchantRequestID`. Store `CheckoutRequestID` on your payment row.
- Callback: `Body.stkCallback.ResultCode` (0 = success), `CallbackMetadata.Item` with `Amount`, `MpesaReceiptNumber`, `PhoneNumber`. **Callbacks are not signed.** Use a hard-to-guess callback path, optionally IP allowlist Safaricom's ranges, match on `CheckoutRequestID`, check amount, and confirm via STK Push Query (`/mpesa/stkpushquery/v1/query`) before crediting. Dedupe on `MpesaReceiptNumber`.
- Callbacks may never arrive (user ignored prompt, timeouts) — sweep pending requests with the query API.
- C2B (paybill/till): register validation and confirmation URLs; confirmation is the payment notification.
- B2C (payouts): `ResultURL` and `QueueTimeOutURL` callbacks; a timeout does not mean failure — query transaction status before retrying, or you may pay twice.

## Mollie (Europe)
Docs: https://docs.mollie.com.
- Amounts as `{ currency: 'EUR', value: '10.00' }` decimal strings.
- Webhook posts only `id=tr_…`; you must fetch the payment with your API key. That fetch is the verification (unsigned by design). Return 200 for unknown IDs to avoid leaking information.
- Statuses: `open`, `pending`, `authorized`, `paid`, `canceled`, `expired`, `failed`. Refunds and chargebacks are separate resources.
- `Idempotency-Key` header supported.

## Braintree (PayPal)
Docs: https://developer.paypal.com/braintree/docs.
- Client token → Drop-in → `payment_method_nonce` → `gateway.transaction.sale({ amount: '10.00', paymentMethodNonce, options: { submitForSettlement: true } })`. Amounts decimal strings.
- Webhooks: `bt_signature` and `bt_payload` form fields; verify and parse with `gateway.webhookNotification.parse(signature, payload)`.
- Transaction statuses include `authorized`, `submitted_for_settlement`, `settling`, `settled`, `settlement_declined`, `voided`, `failed`, `gateway_rejected`, `processor_declined`.

## Checkout.com
Docs: https://www.checkout.com/docs.
- Amounts integer minor units. `Cko-Idempotency-Key` header on payment requests.
- Webhook signature: `Cko-Signature` header = HMAC-SHA256 of the raw body with the webhook's secret key. Also an optional authorization header value you configure.
- Statuses/events: `payment_approved`, `payment_captured`, `payment_declined`, `payment_refunded`, `payment_pending`, dispute events.

## Paddle and Lemon Squeezy (merchant of record)
They are the seller of record: they collect and remit sales tax/VAT and handle invoicing. Good fit for SaaS selling globally; the trade-off is higher fees and less control.
- **Paddle Billing**: webhook header `Paddle-Signature: ts=<ts>;h1=<hex>`, HMAC-SHA256 of `"{ts}:{raw_body}"` with the notification destination's secret. Events like `transaction.completed`, `subscription.created`/`updated`/`canceled`. Use `custom_data` to link to your user. Paddle Classic is different (public-key signature) — check which one the project uses.
- **Lemon Squeezy**: header `X-Signature` = HMAC-SHA256 (hex) of the raw body with the signing secret. Events `order_created`, `subscription_created`, `subscription_updated`, `subscription_payment_success`, `subscription_cancelled`, `order_refunded`. Pass your user ID in `checkout_data.custom` → `meta.custom_data`.

## Xendit (Indonesia, Philippines, and SEA)
Docs: https://docs.xendit.co.
- Callbacks carry `x-callback-token` header equal to the verification token in your dashboard — a shared secret, not a body signature. Compare in constant time and re-fetch the object (invoice/payment) via API before acting.
- Amounts in major units for IDR/PHP (IDR has no decimals in practice). Invoices have statuses `PENDING`, `PAID`, `SETTLED`, `EXPIRED`.
- `Idempotency-key` header (exact casing per docs) on create endpoints; disbursements use unique `external_id`.

## Providers not listed
For any other provider (Interswitch, OPay, Pesapal, Chapa, DPO, Yoco, Peach, PayU, Midtrans, PayMongo, Tap, HyperPay, iyzico, Klarna, etc.), establish these before writing code, and state any you could not confirm:

1. Amount unit (major vs minor) and supported currencies.
2. How the final status is delivered (webhook? signed how? or polling only?).
3. The server-side verify/query endpoint and which fields it returns.
4. The unique reference field and whether duplicates are rejected.
5. Outbound idempotency support.
6. All terminal statuses, including reversals.
7. Test mode and test credentials.
