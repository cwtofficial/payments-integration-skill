const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// wallets(id, user_id, balance NUMERIC(12,2))
// payments(id, user_id, reference, amount, status)
// withdrawals(id, user_id, amount, status, transfer_code)

module.exports = { query: (text, params) => pool.query(text, params) };
