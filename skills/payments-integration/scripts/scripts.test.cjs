// Run with: node --test skills/payments-integration/scripts/scripts.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validate } = require('./validate-findings.cjs');
const { PROVIDERS } = require('./sign-webhook.cjs');
const { scan } = require('./find-payment-code.cjs');

const finding = (over = {}) => ({
  id: 'F-1',
  severity: 'critical',
  title: 'Order marked paid from redirect query string',
  location: { file: 'src/pay.js', line: 3 },
  what: 'The callback trusts ?status=successful.',
  scenario: 'User visits /callback?status=successful&tx_ref=abc without paying; the order is fulfilled.',
  fix: 'Verify the transaction server-side before fulfilling.',
  ...over,
});
const report = (over = {}) => ({
  project: 'demo',
  summary: 'One critical issue.',
  money_paths: [{ name: 'Checkout', entry: 'src/pay.js' }],
  findings: [finding()],
  ...over,
});

test('valid report passes', () => {
  assert.deepStrictEqual(validate(report()), []);
});

test('empty findings list is valid', () => {
  assert.deepStrictEqual(validate(report({ findings: [] })), []);
});

test('rejects bad severity ordering and duplicate ids', () => {
  const errors = validate(report({
    findings: [finding({ severity: 'low' }), finding({ severity: 'critical' })],
  }));
  assert.ok(errors.some((e) => e.includes('most severe first')));
  assert.ok(errors.some((e) => e.includes('duplicate id')));
});

test('rejects missing scenario and unknown pattern', () => {
  const errors = validate(report({ findings: [finding({ scenario: 'bad', pattern: 'XYZ-1' })] }));
  assert.ok(errors.some((e) => e.includes('scenario')));
  assert.ok(errors.some((e) => e.includes('pattern')));
});

test('checks file and line against root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/pay.js'), 'a\nb\nc\n');
  assert.deepStrictEqual(validate(report(), { root: dir }), []);
  const errors = validate(report({ findings: [finding({ location: { file: 'src/pay.js', line: 99 } })] }), { root: dir });
  assert.ok(errors.some((e) => e.includes('past the end')));
});

test('stripe signature matches the documented scheme', () => {
  const secret = 'whsec_test';
  const body = '{"id":"evt_1"}';
  const header = PROVIDERS.stripe({ secret, body, timestamp: '1700000000' })['Stripe-Signature'];
  const expected = crypto.createHmac('sha256', secret).update(`1700000000.${body}`).digest('hex');
  assert.strictEqual(header, `t=1700000000,v1=${expected}`);
});

test('paystack signature is sha512 of raw body', () => {
  const sig = PROVIDERS.paystack({ secret: 'sk_test_x', body: '{"event":"charge.success"}' })['x-paystack-signature'];
  assert.strictEqual(sig.length, 128);
});

test('square requires the notification url', () => {
  assert.throws(() => PROVIDERS.square({ secret: 's', body: '{}' }));
});

test('scanner finds payment files and skips node_modules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  fs.mkdirSync(path.join(dir, 'node_modules/stripe'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules/stripe/index.js'), 'stripe webhook');
  fs.writeFileSync(path.join(dir, 'wallet.ts'), 'async function withdraw() {\n  user.balance -= amount;\n}\n');
  const results = scan(dir);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].file, 'wallet.ts');
  assert.ok(results[0].hits.payout && results[0].hits.balance);
});
