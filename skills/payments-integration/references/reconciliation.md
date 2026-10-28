# Reconciliation

Real-time paths (webhooks, verify calls) are the fast path. Reconciliation is the safety net that catches whatever the fast path missed: lost webhooks, handler bugs, deploys that dropped events, provider incidents, manual dashboard actions.

## Three levels

1. **Transaction status sweep (do this from day one).** A job every few minutes to hourly that finds your records stuck in non-final states (`pending`, `processing`, payouts `pending`) older than a threshold and queries the provider for their real status, then applies the same idempotent transition the webhook would have. Cheap, catches most problems.

2. **Daily transaction reconciliation.** Pull the provider's list of transactions for the previous day (Stripe balance transactions / charges list; Paystack `GET /transaction` with `from`/`to`; Flutterwave `GET /transactions`; Razorpay `GET /payments` with `from`/`to`; PayPal transaction search / reports; Adyen settlement detail reports) and match against your records by reference:
   - in provider, not in yours → missed payment (customer paid, got nothing) — highest priority to fix
   - in yours as paid, not in provider (or failed there) → you fulfilled without being paid
   - in both, amount/currency/status differ → investigate
3. **Settlement/payout reconciliation.** Match the provider's settlements to your bank deposits, and the sum of transactions minus fees and refunds to each settlement. This is what finance needs to close books, and it detects fee errors and missing settlements.

## Implementation notes

- Reconcile on your own reference plus the provider's ID; store both on every record.
- Run with the same idempotent transitions as the webhook handler, so a reconciliation fix and a late webhook can't double-apply.
- Produce a report of mismatches for humans; auto-fix only the safe direction (marking a confirmed-paid order as paid), and require a human for anything that removes value from a user.
- Check ledger integrity as part of the same job: cached balances equal ledger sums; in double-entry, every transaction sums to zero.
- Paginate provider list APIs fully and respect rate limits; reconciliation that silently reads only the first page is worse than none because it creates false confidence.
- Watch for timezone boundaries — provider reports may be in UTC or the account's timezone.
