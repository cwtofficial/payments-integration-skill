# Adyen

Docs: https://docs.adyen.com. Enterprise global processor (cards, wallets, many local methods, in-person terminals).

## Credentials
API key (`X-API-Key`), merchant account name, client key (for Web Drop-in/Components). Test `https://checkout-test.adyen.com/…`; live uses a **merchant-specific live URL prefix**: get it from the Customer Area, don't guess.

## Amounts
`amount: { value: <integer minor units>, currency: 'EUR' }`. Follows ISO decimals with a few Adyen-specific exceptions (check their currency codes page).

## Checkout
- **Sessions flow** (recommended): server `POST /sessions` with `amount`, `reference` (your unique ref), `merchantAccount`, `returnUrl` → client Drop-in with `id` + `sessionData`.
- **Advanced flow**: `/paymentMethods`, `/payments`, `/payments/details` for full control.
- The client result code (`Authorised`, `Pending`, `Received`, `Refused`, ...) is for UX. Fulfil from webhooks.

## Webhooks (standard notifications)
- Payload: `{ live: "true"|"false", notificationItems: [{ NotificationRequestItem: { eventCode, success, pspReference, originalReference, merchantReference, merchantAccountCode, amount: { value, currency }, additionalData: { hmacSignature, ... } } }] }`.
- `success` is a **string** `"true"`/`"false"`. `if (item.success)` is always truthy: a classic bug.
- HMAC: concatenate `pspReference:originalReference:merchantAccountCode:merchantReference:value:currency:eventCode:success` (empty string for missing fields, `:` separators), HMAC-SHA256 with the hex-decoded HMAC key, base64-encode the result, and compare it with `additionalData.hmacSignature`. Use the Adyen library's `HmacValidator` when available.
- Also configure basic auth on the webhook endpoint in the Customer Area and check it.
- Respond with HTTP 200 and body `[accepted]`; otherwise Adyen retries and queues subsequent webhooks.
- Dedupe on `pspReference` + `eventCode` + `success`.
- Key `eventCode`s: `AUTHORISATION`, `CAPTURE`, `CAPTURE_FAILED`, `CANCELLATION`, `REFUND`, `REFUND_FAILED`, `REFUNDED_REVERSED`, `CHARGEBACK`, `CHARGEBACK_REVERSED`, `NOTIFICATION_OF_CHARGEBACK`, `REQUEST_FOR_INFORMATION`, `OFFER_CLOSED`.
- With manual capture, `AUTHORISATION` success ≠ funds captured: wait for `CAPTURE`.

## Idempotency
`Idempotency-Key` header on POSTs (keys retained for a minimum period, check docs).

## Tokenization / recurring
`storePaymentMethod: true`, `shopperReference`, `recurringProcessingModel` (`CardOnFile`, `Subscription`, `UnscheduledCardOnFile`), `shopperInteraction: 'ContAuth'` for merchant-initiated charges.

## Platforms
Adyen for Platforms (Balance Platform): split instructions on payments, account holders with KYC. Large topic: read their platform docs before building.

## Gotchas
- `success` string comparison.
- Not returning `[accepted]`, which stalls the webhook queue.
- Fulfilling on client `resultCode`.
- Treating `AUTHORISATION` as captured when manual capture is on.
