#!/usr/bin/env node
// List files that likely contain payment logic, grouped by what they appear to do.
// A starting point for an audit's money-path map, not a complete inventory:
// follow the call graph from each hit.
//
// Usage: node find-payment-code.cjs <repo-root> [--json]

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'coverage',
  'vendor', '.venv', 'venv', '__pycache__', '.turbo', '.cache', 'target', 'bin', 'obj', '.expo',
]);
const EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.php', '.go', '.java', '.kt', '.cs',
  '.rs', '.ex', '.exs', '.dart', '.swift', '.vue', '.svelte', '.prisma', '.sql',
]);
const MAX_BYTES = 1_000_000;

// Each category: a label and the patterns that suggest it. Order is the order of the report.
const CATEGORIES = [
  ['provider', 'Provider SDK / API usage', [
    /\bstripe\b/i, /paystack/i, /flutterwave|\bflw\b/i, /razorpay/i, /paypal|braintree/i, /adyen/i,
    /mercadopago|mercado_pago/i, /squareup|square\.(payments|client)/i, /monnify/i, /mpesa|daraja|stkpush/i,
    /mollie/i, /checkout\.com|\bcko\b/i, /paddle/i, /lemonsqueezy|lemon_squeezy/i, /xendit/i,
  ]],
  ['webhook', 'Webhook / callback handlers', [
    /webhook/i, /callback_url|callbackurl|redirect_url|return_url|success_url/i,
    /x-paystack-signature|stripe-signature|verif-hash|x-razorpay-signature|monnify-signature|x-signature/i,
    /constructEvent|validateWebhookSignature|verify-webhook-signature/,
  ]],
  ['verify', 'Payment verification / status checks', [
    /transaction\/verify|transactions\/.*\/verify|verify_by_reference|\/payments\/[^'"`]*capture/i,
    /payment_status|paymentStatus|status\s*===?\s*['"](success|successful|paid|captured|approved|COMPLETED)['"]/,
  ]],
  ['balance', 'Balances / wallets / ledgers', [
    /\bbalance\b/i, /\bwallet/i, /\bledger/i, /\bcredit(s|ed)?\b\s*[(=+]/i, /\$inc\b/,
  ]],
  ['payout', 'Payouts / transfers / withdrawals', [
    /withdraw/i, /payout/i, /\btransfer(s|recipient)?\b/i, /disbursement/i, /\bb2c\b/i,
  ]],
  ['refund', 'Refunds / disputes / reversals', [
    /refund/i, /dispute|chargeback/i, /revers(al|ed)/i,
  ]],
  ['subscription', 'Subscriptions / billing', [
    /subscription/i, /\binvoice/i, /\bplan(_id|Id|_code)?\b/, /renewal|dunning|trial/i,
  ]],
  ['amount', 'Amount handling (check units and floats)', [
    /parseFloat\([^)]*(amount|price|total)/i, /(amount|price|total)\w*\s*\*\s*100\b/i, /toFixed\(\s*2\s*\)/,
    /\bfloat\b.*(amount|price|balance)/i, /(amount|price|balance).*\bfloat\b/i, /Decimal\(|BigDecimal|dinero/,
  ]],
  ['idempotency', 'Idempotency / locking (good signs)', [
    /idempotency[-_]?key|PayPal-Request-Id|X-Idempotency-Key|Cko-Idempotency-Key/i,
    /FOR UPDATE|lockForUpdate|select_for_update|pessimistic_write|LOCK\.UPDATE|with_lock|\block!/,
    /ON CONFLICT|@@unique|unique:\s*true|UNIQUE\s*\(/i,
  ]],
];

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') {
      if (entry.isDirectory()) continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, files);
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
}

function scanFile(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (stat.size > MAX_BYTES) return null;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const hits = {};
  lines.forEach((line, i) => {
    for (const [key, , patterns] of CATEGORIES) {
      if (patterns.some((p) => p.test(line))) {
        (hits[key] ||= []).push(i + 1);
      }
    }
  });
  return Object.keys(hits).length ? hits : null;
}

function scan(root) {
  const files = [];
  walk(root, files);
  const results = [];
  for (const file of files) {
    const hits = scanFile(file);
    if (hits) results.push({ file: path.relative(root, file), hits });
  }
  return results;
}

function report(results) {
  const out = [];
  for (const [key, label] of CATEGORIES) {
    const matches = results
      .filter((r) => r.hits[key])
      .sort((a, b) => b.hits[key].length - a.hits[key].length);
    if (!matches.length) continue;
    out.push(`\n## ${label} (${matches.length} files)`);
    for (const m of matches.slice(0, 40)) {
      const lines = m.hits[key];
      const shown = lines.slice(0, 6).join(', ') + (lines.length > 6 ? `, … (+${lines.length - 6})` : '');
      out.push(`- ${m.file}  [lines ${shown}]`);
    }
    if (matches.length > 40) out.push(`- … and ${matches.length - 40} more`);
  }
  // Files touching several money areas at once are usually the core of the flow.
  const core = results
    .map((r) => ({ file: r.file, areas: Object.keys(r.hits).filter((k) => k !== 'idempotency') }))
    .filter((r) => r.areas.length >= 3)
    .sort((a, b) => b.areas.length - a.areas.length)
    .slice(0, 20);
  if (core.length) {
    out.unshift(`\n## Start here: files touching 3+ money areas`, ...core.map((c) => `- ${c.file}  (${c.areas.join(', ')})`));
  }
  return out.join('\n').trim();
}

function main() {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--'));
  if (!root) {
    console.error('usage: node find-payment-code.cjs <repo-root> [--json]');
    process.exit(2);
  }
  const results = scan(path.resolve(root));
  if (args.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
  } else if (!results.length) {
    console.log('No likely payment code found. Check the path, or search for the provider name directly.');
  } else {
    console.log(report(results));
  }
}

if (require.main === module) main();

module.exports = { scan, scanFile, CATEGORIES };
