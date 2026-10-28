---
type: llm
focus: trace
weight: 1
---

audit.md reports that /wallet/withdraw checks the balance in application code and debits later (after the transfer call), so concurrent withdrawals can overdraw the wallet.
