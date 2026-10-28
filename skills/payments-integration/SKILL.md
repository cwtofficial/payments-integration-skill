---
name: payments-integration
description: Build, audit, and debug payment integrations with any provider, including Stripe, PayPal, Paystack, Flutterwave, Razorpay, Adyen, Mercado Pago, Square, Monnify, M-Pesa and others. Covers checkout and payment confirmation, webhooks and signature verification, idempotency, ledgers and wallet balances, subscriptions and recurring billing, refunds and disputes, payouts/transfers/withdrawals, marketplaces (Stripe Connect, split payments, subaccounts), multi-currency amounts, reconciliation, and testing. Use this skill whenever the user is writing or reviewing code that takes money, moves money, or records money, even if they only say "add checkout", "users get credited twice", "webhook not firing", "add a wallet", "withdrawals", "billing", "subscription", "top-up", "payment callback", or paste code that calls a payment API, and whenever they ask whether their payment flow is safe or production-ready.
---

# Payments Integration

Payment code fails in ways ordinary code does not. A bug does not show an error page: it ships value to the wrong person, charges twice, or credits a wallet that was never paid. Most of these bugs come from a small set of mistakes that repeat across every provider and every region. This skill teaches the universal model first, then the provider-specific details.

## Choose the mode

Decide which of these the user needs, from what they asked:

- **Build**: "add Stripe checkout", "integrate Paystack", "let users withdraw". Produce working code that follows the invariants below from the first draft. Do not write a happy-path version and leave correctness for later; the happy path is the part that already works in every tutorial.
- **Audit**: "is this safe?", "review our payment flow", "production-ready?". Find concrete defects with file and line, ranked by money at risk. Follow the audit workflow below and produce a findings report.
- **Debug**: "webhook returns 400", "user paid but order still pending", "balance is wrong". Find the root cause, then check whether the same class of bug exists elsewhere in the flow, because it usually does.

When the mode is unclear, default to Build if there is no payment code yet, Audit if there is.

## The invariants

These hold for every provider. Nearly every serious payment bug is a violation of one of them. Learn the reason behind each; you will need it to apply them to code that looks nothing like the examples.

1. **The server decides the amount.** Never take the price, currency, or plan from the client. Look it up from your own database by product/plan ID. A client that can set `amount` can buy anything for 1 cent.

2. **Only a verified server-side signal marks something paid.** A redirect to `/success`, a `?status=successful` query param, or a frontend callback is a hint that the user *might* have paid. Fulfil only on (a) a webhook whose signature you verified, or (b) a server-to-server call to the provider's verify/retrieve API. Redirects are trivially forged and also simply fail when the user closes the tab.

3. **When you verify, check everything, not just "success".** Confirm the status is final-success, the amount and currency match what *you* expected for this order, the reference belongs to *this* order/user, and the payment is in the right mode (live vs test). A successful ₦100 payment is not a successful ₦100,000 payment; a successful payment on someone else's reference is not a payment for this order.

4. **Every money-moving operation is idempotent.** Webhooks are delivered at least once, often more. Users double-click. Retries happen after timeouts where the first call actually succeeded. Fulfilment must be keyed on a unique identifier (provider event ID or payment reference) enforced by a database unique constraint, not by an `if (order.status !== 'paid')` check, which races. Outbound calls that create charges, refunds, or transfers must send an idempotency key where the provider supports one.

5. **State changes are atomic and conditional.** "Read balance, check, write balance" in application code is a race that lets two concurrent withdrawals both pass the check. Use a conditional update (`UPDATE ... SET balance = balance - $1 WHERE id = $2 AND balance >= $1`), a row lock (`SELECT ... FOR UPDATE`), or a transaction with the right isolation, and wrap the ledger write and the status change in one transaction.

6. **Money is integers in minor units, with an explicit currency.** Never floats. `0.1 + 0.2 !== 0.3`. Store `amount_minor` (integer/bigint) plus `currency` (ISO 4217). Know each provider's unit convention: they differ (Stripe/Paystack/Razorpay use minor units; PayPal and Flutterwave use decimal major units) and know the currencies with 0 or 3 decimal places. See `references/money-and-currency.md`.

