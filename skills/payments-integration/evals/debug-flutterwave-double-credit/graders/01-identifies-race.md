---
type: llm
focus: trace
weight: 1
---

The response explains that the double credit comes from a check-then-act race: the webhook and the callback redirect (or two webhook deliveries) both read status as not successful before either writes it, because the read, the wallet increment, and the status update are separate non-atomic steps.
