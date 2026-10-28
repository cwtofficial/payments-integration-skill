# Webhooks

## The handler shape

```
receive raw body
  → verify signature (reject with 400/401 if invalid)
  → parse
  → insert event into webhook_events with UNIQUE(provider, event_id)   -- duplicate → return 200, stop
  → return 2xx quickly
  → process asynchronously (queue/job), inside a DB transaction, idempotently
```

If you have no queue, processing inline is acceptable for fast work, as long as the processing itself is idempotent and finishes well within the provider's timeout (often 10-30 seconds; some are shorter). Never call slow third parties (email, PDF generation) inline before responding.

## Raw body: the most common failure

Signatures are computed over the exact bytes the provider sent. If any middleware parses the JSON and you re-serialize it, key order, whitespace, or unicode escaping can change and verification fails.

- **Express:** register the webhook route with `express.raw({ type: 'application/json' })` *before* any global `express.json()`, or use `express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })`.
- **Next.js App Router:** `const raw = await req.text()` in the route handler; do not call `req.json()` first.
- **Next.js Pages Router:** `export const config = { api: { bodyParser: false } }` and read the stream.
- **NestJS:** `NestFactory.create(AppModule, { rawBody: true })` and use `req.rawBody`.
- **Fastify:** add a content-type parser that keeps the buffer, or use `fastify-raw-body`.
- **Django:** `request.body` (bytes). **Flask:** `request.get_data()`. **FastAPI:** `await request.body()`.
- **Laravel:** `$request->getContent()`. **Rails:** `request.raw_post`. **Go:** read `r.Body` fully before decoding.
- **Serverless/edge:** some platforms base64-encode the body (check `isBase64Encoded` on AWS API Gateway/Lambda).

## Verification methods by provider

| Provider | Header | Method |
|---|---|---|
| Stripe | `Stripe-Signature` | HMAC-SHA256 of `"{timestamp}.{raw_body}"` with endpoint secret (`whsec_…`); header has `t=` and `v1=`. Use `stripe.webhooks.constructEvent`. Tolerance default 300s |
| Paystack | `x-paystack-signature` | HMAC-SHA512 of raw body with your **secret key** |
| Flutterwave (v3) | `verif-hash` | Equals the "secret hash" you set in the dashboard (plain comparison, use constant-time compare) |
| Razorpay | `X-Razorpay-Signature` | HMAC-SHA256 of raw body with the **webhook secret** (not the API key secret) |
| PayPal | `PAYPAL-TRANSMISSION-*` headers | Call `POST /v1/notifications/verify-webhook-signature` with the headers, your `webhook_id`, and the event; or verify the cert-based signature yourself |
| Adyen | in payload `additionalData.hmacSignature` | HMAC-SHA256 over specified fields, with HMAC key from the Customer Area; respond with `[accepted]` |
| Mercado Pago | `x-signature` (`ts=…,v1=…`) + `x-request-id` | HMAC-SHA256 of the manifest `id:{data.id};request-id:{x-request-id};ts:{ts};` with your webhook secret |
| Square | `x-square-hmacsha256-signature` | HMAC-SHA256 (base64) of `notification_url + raw_body` with signature key |
| Monnify | `monnify-signature` | HMAC-SHA512 of raw body with client secret |

Details can change; confirm against the provider file and the provider's docs or SDK.

Implementation rules:
- Compare signatures with a constant-time function (`crypto.timingSafeEqual`, `hmac.compare_digest`, `hash_equals`). Check lengths first in Node: `timingSafeEqual` throws on unequal lengths.
- Prefer the official SDK's verify function when one exists.
- Reject old timestamps when the scheme includes one, to limit replay.
- IP allowlisting (Paystack, Flutterwave, and others publish IPs) is defence in depth, never a replacement for signatures, and breaks when IPs change.
- Providers without signed webhooks (some mobile money APIs): treat the callback as a hint only: re-query the transaction status from the provider API using your credentials before acting, and use an unguessable callback URL.

## "Verify after webhook" pattern

Even with a valid signature, it is good practice (and required for providers with weak or no signatures) to fetch the transaction from the provider API and check status, amount, currency, and reference before fulfilling. This also protects against acting on a stale or test-mode event. The cost is one extra API call per payment.

## Idempotency and duplicates

Providers retry on non-2xx, timeouts, and sometimes for no visible reason. Expect duplicates.

```sql
CREATE TABLE webhook_events (
  id            BIGSERIAL PRIMARY KEY,
  provider      TEXT NOT NULL,
  event_id      TEXT NOT NULL,   -- provider event ID; if none, a hash of the body or (type, object id, status)
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  error         TEXT,
  UNIQUE (provider, event_id)
);
```

Insert with `ON CONFLICT DO NOTHING` and check whether a row was inserted. Event-level dedupe is not enough on its own: two *different* events can describe the same payment (e.g. `checkout.session.completed` and `payment_intent.succeeded`, or a webhook plus a user-triggered verify call). The fulfilment itself must also be idempotent: the conditional state transition and a unique constraint on the payment reference in the ledger.

Some providers (Paystack, Flutterwave) do not put a unique event ID on every payload. Derive one from event type + transaction ID/reference + status.

## Ordering

Webhooks can arrive out of order. `payment_intent.succeeded` can land before `payment_intent.created`; `customer.subscription.updated` events can arrive reversed. Defences:

- Drive state from the conditional state machine, so an earlier state can never overwrite a later one.
- For objects that change often (subscriptions), fetch the current object from the API when processing, rather than trusting the payload snapshot.
- Compare provider timestamps or version fields when available.

## Responding

- 2xx only when you have durably recorded the event (or processed it). If your DB write fails, return 5xx so the provider retries.
- Return 4xx for bad signatures. Do not return 2xx for an unverified request "to stop retries".
- Do not return 5xx for an event type you don't handle: return 2xx and ignore it, or the provider will retry it forever and may disable your endpoint.
- Do not leak error details in the response body.

## Operational

- Subscribe only to the events you handle.
- Monitor failures; most dashboards show delivery attempts. Alert when your failure rate rises: some providers disable endpoints after sustained failures.
- Keep a way to replay: store raw events so a bug fix can reprocess them, and know how to re-send from the provider dashboard or CLI.
- Separate endpoints or secrets for test and live mode; check the event's livemode/environment flag where present.