7. **Balances are derived from a ledger, not stored as a mutable number alone.** If a wallet balance can be edited directly, you cannot explain how it got wrong, and it will get wrong. Record every movement as an append-only entry; a cached balance column is fine only if it is updated in the same transaction as the entry.

8. **Webhook handlers verify, record, acknowledge, then process.** Verify the signature against the **raw** request body (parsed-then-re-serialized JSON fails verification). Store the event, return 2xx fast, and do slow work asynchronously. A handler that times out gets retried and must be idempotent anyway.

9. **Handle every terminal state, not just success.** Failed, abandoned, expired, reversed, refunded, disputed/charged back. A payout that the provider later reverses must return funds to the user's balance; a refund must reverse fulfilment or entitlements; a dispute may freeze funds. Model these as an explicit state machine with allowed transitions.

10. **Secrets stay on the server and out of logs.** Secret keys, webhook secrets, and full card data never reach the client, the repo, or log lines. Use the provider's hosted fields/checkout so raw card numbers never touch your servers (this keeps PCI scope small). Use separate keys for test and live, and make it impossible to accidentally run live keys in development.

11. **Reconcile.** Webhooks get lost, handlers have bugs, and providers have outages. A periodic job that compares your records with the provider's (transactions, payouts, settlements) catches what the real-time path missed. A payment system without reconciliation is relying on luck.

## Build workflow

1. **Identify the provider(s) and flow type.** One-off checkout, saved cards, subscriptions, wallet top-up, payouts, marketplace split. Read the matching provider file in `references/providers/` and the matching topic files (map below). If the provider is not listed, apply the invariants and say which provider-specific details you could not confirm.
2. **Model the data first.** Before any API call, define the order/payment record, its states and allowed transitions, the unique constraints that enforce idempotency, and (for anything holding value) the ledger. Show this to the user: it is the part that is expensive to change later.
3. **Write the flow:** create payment server-side with server-derived amount → hand the client only what it needs (client secret, checkout URL, public key + reference) → confirm via verified webhook and/or server verification → fulfil idempotently inside a transaction.
4. **Write the webhook handler** per `references/webhooks.md`.
5. **Cover the non-happy paths** the flow can hit (step 9 of the invariants).
6. **Give the user a test plan**: the provider's test mode, test cards/numbers for failure cases, how to replay webhooks locally, and a duplicate-delivery test. See `references/testing.md`. `scripts/sign-webhook.cjs` can generate correctly signed webhook payloads for local testing.
7. **State what is out of scope or assumed** (e.g. tax, invoicing, regional regulatory requirements) rather than silently skipping them.

Match the project's existing language, framework, ORM, and style. Use the provider's official SDK when the project already has it or when it handles signature verification for you.

## Audit workflow

1. **Map the money paths.** Find every place that creates a payment, receives a webhook/callback, verifies a payment, changes a balance, creates a refund or payout, or grants an entitlement because of a payment. `node scripts/find-payment-code.cjs <repo-root>` lists likely files to start from; it is a starting point, not a complete inventory, so follow the call graph from each entry point.
2. **Trace each path against the invariants**, then against `references/audit-checklist.md`, which lists the concrete defect patterns to look for, grouped by area, with how to confirm each one.
3. **Confirm before reporting.** For each suspected defect, trace the actual code path and write the concrete scenario: what the attacker or the unlucky user does, and what goes wrong (who gains or loses what). If you cannot write the scenario, it is not a finding yet: note it as a question instead. False positives in payment audits waste a lot of trust.
4. **Rank by money at risk** using the severity rubric below.
5. **Write the report** in the format below. If the user wants machine-readable output too, also emit JSON matching `report-schema.json` and check it with `node scripts/validate-findings.cjs findings.json`.

### Severity

