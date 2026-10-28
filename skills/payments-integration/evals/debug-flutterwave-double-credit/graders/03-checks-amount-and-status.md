---
type: llm
focus: trace
weight: 1
---

The fix checks the verified transaction's data.status === 'successful', and that its amount, currency and tx_ref match the stored payment, instead of only the top-level response status.
