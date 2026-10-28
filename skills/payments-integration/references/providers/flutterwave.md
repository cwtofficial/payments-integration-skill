# Flutterwave

Docs: https://developer.flutterwave.com. This file describes the widely deployed **v3** API. Flutterwave has introduced newer API versions (OAuth client credentials, different endpoints, HMAC-signed webhooks). Check which version the project uses, look at the base URL and auth, and confirm details for that version.

## Keys (v3)
Public `FLWPUBK-…`, secret `FLWSECK-…` (test keys contain `_TEST`), encryption key for direct card charges. Base URL `https://api.flutterwave.com/v3`, `Authorization: Bearer <secret>`.

## Amounts
**Major units** as a number: `amount: 5000` = ₦5,000. This is the opposite of Stripe/Paystack, convert at the boundary. Compare amounts carefully (floating representation of decimals for currencies like USD, convert to minor units with rounding before comparing).

## One-off payment (Standard / hosted)

```js
const res = await fetch('https://api.flutterwave.com/v3/payments', {
  method: 'POST',
  headers: { Authorization: `Bearer ${FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tx_ref: payment.reference,            // unique, stored before the call
    amount: toMajor(order.amountMinor, 'NGN'),
    currency: 'NGN',
    redirect_url: `${APP_URL}/payments/flutterwave/callback`,
    customer: { email: user.email, name: user.name },
    meta: { orderId: order.id },
  }),
});
// → data.link (redirect the customer)
```

Redirect returns `?status=successful|cancelled&tx_ref=…&transaction_id=…`. **Do not trust `status`**. Verify:

```js
const { data } = await (await fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
  headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` },
})).json();
const ok = data.status === 'successful'
  && toMinor(data.amount, data.currency) === payment.amountMinor
  && data.currency === payment.currency
  && data.tx_ref === payment.reference;
```

Or by reference: `GET /transactions/verify_by_reference?tx_ref=…`. Flutterwave's own guidance is to check `status`, `currency`, `tx_ref`, and that `amount` is at least the expected amount: exact match is safer unless you intend to accept overpayment. Note `charged_amount` may include fees passed to the customer.

## Webhooks (v3)
- You set a **secret hash** in the dashboard. Flutterwave sends it as the `verif-hash` header. Compare it to your stored value with a constant-time comparison. This is a shared secret, not a signature over the body: so always re-verify the transaction via the API before acting.
- Return 200 promptly. Retries can be enabled in the dashboard.
- Key events: `charge.completed` (check `data.status`: it can be `successful` or `failed`), `transfer.completed` (check `data.status`: `SUCCESSFUL`/`FAILED`), subscription events (`subscription.cancelled`).
- Dedupe on `event` + `data.id` + `data.status`.

## Transfers (payouts)
- Resolve account: `POST /accounts/resolve` (`account_number`, `account_bank`).
- `POST /transfers` with `account_bank`, `account_number`, `amount` (major units), `currency`, `narration`, `reference` (unique: reuse on retry), optional `callback_url`.
- Initial status is usually `NEW`/`PENDING`; final via `transfer.completed` webhook or `GET /transfers/:id`. Failed transfers must restore balance.
- Bulk: `POST /bulk-transfers`.

## Subaccounts / splits
`POST /subaccounts`, then pass `subaccounts: [{ id, transaction_charge_type, transaction_charge }]` on payment.

## Payment plans
`POST /payment-plans`, then pass `payment_plan` on payment. Renewals arrive as `charge.completed`.

## Refunds
`POST /transactions/:id/refund` with optional `amount`. Check status later: refunds can be pending.

## Gotchas
- Trusting `status=successful` in the redirect query string.
- Sending kobo (minor units): 100× overcharge.
- Treating `verif-hash` as sufficient without re-verifying via API.
- `charge.completed` doesn't mean success: check `data.status`.
- Verify call uses `transaction_id` from the query string but doesn't check that `tx_ref` matches this order.

## Testing
Test cards and helpers: https://developer.flutterwave.com/docs/integration-guides/testing-helpers.
