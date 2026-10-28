const db = require('./db');

async function getWallet(userId) {
  const { rows } = await db.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
  return rows[0];
}

async function credit(userId, amount) {
  const wallet = await getWallet(userId);
  const newBalance = parseFloat(wallet.balance) + parseFloat(amount);
  await db.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [newBalance, userId]);
  return newBalance;
}

async function debit(userId, amount) {
  const wallet = await getWallet(userId);
  const newBalance = parseFloat(wallet.balance) - parseFloat(amount);
  await db.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [newBalance, userId]);
  return newBalance;
}

module.exports = { getWallet, credit, debit };
