# Idempotency, ledgers, and concurrency

## Two directions of idempotency

**Inbound** (things that happen to you: webhooks, callbacks, user retries): enforce with database unique constraints and conditional updates. See `webhooks.md`.

**Outbound** (things you ask the provider to do: create charge, refund, transfer): send an idempotency key so a retry after a timeout does not create a second charge or payout.

| Provider | Outbound idempotency |
|---|---|
| Stripe | `Idempotency-Key` header on POST (SDKs: `{ idempotencyKey }` option). Keys kept ~24h |
| PayPal | `PayPal-Request-Id` header |
| Adyen | `Idempotency-Key` header |
| Square | `idempotency_key` body field (required on most create endpoints) |
| Razorpay | Use your unique `receipt` on orders; check for an existing payout/refund by your reference before retrying; payouts API supports `X-Payout-Idempotency` |
| Paystack | `reference` is unique per transaction/transfer: reuse the same reference when retrying a transfer, and the API rejects duplicates |
| Flutterwave | `reference`/`tx_ref` unique per transfer/charge: same approach |

The key must be derived from *your* operation (e.g. `refund:{order_id}:{attempt}` or a UUID stored on the pending row before the call), not generated fresh on each retry: a fresh key defeats the purpose.

When the provider has no idempotency support and a call times out, the outcome is unknown. Do not retry blindly. Mark the operation `unknown`, query the provider by your reference, and only retry when you have confirmed it did not happen.

## The pending-row pattern for outbound money movement

```
1. In a transaction: insert payout row (status: pending, reference: new unique ref),
   debit the ledger (or place a hold). Commit.
2. Call the provider with that reference / idempotency key.
3. Record the provider's response (status: processing / failed + provider ID).
4. Final status arrives by webhook → success: finalize; failed/reversed: credit the ledger back.
```

Writing the row *before* the call means a crash between steps 2 and 3 leaves a record you can reconcile, rather than money sent with no trace. Debiting before the call means two concurrent withdrawals cannot both spend the same balance.

## Ledgers

For any feature where users hold value (wallets, credits, marketplace seller balances, escrow, referral bonuses), use a ledger.

Minimal design (single-entry, per account):

```sql
CREATE TABLE ledger_entries (
  id            BIGSERIAL PRIMARY KEY,
  account_id    BIGINT NOT NULL REFERENCES accounts(id),
  currency      CHAR(3) NOT NULL,
  amount_minor  BIGINT NOT NULL,          -- positive credit, negative debit
  kind          TEXT NOT NULL,            -- 'topup', 'withdrawal', 'withdrawal_reversal', 'fee', 'refund', ...
  reference     TEXT NOT NULL,            -- payment ref, payout ref, etc.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, reference)                -- the same top-up cannot be credited twice
);
```

Balance = `SUM(amount_minor) WHERE account_id = ? AND currency = ?`. Entries are never updated or deleted; corrections are new entries.

Double-entry (every movement is a pair of entries that sum to zero across accounts, including system accounts like `provider_clearing`, `fees`, `payouts_in_flight`) is better once money moves between users, you take fees, or finance needs to close books. It makes "where did this money go" answerable and makes imbalances detectable by a single query. Recommend it for marketplaces and anything holding significant customer funds.

### Cached balances

Summing the ledger on every read gets slow. A `balance_minor` column on the account is fine if it is updated **in the same transaction** as the ledger insert, using a relative update:

```sql
BEGIN;
INSERT INTO ledger_entries (...) VALUES (...);         -- unique constraint guards duplicates
UPDATE accounts SET balance_minor = balance_minor + $amount WHERE id = $account;
COMMIT;
```

Never `SET balance = <value computed in application code>`: that is a lost-update race. Periodically verify that cached balances equal ledger sums.

### Holds

Withdrawals pending, escrow, and authorizations need "available" vs "pending/held" balances. Model a hold as its own entry (or a separate held account in double-entry) that moves to final on success and back on failure.

## Concurrency patterns

The bug: two requests both read balance 1000, both check `1000 >= 800`, both write `200`, two payouts of 800 go out.

Fixes, from simplest:

1. **Conditional update**: the check and the write are one statement:
   ```sql
   UPDATE accounts SET balance_minor = balance_minor - $1
   WHERE id = $2 AND balance_minor >= $1
   RETURNING balance_minor;   -- no row returned → insufficient funds
   ```
2. **Row lock**: `SELECT ... FROM accounts WHERE id = $1 FOR UPDATE` inside a transaction, then check and write.
3. **Serializable isolation** with retry on serialization failure.
4. **Single-writer queue** per account, for very high contention.

ORMs: Prisma (`$transaction` + `updateMany` with a `where` on balance and check `count`, or raw SQL `FOR UPDATE`), TypeORM (`setLock('pessimistic_write')`), Sequelize (`lock: t.LOCK.UPDATE`), Django (`select_for_update()` / `F()` expressions), Rails (`lock!`/`with_lock`), Laravel (`lockForUpdate()`), Mongoose (atomic `findOneAndUpdate` with `$inc` and a balance condition; or multi-document transactions on a replica set). An ORM `findOne` → modify in JS → `save()` sequence is the racy version.

MongoDB note: a `$inc` with a filter `{ _id, balance: { $gte: amount } }` is atomic for a single document; updating a ledger collection and a balance document together needs a transaction.

Redis or in-memory locks are not a substitute for database-level guarantees unless they are correctly implemented across all instances, and they still need the DB constraint as the last line of defence.

## User-facing idempotency

For "Pay" or "Withdraw" buttons, have the client generate an idempotency key per intent (UUID when the form loads), send it with the request, and store it with a unique constraint. A double click or a retried request then returns the original result instead of creating a second operation.
