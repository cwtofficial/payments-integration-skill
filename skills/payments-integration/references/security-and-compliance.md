# Security and compliance

## Keys and secrets

- Secret API keys and webhook secrets live in server environment/secret storage only. Publishable/public keys are the only keys that may reach the browser or mobile app.
- Mobile apps: never ship a secret key in the app binary: it can be extracted. All secret-key calls go through your backend.
- Use restricted/limited keys where the provider supports them (Stripe restricted keys; scoped credentials elsewhere), especially for services that only need read access.
- Rotate keys when people leave or a leak is suspected; know where each key is used so rotation does not cause an outage.
- Don't log full request/response bodies from payment APIs without redaction: they may contain keys in headers, tokens, personal data, and sometimes card details. Redact `Authorization`, signature headers, and anything that looks like a PAN.
- Check `.env` files are git-ignored and scan history if a key was ever committed (treat committed keys as leaked and rotate).

## PCI DSS scope

If raw card numbers (PAN) ever touch your servers or your JavaScript, you are in the heaviest compliance scope. Keep scope minimal:

- Hosted checkout or redirect → typically SAQ A.
- Provider-hosted fields/iframes (Stripe Elements, Adyen components, Square Web Payments SDK) → typically SAQ A (or A-EP for some direct-post integrations).
- Your own card form posting to your server → SAQ D. Avoid.

Never store CVV/CVC, even encrypted. Never log card numbers. Store only provider tokens and display data (brand, last4, expiry).

The page that hosts payment fields still matters: PCI DSS v4 requires controls on scripts running on payment pages (inventory and integrity of scripts, CSP). Keep third-party scripts on checkout pages to a minimum.

## Fraud controls

Proportionate to risk; most apps need a few, not all:

- Rate-limit payment and verify endpoints per user and per IP to stop card testing (many small authorizations with stolen cards).
- Use the provider's fraud tools (Stripe Radar, Adyen RevenueProtect, PayPal fraud protection, Razorpay Thirdwatch, Paystack/Flutterwave risk settings).
- New-account and new-destination holds before withdrawals; velocity limits on top-ups and withdrawals.
- Require verified email/phone and, where funds can be withdrawn, KYC proportionate to local rules.
- Watch for top-up then immediate withdrawal (laundering / stolen-card cash-out).
- Use CAPTCHA or proof-of-work on public payment forms that are being abused.

## Authorization

- Every endpoint that reads or changes a payment, order, wallet, or payout checks the authenticated user owns it (IDOR is common in `/orders/:id/verify`, `/wallets/:id/withdraw`, `/payouts/:id`).
- Admin financial actions require server-side role checks and audit logging.

## Compliance pointers (flag, don't decide)

The skill should raise these as questions when relevant, not give legal conclusions:

- Holding customer funds / wallets / escrow can require an e-money, payment institution, or money transmitter licence depending on jurisdiction, or a regulated partner.
- KYC/AML obligations scale with the ability to withdraw money and with amounts.
- Strong Customer Authentication (EEA/UK), RBI card-on-file tokenization and recurring mandates (India), local data residency rules, and tax (VAT/GST/sales tax) collection obligations.
- Consumer protection: clear pricing, cancellation terms for subscriptions (several jurisdictions require easy online cancellation), and receipts.
