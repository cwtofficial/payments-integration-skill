---
type: llm
focus: trace
weight: 1
---

The fix makes the status transition atomic and conditional (e.g. prisma.payment.updateMany with a where on status and checking count, or a unique constraint) and performs it together with the wallet increment inside a single transaction.
