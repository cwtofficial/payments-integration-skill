# Audit checklist

Concrete defect patterns, grouped by area. For each, the "confirm" line says how to prove it in code before reporting. Use the IDs (e.g. `AMT-1`) in the findings JSON `pattern` field if producing machine-readable output.

## Contents
- Amounts (AMT)
- Confirmation and fulfilment (CNF)
- Webhooks (WHK)
- Idempotency and concurrency (IDM)
- Ledger and balances (LDG)
- Payouts and withdrawals (PAY)
- Refunds and disputes (REF)
- Subscriptions (SUB)
- Secrets and configuration (SEC)
- Authorization (AUTHZ)
- Operations (OPS)

## Amounts (AMT)

- **AMT-1 Client-controlled amount or currency.** Request body/query contains `amount`, `price`, `currency`, `plan_price`, and it flows into the provider create call. *Confirm:* trace the value from the request handler to the provider call with no DB lookup replacing it. Critical.
- **AMT-2 Client-controlled discount, quantity, or fee.** Negative quantity, arbitrary coupon percentage, client-sent fee/split. *Confirm:* same trace; check for bounds validation. Critical/High.
- **AMT-3 Floating point money.** `parseFloat`, `Number(amount) * 100`, `float` columns, `toFixed` used for computation. *Confirm:* find arithmetic on money values held as floats; give an example value that rounds wrongly. High.
- **AMT-4 Wrong unit conversion.** Sending major units to a minor-unit provider (or the reverse), or assuming 2 decimals for JPY/KWD-type currencies. *Confirm:* compare the value sent with the provider's documented unit. High.
- **AMT-5 Missing currency.** Amount stored or compared without currency, in a system that supports or might support several. Medium.

## Confirmation and fulfilment (CNF)

- **CNF-1 Fulfilment from redirect or client callback.** Success page or frontend callback marks order paid / credits wallet using query params or client-sent status. *Confirm:* find the handler for the callback URL and see if it changes state without server-to-server verification. Critical.
- **CNF-2 Verification checks status only.** Verify call checks `status === 'success'` but not amount, currency, and that the reference maps to this order/user. *Confirm:* read the verify function; construct the "pay ₦100, claim ₦100,000 order" or "reuse another order's reference" scenario. Critical.
- **CNF-3 Order looked up by client-supplied ID, payment by client-supplied reference, never linked.** Variant of CNF-2. Critical.
- **CNF-4 Async methods treated as paid.** Fulfils on `checkout.session.completed` without checking `payment_status`, or on "pending" statuses. High.
- **CNF-5 Non-terminal states unhandled.** No handling for failed/expired/abandoned; orders stay pending forever; reserved stock never released. Medium.
- **CNF-6 Test-mode payment accepted in production.** No check of `livemode`/environment; test keys present in prod config. High.

## Webhooks (WHK)

- **WHK-1 No signature verification.** Handler parses body and acts. *Confirm:* no HMAC/SDK verify call before state changes. Critical.
- **WHK-2 Verification on parsed/re-serialized body.** `JSON.stringify(req.body)` passed to HMAC. Usually causes failures (so it gets "fixed" by disabling verification): check for disabled or try/catch-swallowed verification. High.
- **WHK-3 Verification failure not enforced.** Verify result logged but processing continues, or exception caught and ignored. Critical.
- **WHK-4 Non-constant-time comparison** (`===` on signatures). Low (practical exploitation is hard), but trivial to fix.
- **WHK-5 Wrong secret type.** Using API secret where webhook secret is required (Razorpay) or vice versa; works in one env, fails in another. Medium.
- **WHK-6 Slow synchronous processing** leading to timeouts and retries. Low/Medium, High if combined with non-idempotent processing.
- **WHK-7 5xx for unhandled event types**, causing endless retries / endpoint disablement. Low.
- **WHK-8 Unsigned provider callback trusted** (mobile money, some bank APIs) without re-querying status. Critical.

## Idempotency and concurrency (IDM)

