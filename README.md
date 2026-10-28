# Payments Integration Skill

An agent skill from [Create With Tech](https://cwt.build) for Claude Code and other agents that support the [Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) format.

## Skills

| Skill | What it does |
|---|---|
| [payments-integration](skills/payments-integration/SKILL.md) | Build, audit, and debug payment integrations with any provider — Stripe, PayPal, Paystack, Flutterwave, Razorpay, Adyen, Mercado Pago, Square, Monnify, M-Pesa and more. Covers checkout, webhooks, idempotency, wallets and ledgers, subscriptions, refunds, payouts, marketplaces, multi-currency, and reconciliation. |

## Install

**Claude Code (personal):**
```bash
git clone https://github.com/cwtofficial/payments-integration-skill.git
cp -r payments-integration-skill/skills/payments-integration ~/.claude/skills/
```

**Claude Code (one project):** copy the skill folder into `.claude/skills/` in the project.

**Claude.ai:** zip the skill folder and upload it under Settings → Capabilities → Skills.

Then ask naturally — "add Paystack checkout to this app", "audit our Stripe webhooks", "users are getting credited twice" — and the skill loads when it's relevant.

## payments-integration at a glance

- **Three modes:** build (correct-by-default integration code), audit (ranked findings with file/line and a concrete loss scenario), debug (root cause plus a sweep for the same bug elsewhere).
- **Provider-agnostic core:** eleven invariants that prevent the bugs that actually lose money — client-controlled amounts, trusting redirects, missing webhook verification, double credits, withdrawal races, unhandled reversals, floating-point money.
- **Provider references:** Stripe, PayPal, Paystack, Flutterwave, Razorpay, Adyen, Mercado Pago, Square, plus notes on Monnify, M-Pesa, Mollie, Braintree, Checkout.com, Paddle, Lemon Squeezy, Xendit, and a checklist for any provider not listed.
- **Scripts (Node, no dependencies):**
  - `scripts/find-payment-code.cjs` — map the money paths in a repo to start an audit.
  - `scripts/sign-webhook.cjs` — generate correctly signed webhook requests to test handlers locally.
  - `scripts/validate-findings.cjs` — validate audit output against `report-schema.json`.

```bash
node --test skills/payments-integration/scripts/scripts.test.cjs
```

## Contributing

Provider APIs change. If you find a detail that is wrong or out of date, open a PR with a link to the provider's current documentation. New provider files are welcome — follow the shape of `references/providers/paystack.md` and answer the seven questions at the end of `references/providers/others.md`.

## About

Built and maintained by [Create With Tech](https://cwt.build) — [cwt.build](https://cwt.build) · [GitHub](https://github.com/cwtofficial).

## License

MIT — see [LICENSE](LICENSE).
