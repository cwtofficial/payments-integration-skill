#!/usr/bin/env node
// Produce correctly signed webhook headers for a payload, so a local handler's
// verification path can be tested without a tunnel or the provider dashboard.
//
// Usage:
//   node sign-webhook.cjs <provider> --secret <secret> --body <file|-> [--url <notification_url>]
//                         [--timestamp <unix>] [--target <handler_url>]
//
// Providers: stripe, paystack, razorpay, flutterwave, square, monnify, lemonsqueezy, paddle, checkout
//
// Prints the headers as JSON, and a curl command when --target is given.
// The body is signed byte-for-byte as read; do not reformat it afterwards.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const hmac = (algo, key, data, enc = 'hex') => crypto.createHmac(algo, key).update(data).digest(enc);

const PROVIDERS = {
  stripe: ({ secret, body, timestamp }) => ({
    'Stripe-Signature': `t=${timestamp},v1=${hmac('sha256', secret, `${timestamp}.${body}`)}`,
  }),
  paystack: ({ secret, body }) => ({
    'x-paystack-signature': hmac('sha512', secret, body),
  }),
  razorpay: ({ secret, body }) => ({
    'X-Razorpay-Signature': hmac('sha256', secret, body),
    'x-razorpay-event-id': `evt_test_${crypto.randomBytes(8).toString('hex')}`,
  }),
  // v3: the header is the shared secret hash itself, not a signature over the body.
  flutterwave: ({ secret }) => ({
    'verif-hash': secret,
  }),
  square: ({ secret, body, url }) => {
    if (!url) throw new Error('square signs notification_url + body: pass --url <registered notification url>');
    return { 'x-square-hmacsha256-signature': hmac('sha256', secret, url + body, 'base64') };
  },
  monnify: ({ secret, body }) => ({
    'monnify-signature': hmac('sha512', secret, body),
  }),
  lemonsqueezy: ({ secret, body }) => ({
    'X-Signature': hmac('sha256', secret, body),
  }),
  paddle: ({ secret, body, timestamp }) => ({
    'Paddle-Signature': `ts=${timestamp};h1=${hmac('sha256', secret, `${timestamp}:${body}`)}`,
  }),
  checkout: ({ secret, body }) => ({
    'Cko-Signature': hmac('sha256', secret, body),
  }),
};

function parseArgs(argv) {
  const [provider, ...rest] = argv;
  const opts = { provider };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!key.startsWith('--') || rest[i + 1] === undefined) throw new Error(`bad argument near "${key}"`);
    opts[key.slice(2)] = rest[i + 1];
  }
  return opts;
}

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error('usage: node sign-webhook.cjs <provider> --secret <secret> --body <file|-> [--url <url>] [--timestamp <unix>] [--target <handler_url>]');
  console.error(`providers: ${Object.keys(PROVIDERS).join(', ')}`);
  process.exit(2);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    usage(err.message);
  }
  const sign = PROVIDERS[opts.provider];
  if (!sign) usage(`unknown provider "${opts.provider}"`);
  if (!opts.secret) usage('--secret is required');
  if (!opts.body) usage('--body is required (a file path, or - for stdin)');

  const body = fs.readFileSync(opts.body === '-' ? 0 : opts.body, 'utf8');
  const timestamp = opts.timestamp || String(Math.floor(Date.now() / 1000));

  let headers;
  try {
    headers = { 'Content-Type': 'application/json', ...sign({ secret: opts.secret, body, timestamp, url: opts.url }) };
  } catch (err) {
    usage(err.message);
  }

  console.log(JSON.stringify(headers, null, 2));
  if (opts.target) {
    const h = Object.entries(headers).map(([k, v]) => `-H '${k}: ${v}'`).join(' ');
    const bodyArg = opts.body === '-' ? '--data-binary @-' : `--data-binary @${opts.body}`;
    console.log(`\ncurl -sS -X POST ${h} ${bodyArg} '${opts.target}'`);
  }
}

if (require.main === module) main();

module.exports = { PROVIDERS };
