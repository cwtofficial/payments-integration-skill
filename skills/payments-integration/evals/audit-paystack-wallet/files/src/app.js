const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const db = require('./db');
const wallet = require('./wallet');
const { requireAuth } = require('./auth');

const app = express();
app.use(express.json());

const paystack = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
});

// Fund wallet
app.post('/wallet/fund', requireAuth, async (req, res) => {
  const { amount } = req.body; // naira
  const reference = `fund_${req.user.id}_${Date.now()}`;
  await db.query('INSERT INTO payments (user_id, reference, amount, status) VALUES ($1, $2, $3, $4)',
    [req.user.id, reference, amount, 'pending']);
  const { data } = await paystack.post('/transaction/initialize', {
    email: req.user.email,
    amount: amount * 100,
    reference,
    callback_url: `${process.env.APP_URL}/wallet/callback`,
  });
  res.json({ url: data.data.authorization_url });
});

// Paystack redirects here after payment
app.get('/wallet/callback', async (req, res) => {
  const { reference } = req.query;
  const { data } = await paystack.get(`/transaction/verify/${reference}`);
  if (data.data.status === 'success') {
    const { rows } = await db.query('SELECT * FROM payments WHERE reference = $1', [reference]);
    await wallet.credit(rows[0].user_id, data.data.amount / 100);
    await db.query("UPDATE payments SET status = 'success' WHERE reference = $1", [reference]);
  }
  res.redirect('/wallet');
});

// Paystack webhook
app.post('/webhooks/paystack', async (req, res) => {
  const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body)).digest('hex');
  if (hash !== req.headers['x-paystack-signature']) {
    console.log('invalid signature');
  }
  const event = req.body;
  if (event.event === 'charge.success') {
    const { rows } = await db.query('SELECT * FROM payments WHERE reference = $1', [event.data.reference]);
    await wallet.credit(rows[0].user_id, event.data.amount / 100);
    await db.query("UPDATE payments SET status = 'success' WHERE reference = $1", [event.data.reference]);
  }
  if (event.event === 'transfer.success') {
    await db.query("UPDATE withdrawals SET status = 'paid' WHERE transfer_code = $1", [event.data.transfer_code]);
  }
  res.sendStatus(200);
});

// Withdraw to bank
app.post('/wallet/withdraw', requireAuth, async (req, res) => {
  const { amount, account_number, bank_code } = req.body;
  const w = await wallet.getWallet(req.user.id);
  if (parseFloat(w.balance) < parseFloat(amount)) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }
  const recipient = await paystack.post('/transferrecipient', {
    type: 'nuban', name: req.user.name, account_number, bank_code, currency: 'NGN',
  });
  const transfer = await paystack.post('/transfer', {
    source: 'balance',
    amount: amount * 100,
    recipient: recipient.data.data.recipient_code,
    reason: 'Wallet withdrawal',
  });
  await wallet.debit(req.user.id, amount);
  await db.query('INSERT INTO withdrawals (user_id, amount, status, transfer_code) VALUES ($1, $2, $3, $4)',
    [req.user.id, amount, 'pending', transfer.data.data.transfer_code]);
  res.json({ ok: true });
});

app.listen(process.env.PORT || 3000);
