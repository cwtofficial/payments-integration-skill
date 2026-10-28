---
type: llm
focus: trace
weight: 1
---

audit.md reports that the Paystack webhook signature is computed over JSON.stringify(req.body) instead of the raw body AND that a failed signature check only logs and still processes the event.
