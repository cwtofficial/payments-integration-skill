---
type: llm
focus: trace
weight: 1
---

The webhook route reads the raw body with req.text() (or equivalent) and verifies it with stripe.webhooks.constructEvent and the webhook secret, returning 400 on failure.
