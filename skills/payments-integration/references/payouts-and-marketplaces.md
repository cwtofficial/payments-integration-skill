# Payouts, withdrawals, and marketplaces

Payouts are where payment systems lose the most money, because a mistake sends real funds out to a real bank account and is often irreversible.

## Withdrawal flow

```
1. Validate: amount > 0, integer minor units, ≥ minimum, ≤ limits, currency matches the wallet.
2. Authorize: the user owns the wallet; the destination account belongs to (or was verified by) the user;
   step-up auth (password/OTP/2FA) for new destinations or large amounts.
3. In one DB transaction:
     - debit available balance with a conditional update (balance >= amount), or move to "held"
     - insert payout row: status=pending, unique reference, amount, fee, destination snapshot
4. Commit, then call the provider transfer API with the unique reference / idempotency key.
5. Record provider transfer ID and status (often "pending"/"processing", not final).
6. Webhook: success → mark paid; failed or reversed → credit the amount (and fee, per policy) back to the wallet.
7. Reconcile payouts that stay pending too long by querying the provider.
```

Getting step 3 wrong (checking balance in application code, then debiting later) is the most common critical bug in wallet apps. Two concurrent requests both pass the check.

Getting step 6 wrong is the most common high-severity bug: a transfer the provider later fails or reverses (`transfer.failed`, `transfer.reversed` on Paystack; failed status on Flutterwave transfers; `payout.failed`/`payout.reversed` on Razorpay X; `payout.failed` on Stripe) leaves the user's balance debited for money they never received.

## Destination accounts

- Resolve/verify bank accounts before saving them (Paystack `/bank/resolve` + transfer recipients; Flutterwave account resolve; Razorpay fund accounts and validation; Stripe Connect external accounts are verified by Stripe). Show the resolved account name to the user for confirmation.
- Snapshot the destination on the payout row, so later edits do not change where a past payout claims to have gone.
- Adding or changing a payout destination is an account-takeover target. Require re-authentication, notify the user on another channel, and consider a cooling-off period before first use.

## Fees

Decide who pays the transfer fee (user or platform) and record it as its own ledger entry, so `sum(ledger)` still explains every unit of currency. If the fee comes out of the withdrawal, the transfer amount is `amount - fee`: make sure what you send is what you debited.

## Provider-side controls

- Some providers require OTP confirmation for transfers by default (Paystack: transfers may need `finalize_transfer` with OTP unless disabled in the dashboard). Automated payouts usually need this turned off, and therefore need strong controls on your side.
- Keep the payout balance on the provider topped up separately from your collections; a payout failing for insufficient provider balance must be handled (retry later, not "failed forever").
- Use API-level IP allowlisting for the transfer API where the provider offers it.

## Admin-initiated payouts

Admin tools that approve withdrawals or move funds need: role checks on the server (not just a hidden button), an audit log (who, what, when, before/after), two-person approval for large amounts, and the same idempotency as user payouts: an admin double-clicking "Approve" must not send twice.

## Marketplaces and split payments

Options:

| Provider | Feature |
|---|---|
| Stripe | Connect: destination charges (`transfer_data.destination`, `application_fee_amount`), separate charges and transfers, direct charges on connected accounts (`Stripe-Account` header). Express/Standard/Custom accounts |
| Paystack | Subaccounts (split per transaction, `subaccount` + `transaction_charge`/`bearer`) and Split groups (`split_code`) |
| Flutterwave | Subaccounts and `subaccounts` array on charges |
| Razorpay | Route (transfers to linked accounts) |
| Adyen | Adyen for Platforms (balance platform, split instructions) |
| PayPal | Multiparty / partner referrals, `payee` and `platform_fees` |
| Mercado Pago | Marketplace with `marketplace_fee` |

Using the provider's split feature generally keeps you out of holding funds on others' behalf, which in many jurisdictions is a regulated activity (money transmission / e-money / payment institution licences). If the user is building escrow or holding customer funds in their own account to pay out later, flag this as a regulatory question for them to confirm locally: do not assume it's fine.

Marketplace checks:

- Fee computed server-side from your rules, never from the request.
- Seller onboarding/KYC complete before they can receive funds (Stripe: `charges_enabled`/`payouts_enabled`; others have equivalents).
- Refunds and disputes: decide whether the seller's share is reversed (Stripe `reverse_transfer`, `refund_application_fee`), and ensure the ledger reflects it.
- Holding period / escrow release only on a verified condition (delivery confirmed, dispute window passed), with the release itself idempotent.
