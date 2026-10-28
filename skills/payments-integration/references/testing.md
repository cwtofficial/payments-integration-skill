# Testing payment integrations

## Test mode basics

Every major provider has a test/sandbox mode with separate keys. Make the environment explicit in config and fail fast if a live key is used outside production (Stripe live keys start `sk_live_`, test `sk_test_`; Paystack `sk_live_`/`sk_test_`; Flutterwave `FLWSECK-…` vs `FLWSECK_TEST-…`; Razorpay `rzp_live_`/`rzp_test_`; PayPal sandbox vs live base URL).

## Test data pointers

Test card numbers and failure triggers change; link to the current page rather than hard-coding a long list.

- Stripe: `4242 4242 4242 4242` (success), `4000 0000 0000 9995` (insufficient funds), `4000 0025 0000 3155` (requires 3DS), `4000 0000 0000 0341` (attaches but fails on charge). Docs: stripe.com/docs/testing.
- Paystack: test cards on paystack.com/docs/payments/test-payments (includes success, failed, and OTP/PIN flows).
- Flutterwave: developer.flutterwave.com/docs/integration-guides/testing-helpers.
- Razorpay: razorpay.com/docs/payments/payments/test-card-details.
- PayPal: sandbox accounts from developer.paypal.com; negative testing via `PayPal-Mock-Response` header.
- Adyen: docs.adyen.com/development-resources/testing/test-card-numbers.

## Getting webhooks to your machine

- Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (prints the `whsec_` to use locally) and `stripe trigger payment_intent.succeeded`.
- Others: a tunnel (`cloudflared tunnel --url http://localhost:3000`, ngrok) registered as the test webhook URL.
- Offline: `node scripts/sign-webhook.cjs` from this skill produces correctly signed headers for Stripe, Paystack, Razorpay, Flutterwave, Square and Monnify, so you can `curl` a payload at your handler without a tunnel. Use it to write automated tests of the verification path.

## What to test

The happy path almost always works. Test these:

**Webhooks**
- valid signature → processed
- invalid signature / missing header → 4xx, no side effects
- body modified after signing → rejected
- same event delivered twice → one fulfilment
- two different events for the same payment → one fulfilment
- events out of order → final state correct
- handler failure mid-processing → retried event completes correctly

**Checkout**
- amount tampered on the client → server ignores it
- redirect to success URL without payment → order not paid
- successful payment of a smaller amount / other currency against this order → not fulfilled
- reference from another user's order → not fulfilled
- async method: processing then success; processing then failure
- 3DS required card → completes via client SDK

**Wallets/payouts**
- two concurrent withdrawals exceeding the balance → only one succeeds (run them truly in parallel: `Promise.all`, multiple threads, or `ab`/`hey` against the endpoint)
- provider timeout on transfer → no double send on retry
- transfer failed/reversed webhook → balance restored once
- withdrawal of negative, zero, fractional, or huge amounts → rejected

**Refunds/subscriptions**
- partial refunds summing above the original → rejected
- refund revokes entitlement
- renewal webhook delivered twice → access extended / credits added once
- cancellation → access ends at the right time

Unit-test the pure parts (amount conversion, state transitions, fee calculation, signature verification) and integration-test the handler against a real database — idempotency and race bugs live in the database interaction and won't show up with mocked repositories.
