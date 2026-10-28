---
type: llm
focus: trace
weight: 1
---

audit.md reports that charge.success can credit the wallet more than once (webhook retries, or webhook plus callback both crediting) because there is no idempotency guard such as a unique constraint or conditional status update.
