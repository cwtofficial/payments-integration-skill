---
type: llm
focus: trace
weight: 1
---

The checkout route takes only a course identifier from the client and loads the price from the database (priceCents), never an amount from the request body.
