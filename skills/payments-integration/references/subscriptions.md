# Subscriptions and recurring billing

## Let the provider own the billing schedule when it can

Stripe Billing, Paystack Plans/Subscriptions, Flutterwave Payment Plans, Razorpay Subscriptions, PayPal Subscriptions, Adyen tokenized recurring, Square Subscriptions, Paddle, and Lemon Squeezy all run the schedule, retries, and (in some cases) tax for you. Rolling your own cron that charges saved cards is sometimes necessary (providers with limited plan features, usage-based pricing your provider can't express), but then you own retries, dunning, proration, idempotency of each renewal, and SCA re-authentication.

## The source of truth for access

Your app needs a local `subscriptions` record with: provider subscription ID, customer, plan/price, status, `current_period_end`, `cancel_at_period_end`, and the last event timestamp applied. Grant access from this local record, updated by webhooks, not by calling the provider on every request, and not by the checkout success redirect.

Access rule that survives most edge cases: **access is allowed while `status` is in an allowed set and `now < current_period_end` (plus an optional grace period).** Decide explicitly which statuses keep access (e.g. Stripe `active`, `trialing`, and possibly `past_due` during dunning).

## Events to handle (Stripe names; others have equivalents)

| Event | Action |
|---|---|
| `checkout.session.completed` (mode=subscription) | Link the subscription to your user; do not grant access until payment status is confirmed |
| `customer.subscription.created` / `updated` | Upsert local record: status, price, period end, cancel flags. Fetch the latest object if ordering is a concern |
| `invoice.paid` | Extend access to the new period end; record the payment |
| `invoice.payment_failed` | Mark past due, notify customer with a link to update payment method |
| `invoice.payment_action_required` | Customer must authenticate (SCA); send them to the hosted invoice page |
| `customer.subscription.deleted` | Revoke access (at period end if that's what the subscription said) |
| `customer.subscription.trial_will_end` | Notify |

Paystack: `subscription.create`, `charge.success` (renewals), `invoice.create`, `invoice.update`, `invoice.payment_failed`, `subscription.not_renew`, `subscription.disable`. Razorpay: `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`. PayPal: `BILLING.SUBSCRIPTION.ACTIVATED`, `PAYMENT.SALE.COMPLETED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`.

## Common subscription bugs

- **Granting access on signup but never revoking it** because only the "created" event is handled.
- **Two subscriptions for one user**: double click on subscribe, or no check for an existing active subscription. Check before creating and use idempotency keys.
- **Renewal credits as a new purchase** in a credits-based model, without idempotency on the invoice ID → double credits on retried webhooks.
- **Plan change applied before payment**: upgrading the user's tier when the upgrade invoice hasn't been paid.
- **Out-of-order `updated` events** overwriting a newer state with an older snapshot.
- **Trial abuse**: unlimited trials by re-registering; tie trials to a payment method fingerprint or verified identity if that matters to the business.
- **Cancellation semantics**: "cancel" usually should mean cancel at period end (the customer paid for the period). Immediate cancellation may require a prorated refund; be explicit.
- **Price changes**: existing subscribers stay on their old price unless migrated; changing a price object in place is often impossible or surprising.

## Proration and plan changes

Providers differ: Stripe prorates by default and can invoice immediately or on next renewal; Paystack has no automatic proration (you typically cancel and create a new subscription, and handle credit yourself); Razorpay supports updates with schedule options. Decide the business rule (charge the difference now? at next cycle? no refunds on downgrade?) and implement it explicitly rather than accepting the default unknowingly.

## Dunning

When renewals fail: retry on a schedule (provider "smart retries" where available), email the customer with an update-payment link, keep or restrict access during grace, then cancel. Make sure the final "subscription cancelled after failed payments" event actually revokes access.

## Usage-based billing

Report usage idempotently (Stripe meter events have an `identifier` for dedupe; for your own system, a unique key per usage record). Aggregate per period, and never let a retry double-count usage.