- **IDM-1 No dedupe on webhook events or payment reference.** Same event processed twice credits twice. *Confirm:* no unique constraint on event ID / payment reference in the fulfilment path; a status check in app code alone does not count. High.
- **IDM-2 Check-then-act race.** `if (order.status !== 'paid') { credit(); order.status = 'paid'; save() }`: webhook and verify call (or two webhook deliveries) running concurrently both pass. *Confirm:* the check and the write are separate statements without a lock/conditional update. High.
- **IDM-3 No outbound idempotency key** on charge/refund/transfer creation that is retried (by code, by a job, or by user double-click). High for transfers/refunds.
- **IDM-4 Idempotency key regenerated per retry.** Medium.
- **IDM-5 Ledger write and status change in separate transactions.** Crash between them leaves inconsistent state. Medium.

## Ledger and balances (LDG)

- **LDG-1 Mutable balance with no ledger.** `user.balance += x; save()`. Can't audit or repair. Medium (High when combined with LDG-2).
- **LDG-2 Lost update.** Balance computed in app code and written absolute (`SET balance = $newBalance`). High.
- **LDG-3 Missing entries for some transitions** (fees, reversals, refunds, admin adjustments), so ledger sum ≠ reality. Medium.
- **LDG-4 Balances summed across currencies.** High where multiple currencies exist.
- **LDG-5 Admin can edit balances directly** without a ledger entry and audit log. Medium.

## Payouts and withdrawals (PAY)

- **PAY-1 Balance check not atomic with debit** (see IDM-2) → concurrent withdrawals overspend. Critical.
- **PAY-2 Debit after successful transfer call** instead of before → crash or concurrency sends money without debiting. High.
- **PAY-3 Failed/reversed transfers not credited back.** No handler for `transfer.failed`/`transfer.reversed` or equivalent. High.
- **PAY-4 Amount validation missing.** Negative, zero, fractional, above-balance, or above-limit withdrawals accepted. Negative withdrawals are often a credit. Critical.
- **PAY-5 Destination not owned/verified.** Can withdraw to any account number in the request; or change destination without re-auth. Critical/High.
- **PAY-6 Admin approval without server-side role check or idempotency.** High.
- **PAY-7 Fee not accounted**: sent amount ≠ debited amount and difference not recorded. Medium.

## Refunds and disputes (REF)

- **REF-1 Over-refund possible**: no cap at the original amount, or racy partial refunds. High.
- **REF-2 Refund doesn't revoke entitlement/credits.** High.
- **REF-3 Refund to arbitrary destination** instead of original method. High.
- **REF-4 Disputes unhandled**: no record, no alert, no account action. Medium.

## Subscriptions (SUB)

- **SUB-1 Access granted on checkout redirect.** Critical (same as CNF-1).
- **SUB-2 Access never revoked**: only "created/paid" events handled. High.
- **SUB-3 Renewal not idempotent**: double credits on retried `invoice.paid`/`charge.success`. High.
- **SUB-4 Upgrade before payment.** Medium.
- **SUB-5 Out-of-order updates overwrite newer state.** Medium.
- **SUB-6 Duplicate subscriptions per user.** Medium.

## Secrets and configuration (SEC)

- **SEC-1 Secret key in client bundle, mobile app, or repo.** Critical.
- **SEC-2 Secrets or card data in logs.** Medium/High.
- **SEC-3 Live keys usable in non-production / no environment guard.** Medium.
- **SEC-4 Raw card data handled by the app server.** High (compliance and breach impact).

## Authorization (AUTHZ)

- **AUTHZ-1 IDOR on payment resources**: verify/refund/withdraw/view endpoints accept an ID without ownership check. High/Critical.
- **AUTHZ-2 Admin payment endpoints protected only in the UI.** Critical.

## Operations (OPS)

- **OPS-1 No reconciliation or stuck-payment sweep.** Medium.
- **OPS-2 No storage of raw webhook events**: can't replay after a bug. Low.
- **OPS-3 No alerting on webhook failures.** Low.
