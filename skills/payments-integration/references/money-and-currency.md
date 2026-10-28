# Money and currency

## Representation

Store money as an integer count of the currency's minor unit, alongside the ISO 4217 currency code:

```sql
amount_minor BIGINT NOT NULL,      -- 150000 = ₦1,500.00 or $1,500.00
currency     CHAR(3) NOT NULL      -- 'NGN', 'USD'
```

Why integers: binary floating point cannot represent most decimal fractions exactly, so `19.99 * 3` becomes `59.97000000000001`, and summing thousands of transactions drifts. `DECIMAL/NUMERIC` columns are also exact and fine for storage; the danger is the language layer, where JavaScript `number`, Python `float`, and PHP floats silently lose precision. In code, keep integers (`bigint` in JS when values can exceed 2^53, which is rare for single payments but possible for aggregates) or use a decimal library (`decimal.js`, Python `Decimal`, Java `BigDecimal`, `brick/money`, `dinero.js`).

Never store a money amount without its currency. A bare `amount` column becomes a bug the day a second currency is added.

## Decimal places differ by currency

Most currencies have 2 decimal places, but not all. Get this from a table, never assume 2.

| Exponent | Examples |
|---|---|
| 0 | JPY, KRW, VND, CLP, ISK, UGX, XAF, XOF, RWF, PYG, KMF, GNF, BIF, DJF, VUV, XPF |
| 2 | USD, EUR, GBP, NGN, KES, GHS, ZAR, INR, BRL, MXN, CAD, AUD: most currencies |
| 3 | BHD, JOD, KWD, OMR, TND, LYD, IQD |

Providers sometimes diverge from ISO for specific currencies (for example, a provider may treat a currency as zero-decimal even though ISO says 2, or require 3-decimal amounts to be multiples of 10). Check the provider file and the provider's currency docs before supporting a new currency.

Converting for display: `major = minor / 10^exponent`, formatted with `Intl.NumberFormat` (JS) or an equivalent locale-aware formatter, not string concatenation.

## Provider unit conventions

The same ₦5,000 is sent differently to different providers. Mixing these up is a classic 100× bug.

| Provider | Unit sent in API |
|---|---|
| Stripe | Integer minor units (`amount: 500000` for ₦5,000), zero-decimal currencies as whole units |
| Paystack | Integer minor units (kobo, pesewas, cents) |
| Razorpay | Integer minor units (paise) |
| Adyen | `{ value: <minor units integer>, currency }` |
| Square | `amount_money: { amount: <minor units>, currency }` |
| PayPal | Decimal string in major units (`"5000.00"`), with currency-specific decimals |
| Flutterwave (v3) | Major units as a number (`amount: 5000`) |
| Monnify | Major units as a number |
| M-Pesa (Daraja) | Whole KES as integer |
| Mercado Pago | Major units as a decimal number (`transaction_amount: 50.5`) |

Write one conversion function per provider at the boundary (`toProviderAmount`, `fromProviderAmount`) and use it everywhere; never convert inline. When verifying a payment, convert the provider's reported amount back to minor units and compare integers.

## Rounding

Rounding happens when you compute percentages (fees, tax, discounts, splits, FX). Rules:

- Round once, at the end of a calculation, not at each step.
- Choose a rounding mode deliberately (banker's rounding, half-even, for accounting; half-up is common for display) and use it consistently.
- When splitting an amount (marketplace splits, installments), allocate the remainder explicitly so the parts sum to the whole. `1000 / 3` → `[334, 333, 333]`, not `[333, 333, 333]` with 1 minor unit lost. Libraries like `dinero.js` have `allocate`.
- Fees and taxes the provider charges are the provider's numbers. Record what the provider reports (e.g. Stripe balance transaction `fee`, Paystack `fees`) rather than recomputing them.

## Multi-currency and FX

- Charge in the currency you priced in. If you show a converted price, the customer must be charged that converted amount in that currency, or told clearly that their bank will convert.
- Store the original amount and currency *and* any converted/settlement amount and currency, plus the rate and its timestamp/source. You need all of them to explain a discrepancy later.
- Wallets that hold multiple currencies need one balance per currency; never sum across currencies.
- Settlement currency can differ from charge currency (a USD charge settled in NGN, or EUR settled in GBP). Reconciliation must compare the right pair.

## Validation at the boundary

Reject, server-side:

- non-integer or negative minor-unit amounts (zero only where it is meaningful, like a $0 trial authorization),
- currencies you do not support,
- amounts below the provider's minimum for that currency or above your own limits.

Do this even when the amount comes from your own database: it catches bad data before it becomes a bad charge.