- **Critical**: anyone can obtain value without paying, or take someone else's money, with little effort. (Client-controlled amount; fulfilment from redirect params; unverified webhooks; withdrawals that race past the balance check.)
- **High**: money is lost or misallocated under realistic conditions without an attacker. (Non-idempotent webhook credits twice on retry; reversed payouts never refunded to the wallet; float rounding on every transaction.)
- **Medium**: money is at risk under rarer conditions, or the system cannot detect/repair errors. (No reconciliation; refunds don't revoke entitlements; missing handling for async payment methods.)
- **Low**: hardening and hygiene. (Secret keys in logs; no test/live key separation checks; webhook endpoint does slow work synchronously.)

### Report format

```markdown
# Payments audit: <project>

## Summary
<2-4 sentences: overall state, the most serious problem, what to fix first.>

## Money paths reviewed
<Bulleted list of each path and its entry file, so the reader knows coverage.>

## Findings

### [CRITICAL] <short title>
- **Where:** `path/to/file.ts:42`
- **What:** <the defect in one or two sentences>
- **Scenario:** <concrete steps → concrete loss>
- **Fix:** <specific change, with a code snippet when it helps>

<…repeat, most severe first…>

## Open questions
<Things that could be defects but depend on information not in the code (provider dashboard settings, infra, business rules).>

## What is done well
<Brief. Helps the reader trust the rest and avoid regressing it.>
```

## Debug workflow

Common causes, roughly in order of frequency:

- **Signature verification fails** → the body was parsed before verification (Express `express.json()` before the webhook route, Next.js body parsing, a framework that re-serializes), the wrong secret (test vs live, or the endpoint secret vs the API key), or trailing whitespace/newlines in an env var.
- **Webhook never arrives** → wrong URL/environment in the dashboard, endpoint not publicly reachable, a firewall/WAF/auth middleware blocking it, or the event type was not subscribed.
- **Paid but still pending** → fulfilment depends on a redirect that never happened, the handler threw after acknowledging, or it matched on the wrong reference field.
- **Credited twice** → no unique constraint on the event/reference, or a check-then-write race between the webhook and a verify call running at the same time.
- **Balance drift** → floats, missing ledger entries for some transition (reversals, fees, refunds), or non-atomic updates.

After fixing, look for the same pattern in sibling handlers; a missing raw-body or idempotency guard is rarely limited to one route.

## Reference map

Read only what the task needs.

| Need | File |
|---|---|
| Amounts, currencies, decimal places, rounding, FX | `references/money-and-currency.md` |
| Payment lifecycle, checkout patterns, redirects, 3DS/SCA, async methods | `references/checkout-and-lifecycle.md` |
| Webhook handler design, signature verification, retries, ordering | `references/webhooks.md` |
| Idempotency keys, unique constraints, ledgers, wallets, concurrency | `references/idempotency-and-ledger.md` |
| Subscriptions, renewals, dunning, plan changes, trials | `references/subscriptions.md` |
| Payouts, transfers, withdrawals, marketplaces and split payments | `references/payouts-and-marketplaces.md` |
| Refunds, disputes/chargebacks, reversals | `references/refunds-and-disputes.md` |
| Reconciliation and settlement | `references/reconciliation.md` |
| Test modes, test data, replaying webhooks, what to test | `references/testing.md` |
| Keys, PCI scope, fraud controls, compliance pointers | `references/security-and-compliance.md` |
| Concrete defect patterns for audits | `references/audit-checklist.md` |
| Provider specifics | `references/providers/<provider>.md`: `stripe`, `paypal`, `paystack`, `flutterwave`, `razorpay`, `adyen`, `mercadopago`, `square`, `others` (Monnify, M-Pesa, Mollie, Braintree, Checkout.com, Paddle, Lemon Squeezy, Xendit) |

## About provider details

Providers change their APIs, header names, and event names. The provider files record what was accurate when written and say where to confirm. When a detail matters for correctness (a signature algorithm, a header name, the unit an amount is expressed in) and you can read the provider's current docs or the installed SDK source, check it. When you cannot, say which detail you relied on so the user can verify it, rather than presenting it as certain.
