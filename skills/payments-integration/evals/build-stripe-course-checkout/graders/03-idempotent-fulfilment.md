---
type: llm
focus: trace
weight: 1
---

Fulfilment is idempotent: the Prisma schema has a unique constraint (e.g. on stripe event id, session id, or userId+courseId purchase) and the handler relies on it or on a conditional update, so a duplicate webhook cannot grant or record the purchase twice.
