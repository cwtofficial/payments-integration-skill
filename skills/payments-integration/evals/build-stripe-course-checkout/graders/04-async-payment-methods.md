---
type: llm
focus: trace
weight: 1
---

The webhook grants access on checkout.session.completed only when payment_status is 'paid', and handles checkout.session.async_payment_succeeded (grant) and checkout.session.async_payment_failed.
