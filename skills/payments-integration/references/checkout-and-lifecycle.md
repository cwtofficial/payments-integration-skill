# Checkout and payment lifecycle

## The universal shape

Every provider, however its API looks, follows the same pattern:

```
1. Server creates an order in your DB          (status: pending, amount from DB)
2. Server creates a payment with the provider   (reference = your order ID or a unique ref)
3. Client completes payment                     (hosted page, popup, SDK, USSD, bank app...)
4. Provider tells you the outcome               (webhook, and/or you call verify)
5. Server verifies and fulfils, idempotently    (status: paid → fulfilled)
```

Steps 1, 2, 4, and 5 belong to your server. Step 3 belongs to the customer and the provider; your client code only hands over what the provider's frontend needs.

## Choosing an integration style

| Style | What it is | When |
|---|---|---|
| Hosted checkout / redirect | Customer goes to the provider's page (Stripe Checkout, Paystack/Flutterwave hosted page, PayPal approval) | Default. Least code, smallest PCI scope, most payment methods for free |
| Embedded components | Provider-hosted fields inside your page (Stripe Payment Element, Adyen Drop-in, Square Web Payments, Razorpay Checkout popup, Paystack Inline) | When you need checkout on your own page |
| Direct API with raw card data | Your server sends card numbers to the provider | Almost never. Requires PCI DSS SAQ D. Do not suggest it unless the user explicitly has that compliance in place |

## Payment references

- Generate the reference on your server and make it unique and unguessable (UUID or prefixed random ID). Store it on the order before calling the provider.
- Pass it as the provider's reference/metadata field (`client_reference_id`/`metadata` on Stripe, `reference` on Paystack, `tx_ref` on Flutterwave, `receipt`/`notes` on Razorpay, `invoice_id`/`custom_id` on PayPal, `merchantReference` on Adyen, `external_reference` on Mercado Pago).
- On verification, look the order up by the provider-returned reference, then check the payment really belongs to it. Do not look the order up by a user-supplied ID and then trust any successful payment the user points you at — that lets a user reuse one cheap payment for an expensive order.
- A new attempt after a failure should normally get a new reference on the provider side (many providers reject reused references), linked to the same order. Model `order` (1) → `payment_attempt` (many).

## Redirects and callbacks are not proof

After hosted checkout the customer is sent back to your `success_url`/`callback_url`, often with a reference and a status in the query string. Treat that page as: "show a 'confirming your payment' state, then call your own server, which verifies with the provider." Never mark the order paid from the query string, and never rely on the redirect at all for fulfilment — customers close tabs, lose connectivity, and pay via methods that confirm minutes later. The webhook is the reliable path; the redirect is for user experience.

## Synchronous vs asynchronous confirmation

Some methods confirm instantly (most cards). Many do not: bank transfers, direct debits (SEPA, ACH, BACS), USSD, mobile money (M-Pesa, MTN MoMo), Boleto, OXXO, UPI collect, Pix, vouchers, and cards that need 3-D Secure. For these, "the customer finished the checkout" means "payment is processing", and the final success or failure arrives later — sometimes days later for debits.

Consequences:

- Your order needs a `processing` state distinct from `paid`.
- Do not fulfil on "checkout completed" events when the payment status is still pending (Stripe: check `payment_status` on `checkout.session.completed`, and handle `checkout.session.async_payment_succeeded` / `async_payment_failed`).
- Tell the customer clearly that confirmation is pending.

## 3-D Secure / SCA

In the EEA, UK, India, and increasingly elsewhere, card payments often require customer authentication. Using the provider's current client SDK (Stripe Payment Element / `confirmPayment`, Adyen Drop-in, Razorpay Checkout) handles the challenge for you. Code that creates and confirms a card charge purely server-side will fail for cards that need authentication. Off-session charges (subscriptions, saved cards) can also require the customer to come back and authenticate — build a path to notify them.

## A state machine

Make states and transitions explicit and enforce them in one place.

```
pending ──► processing ──► paid ──► fulfilled
   │            │            │
   ├──► failed ◄┘            ├──► refunded (partial/full)
   └──► expired/abandoned    └──► disputed ──► won / lost
```

Enforce transitions with conditional updates:

```sql
UPDATE orders SET status = 'paid', paid_at = now()
WHERE id = $1 AND status IN ('pending', 'processing');
-- 0 rows updated → already paid (or in a state that must not become paid). Do nothing more.
```

This single pattern prevents a whole class of double-fulfilment and out-of-order bugs.

## Expiry and abandonment

Pending orders that never complete should expire — release reserved stock, stop showing them as awaiting payment. Hosted sessions also expire (Stripe Checkout Sessions default to 24h). Handle the expiry event or sweep with a job. A late success for an order you already expired should be handled deliberately (fulfil anyway, or auto-refund), not crash.

## Saved payment methods

Use the provider's vaulting (Stripe Customers + PaymentMethods/SetupIntents, Paystack `authorization_code`, Flutterwave tokens, Razorpay tokens, Adyen `storedPaymentMethodId`, PayPal vault). Store only the token and display data (brand, last4, expiry). Charging a saved method later is "off-session" — it can fail or require authentication, so handle that outcome.
