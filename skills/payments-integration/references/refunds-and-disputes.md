# Refunds, disputes, and reversals

## Refunds

- **Who can refund:** server-side role check. A customer-facing "cancel order" that triggers a refund needs the same idempotency and authorization as an admin refund.
- **How much:** track `refunded_minor` on the payment; reject a refund that would make `refunded_minor > amount_minor`. Do this with a conditional update so two concurrent partial refunds cannot over-refund.
- **Idempotency:** send an idempotency key (Stripe, PayPal, Adyen, Square) or a unique reference. A retried refund after a timeout must not refund twice.
- **Asynchronous:** many refunds are not instant (Stripe refunds can be `pending` and later `failed`; Paystack `refund.pending` → `refund.processed`/`refund.failed`; Razorpay `refund.created` → `refund.processed`/`refund.failed`). Record the refund as pending and finalize on the webhook.
- **Reverse what the payment granted:** revoke access, return stock, cancel the shipment, debit wallet credits that came from the payment, reverse marketplace transfers and fees as per policy. A refund that leaves the entitlement in place is free money.
- **Wallet top-up refunds:** if the user already spent the credited balance, the refund must either be blocked or put the wallet negative by policy — decide explicitly.
- **Refund to source:** refunds go back to the original payment method. Refunding a card payment by sending a bank transfer to an account the user names is a common fraud pattern (pay with a stolen card, ask for a refund to their own bank).

## Disputes / chargebacks

A cardholder can dispute a payment with their bank, often weeks or months later. The funds (plus a fee) are usually withdrawn from your balance immediately.

Handle:
- Stripe: `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` (with `status` won/lost), and `charge.dispute.funds_withdrawn`/`funds_reinstated`.
- Paystack: `charge.dispute.create`, `charge.dispute.remind`, `charge.dispute.resolve`.
- PayPal: `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, `CUSTOMER.DISPUTE.RESOLVED`.
- Adyen: `CHARGEBACK`, `NOTIFICATION_OF_CHARGEBACK`, `CHARGEBACK_REVERSED`, `SECOND_CHARGEBACK`.
- Razorpay: `payment.dispute.created`, `payment.dispute.won`, `payment.dispute.lost`, etc.

Actions: flag the order, optionally suspend the related entitlement or account, record the withdrawn funds in the ledger, alert someone, and gather evidence (receipts, delivery proof, logs, IP, customer communication) before the provider's deadline. For wallets: a disputed top-up whose balance was already withdrawn is a direct loss — that is why new-user withdrawal holds exist.

## Reversals of incoming payments

Some methods can be reversed after "success": ACH returns, SEPA debit returns (up to 8 weeks, 13 months for unauthorized), and bank-transfer recalls. If you credit a wallet from these, the reversal must debit it, and you should consider holding funds until the return window passes for risky flows.

## Refund-related fraud signals

- Refund requested immediately after a top-up with no usage.
- Refund destination differs from payment source.
- Many small payments followed by a large withdrawal (card testing / laundering).
