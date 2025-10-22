// database-pg.js
const { Pool } = require('pg');
const axios = require("axios");

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize database tables
async function initializeDatabase() {
  try {
    console.log('🔄 Initializing PostgreSQL database...');
    
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        discord_id TEXT PRIMARY KEY NOT NULL,
        hedera_account_id TEXT,
        hbar_balance BIGINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_tokens (
        id SERIAL PRIMARY KEY,
        discord_id TEXT NOT NULL,
        token_id TEXT NOT NULL,
        balance BIGINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(discord_id, token_id)
      )
    `);

    // Rain events table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rain_events (
        id SERIAL PRIMARY KEY,
        creator_id TEXT NOT NULL,
        amount BIGINT NOT NULL,
        token_id TEXT DEFAULT 'HBAR',
        distributed_amount BIGINT DEFAULT 0,
        recipient_count INTEGER DEFAULT 0,
        duration_minutes INTEGER DEFAULT 720,
        min_role TEXT,
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'completed'
      )
    `);

    // Loot events table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS loot_events (
        id SERIAL PRIMARY KEY,
        creator_id TEXT NOT NULL,
        token_id TEXT NOT NULL,
        total_amount BIGINT NOT NULL,
        claimed_amount BIGINT DEFAULT 0,
        claim_count INTEGER DEFAULT 0,
        max_claims INTEGER NOT NULL,
        loot_type TEXT DEFAULT 'normal',
        message TEXT,
        min_role TEXT,
        channel_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        status TEXT DEFAULT 'active'
      )
    `);

    // Loot claims table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS loot_claims (
        id SERIAL PRIMARY KEY,
        loot_id INTEGER NOT NULL REFERENCES loot_events(id),
        user_id TEXT NOT NULL,
        amount BIGINT NOT NULL,
        claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Processed transactions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS processed_transactions (
        transaction_id TEXT PRIMARY KEY NOT NULL,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Bot settings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT
      )
    `);

    console.log('✅ PostgreSQL database initialized successfully!');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// USER FUNCTIONS
async function setUser(discordId, hederaAccountId) {
  const result = await pool.query(
    `INSERT INTO users (discord_id, hedera_account_id) 
     VALUES ($1, $2) 
     ON CONFLICT (discord_id) 
     DO UPDATE SET hedera_account_id = $2`,
    [discordId, hederaAccountId]
  );
  return { changes: result.rowCount };
}

async function getUser(discordId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE discord_id = $1',
    [discordId]
  );
  return result.rows[0] || null;
}

// HBAR BALANCE FUNCTIONS
async function getHbarBalance(discordId) {
  const result = await pool.query(
    'SELECT hbar_balance FROM users WHERE discord_id = $1',
    [discordId]
  );
  return result.rows[0] ? parseInt(result.rows[0].hbar_balance) : 0;
}

async function updateHbarBalance(discordId, amount) {
  const result = await pool.query(
    'UPDATE users SET hbar_balance = hbar_balance + $1 WHERE discord_id = $2',
    [amount, discordId]
  );
  return { changes: result.rowCount };
}

// TOKEN BALANCE FUNCTIONS
async function getTokenBalance(discordId, tokenId) {
  const result = await pool.query(
    'SELECT balance FROM user_tokens WHERE discord_id = $1 AND token_id = $2',
    [discordId, tokenId]
  );
  return result.rows[0] ? parseInt(result.rows[0].balance) : 0;
}

async function updateTokenBalance(discordId, tokenId, amount) {
  const result = await pool.query(
    `INSERT INTO user_tokens (discord_id, token_id, balance, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (discord_id, token_id) 
     DO UPDATE SET balance = user_tokens.balance + $3, updated_at = CURRENT_TIMESTAMP`,
    [discordId, tokenId, amount]
  );
  return { changes: result.rowCount };
}

async function getUserTokenBalances(discordId) {
  const result = await pool.query(
    'SELECT token_id, balance FROM user_tokens WHERE discord_id = $1 AND balance > 0',
    [discordId]
  );
  return result.rows;
}

// Add all your other database functions here following the same pattern...
// (deductHbarBalance, createLootEvent, getLootEvent, etc.)

// Initialize when module loads
initializeDatabase();

module.exports = {
  pool,
  setUser,
  getUser,
  getHbarBalance,
  updateHbarBalance,
  getTokenBalance,
  updateTokenBalance,
  getUserTokenBalances,
  getTokenDisplayInfo: require('./database.js').getTokenDisplayInfo,
  // Add all other functions you need...
};