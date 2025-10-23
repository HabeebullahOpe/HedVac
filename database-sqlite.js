// database-sqlite.js
// SQLite implementation. Export same API as original database.js and include connect() for parity.

const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const activityTracker = require("./activity-tracker.js");

const dbPath = path.resolve(__dirname, "database.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
  } else {
    console.log("✅ Connected to SQLite database.");
    initializeDatabase();
  }
});

function initializeDatabase() {
  // Create users table if it doesn't exist
  const createUsersTable = `
        CREATE TABLE IF NOT EXISTS users (
            discord_id TEXT PRIMARY KEY NOT NULL,
            hedera_account_id TEXT,
            hbar_balance INTEGER DEFAULT 0
        )
    `;

  // Create token_balances table
  const createTokenBalancesTable = `
        CREATE TABLE IF NOT EXISTS token_balances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT NOT NULL,
            token_id TEXT NOT NULL,
            balance INTEGER DEFAULT 0,
            FOREIGN KEY (discord_id) REFERENCES users (discord_id)
        )
    `;

  // Create rain_events table (simplified - no claims)
  const createRainEventsTable = `
        CREATE TABLE IF NOT EXISTS rain_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            creator_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            token_id TEXT DEFAULT 'HBAR',
            distributed_amount INTEGER DEFAULT 0,
            recipient_count INTEGER DEFAULT 0,
            duration_minutes INTEGER DEFAULT 720,
            min_role TEXT,
            message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'completed'
        )
    `;

  // Create user_tokens table for enhanced token support
  const createUserTokensTable = `
        CREATE TABLE IF NOT EXISTS user_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT NOT NULL,
            token_id TEXT NOT NULL,
            balance INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(discord_id, token_id)
        )
    `;

  const createBotSettingsTable = `
    CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT
    )
`;

  const createProcessedTransactionsTable = `
    CREATE TABLE IF NOT EXISTS processed_transactions (
        transaction_id TEXT PRIMARY KEY NOT NULL,
        processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`;

  const createLootEventsTable = `
CREATE TABLE IF NOT EXISTS loot_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id TEXT NOT NULL,
    token_id TEXT NOT NULL,
    total_amount INTEGER NOT NULL,
    claimed_amount INTEGER DEFAULT 0,
    claim_count INTEGER DEFAULT 0,
    max_claims INTEGER NOT NULL,
    loot_type TEXT DEFAULT 'normal',
    message TEXT,
    min_role TEXT,
    channel_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    status TEXT DEFAULT 'active'
)
`;

  // Create loot_claims table
  const createLootClaimsTable = `
CREATE TABLE IF NOT EXISTS loot_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loot_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (loot_id) REFERENCES loot_events (id)
)
`;

  db.run(createUsersTable, (err) => {
    if (err) {
      console.error("❌ Error creating users table:", err.message);
    } else {
      console.log("✅ Users table ready.");
    }
  });

  db.run(createTokenBalancesTable, (err) => {
    if (err) {
      console.error("❌ Error creating token_balances table:", err.message);
    } else {
      console.log("✅ Token balances table ready.");
    }
  });

  db.run(createRainEventsTable, (err) => {
    if (err) {
      console.error("❌ Error creating rain_events table:", err.message);
    } else {
      console.log("✅ Rain events table ready.");
    }
  });

  db.run(createUserTokensTable, (err) => {
    if (err) {
      console.error("❌ Error creating user_tokens table:", err.message);
    } else {
      console.log("✅ User tokens table ready.");
    }
  });
  db.run(createBotSettingsTable, (err) => {
    if (err) {
      console.error("❌ Error creating bot_settings table:", err.message);
    } else {
      console.log("✅ Bot settings table ready.");
    }
  });
  db.run(createProcessedTransactionsTable, (err) => {
    if (err) {
      console.error(
        "❌ Error creating processed_transactions table:",
        err.message
      );
    } else {
      console.log("✅ Processed transactions table ready.");
    }
  });
  db.run(createLootEventsTable, (err) => {
    if (err) console.error("❌ Error creating loot_events table:", err.message);
    else console.log("✅ Loot events table ready.");
  });

  db.run(createLootClaimsTable, (err) => {
    if (err) console.error("❌ Error creating loot_claims table:", err.message);
    else console.log("✅ Loot claims table ready.");
  });
}

// USER FUNCTIONS
function setUser(discordId, hederaAccountId) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT OR REPLACE INTO users (discord_id, hedera_account_id) VALUES (?, ?)`;
    db.run(sql, [discordId, hederaAccountId], function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function getUser(discordId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM users WHERE discord_id = ?`;
    db.get(sql, [discordId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// HBAR BALANCE FUNCTIONS
function getHbarBalance(discordId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT hbar_balance FROM users WHERE discord_id = ?`;
    db.get(sql, [discordId], (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.hbar_balance : 0);
    });
  });
}

function updateHbarBalance(discordId, amount) {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE users SET hbar_balance = hbar_balance + ? WHERE discord_id = ?`;
    db.run(sql, [amount, discordId], function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

// TOKEN BALANCE FUNCTIONS (NEW)
function getTokenBalance(discordId, tokenId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT balance FROM user_tokens WHERE discord_id = ? AND token_id = ?`;
    db.get(sql, [discordId, tokenId], (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.balance : 0);
    });
  });
}

function updateTokenBalance(discordId, tokenId, amount) {
  return new Promise((resolve, reject) => {
    const sql = `
            INSERT INTO user_tokens (discord_id, token_id, balance, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(discord_id, token_id) 
            DO UPDATE SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP
        `;
    db.run(sql, [discordId, tokenId, amount, amount], function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function getUserTokenBalances(discordId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT token_id, balance FROM user_tokens WHERE discord_id = ? AND balance > 0`;
    db.all(sql, [discordId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// LEGACY TOKEN FUNCTIONS (keep for compatibility)
function getTokenBalances(discordId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT token_id, balance FROM token_balances WHERE discord_id = ?`;
    db.all(sql, [discordId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// RAIN FUNCTIONS
function createRainEvent(rainData) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO rain_events 
            (creator_id, amount, token_id, distributed_amount, recipient_count, duration_minutes, min_role, message, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(
      sql,
      [
        rainData.creator_id,
        rainData.amount,
        rainData.token_id || "HBAR",
        rainData.distributed_amount,
        rainData.recipient_count,
        rainData.duration_minutes,
        rainData.min_role,
        rainData.message,
        rainData.status || "completed",
      ],
      function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      }
    );
  });
}

function getRainHistory(limit = 10) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM rain_events ORDER BY created_at DESC LIMIT ?`;
    db.all(sql, [limit], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// TOKEN INFO HELPER FUNCTION
async function getTokenDisplayInfo(tokenId) {
  try {
    const MIRROR_NODE_URL = "https://mainnet-public.mirrornode.hedera.com";
    const url = `${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`;
    const response = await axios.get(url, { timeout: 10000 });
    const tokenInfo = response.data;

    // FIXED: Properly handle name vs symbol
    let displayName = tokenInfo.name;
    let symbol = tokenInfo.symbol || "";

    // If name looks like a symbol (short, no spaces) and symbol exists, use symbol as name
    if (
      displayName &&
      displayName.length <= 10 &&
      !displayName.includes(" ") &&
      symbol
    ) {
      // Swap them - use symbol as name, and name as symbol
      [displayName, symbol] = [symbol, displayName];
    }

    // If no proper name, use token ID
    if (!displayName || displayName === tokenId) {
      displayName = symbol || tokenId;
    }

    return {
      name: tokenInfo.symbol || tokenInfo.name || tokenId, // Use symbol first
      symbol: tokenInfo.symbol || "",
      decimals: tokenInfo.decimals || 0,
    };
  } catch (error) {
    console.error(
      `❌ Error fetching token info for ${tokenId}:`,
      error.message
    );
    return { name: tokenId, symbol: "", decimals: 0 };
  }
}

function getLastProcessedTimestamp() {
  return new Promise((resolve, reject) => {
    const sql = `SELECT value FROM bot_settings WHERE key = 'last_processed_timestamp'`;
    db.get(sql, (err, row) => {
      if (err) {
        console.error("Database error getting timestamp:", err);
        // Return a recent timestamp if there's an error
        resolve(new Date(Date.now() - 60 * 60 * 1000)); // 1 hour ago
      } else {
        const timestamp = row
          ? new Date(parseInt(row.value))
          : new Date(Date.now() - 60 * 60 * 1000);
        console.log("📅 Loaded timestamp from DB:", timestamp.toISOString());
        resolve(timestamp);
      }
    });
  });
}

function setLastProcessedTimestamp(timestamp) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('last_processed_timestamp', ?)`;
    db.run(sql, [timestamp.getTime().toString()], function (err) {
      if (err) {
        console.error("Database error saving timestamp:", err);
        reject(err);
      } else {
        console.log("💾 Saved timestamp to DB:", timestamp.toISOString());
        resolve({ changes: this.changes });
      }
    });
  });
}

// Add these functions to database.js
function addProcessedTransaction(transactionId) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT OR IGNORE INTO processed_transactions (transaction_id) VALUES (?)`;
    db.run(sql, [transactionId], function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function isTransactionProcessed(transactionId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT 1 FROM processed_transactions WHERE transaction_id = ?`;
    db.get(sql, [transactionId], (err, row) => {
      if (err) reject(err);
      else resolve(!!row);
    });
  });
}

// Add to existing database functions
function deductHbarBalance(discordId, amount) {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE users SET hbar_balance = hbar_balance - ? WHERE discord_id = ? AND hbar_balance >= ?`;
    db.run(sql, [amount, discordId, amount], function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function deductTokenBalance(discordId, tokenId, amount) {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE user_tokens 
      SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP 
      WHERE discord_id = ? AND token_id = ? AND balance >= ?
    `;
    db.run(sql, [amount, discordId, tokenId, amount], function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function getActiveUsers(guildId, durationMinutes = 60) {
  return new Promise((resolve, reject) => {
    try {
      const guild = global.discordClient.guilds.cache.get(guildId);
      if (!guild) {
        resolve([]);
        return;
      }

      // Get current time and calculate cutoff
      const cutoffTime = Date.now() - durationMinutes * 60 * 1000;

      // Get all text channels in the guild
      const textChannels = guild.channels.cache.filter(
        (channel) => channel.type === 0 && channel.viewable // GUILD_TEXT and viewable
      );

      const activeUsers = new Set();

      // Check each channel for recent messages
      const channelChecks = Array.from(textChannels.values()).map(
        async (channel) => {
          try {
            // Fetch recent messages (last 100 messages in the channel)
            const messages = await channel.messages.fetch({ limit: 100 });

            messages.forEach((message) => {
              // Skip bot messages and check if message is within time frame
              if (
                !message.author.bot &&
                message.createdTimestamp >= cutoffTime
              ) {
                activeUsers.add(message.author.id);
              }
            });
          } catch (error) {
            console.error(
              `Error fetching messages from channel ${channel.name}:`,
              error.message
            );
          }
        }
      );

      // Wait for all channel checks to complete
      Promise.all(channelChecks).then(() => {
        // Also include currently online users as a fallback
        guild.members
          .fetch()
          .then((members) => {
            const onlineUsers = members
              .filter(
                (member) =>
                  !member.user.bot &&
                  member.presence &&
                  member.presence.status !== "offline"
              )
              .map((member) => member.id);

            // Combine message-active users and online users
            const allActiveUsers = Array.from(activeUsers);
            onlineUsers.forEach((userId) => activeUsers.add(userId));

            console.log(
              `🌧️ Found ${activeUsers.size} active users for rain (${allActiveUsers.length} from messages, ${onlineUsers.length} online)`
            );
            resolve(Array.from(activeUsers));
          })
          .catch((err) => {
            console.error("Error fetching online users:", err);
            resolve(Array.from(activeUsers));
          });
      });
    } catch (error) {
      console.error("Error in getActiveUsers:", error);
      // Fallback to online users only
      const guild = global.discordClient.guilds.cache.get(guildId);
      if (!guild) {
        resolve([]);
        return;
      }

      guild.members
        .fetch()
        .then((members) => {
          const fallbackActiveUsers = members
            .filter(
              (member) =>
                !member.user.bot &&
                member.presence &&
                member.presence.status !== "offline"
            )
            .map((member) => member.id);

          console.log(
            `🌧️ Fallback: Found ${fallbackActiveUsers.length} online users`
          );
          resolve(fallbackActiveUsers);
        })
        .catch((err) => {
          console.error("Error fetching guild members:", err);
          resolve([]);
        });
    }
  });
}

// LOOT FUNCTIONS
function createLootEvent(lootData) {
  return new Promise((resolve, reject) => {
    // UPDATE THIS SQL TO INCLUDE channel_id
    const sql = `INSERT INTO loot_events 
        (creator_id, token_id, total_amount, max_claims, loot_type, message, min_role, channel_id, expires_at, status) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(
      sql,
      [
        lootData.creator_id,
        lootData.token_id,
        lootData.total_amount,
        lootData.max_claims,
        lootData.loot_type,
        lootData.message,
        lootData.min_role,
        lootData.channel_id, // ADD THIS
        lootData.expires_at,
        lootData.status || "active",
      ],
      function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      }
    );
  });
}

function getLootEvent(lootId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM loot_events WHERE id = ?`;
    db.get(sql, [lootId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function getActiveLootEvents(guildId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM loot_events WHERE status = 'active' AND expires_at > datetime('now')`;
    db.all(sql, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function createLootClaim(claimData) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO loot_claims (loot_id, user_id, amount) VALUES (?, ?, ?)`;
    db.run(
      sql,
      [claimData.loot_id, claimData.user_id, claimData.amount],
      function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      }
    );
  });
}

function updateLootEvent(lootId, updates) {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE loot_events SET claimed_amount = claimed_amount + ?, claim_count = claim_count + 1 WHERE id = ?`;
    db.run(sql, [updates.amount, lootId], function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function getUserLootClaims(userId, lootId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM loot_claims WHERE user_id = ? AND loot_id = ?`;
    db.get(sql, [userId, lootId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function getLootClaims(lootId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT lc.*, u.discord_id, u.hedera_account_id 
                    FROM loot_claims lc 
                    LEFT JOIN users u ON lc.user_id = u.discord_id 
                    WHERE lc.loot_id = ? 
                    ORDER BY lc.claimed_at DESC`;
    db.all(sql, [lootId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// ADMIN QUERIES
function getAllUsers() {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM users`;
    db.all(sql, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function getSystemStats() {
  return new Promise(async (resolve, reject) => {
    try {
      const totalUsersP = new Promise((res, rej) => {
        db.get("SELECT COUNT(*) as c FROM users", (err, row) => {
          if (err) rej(err);
          else res(row ? row.c : 0);
        });
      });
      const totalTransactionsP = new Promise((res, rej) => {
        db.get("SELECT COUNT(*) as c FROM transactions", (err, row) => {
          if (err) res(0); // table may not exist
          else res(row ? row.c : 0);
        });
      });
      const totalLootEventsP = new Promise((res, rej) => {
        db.get("SELECT COUNT(*) as c FROM loot_events", (err, row) => {
          if (err) res(0);
          else res(row ? row.c : 0);
        });
      });
      const totalRainEventsP = new Promise((res, rej) => {
        db.get("SELECT COUNT(*) as c FROM rain_events", (err, row) => {
          if (err) res(0);
          else res(row ? row.c : 0);
        });
      });

      const [totalUsers, totalTransactions, totalLootEvents, totalRainEvents] = await Promise.all([
        totalUsersP,
        totalTransactionsP,
        totalLootEventsP,
        totalRainEventsP,
      ]);

      resolve({ totalUsers, totalTransactions, totalLootEvents, totalRainEvents });
    } catch (err) {
      reject(err);
    }
  });
}

// Provide a connect() function so callers can await database.connect() for API parity with Mongo implementation
async function connect() {
  // SQLite DB is opened on require. This function exists so index.js can call database.connect() regardless of backend.
  return Promise.resolve();
}

function getExpiredLootEvents() {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM loot_events WHERE status = 'active' AND expires_at < datetime('now')`;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function updateLootStatus(lootId, status) {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE loot_events SET status = ? WHERE id = ?`;
    db.run(sql, [status, lootId], function (err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  });
}

// Export the same API as old database.js so other modules work unchanged.
module.exports = {
  db,
  connect,

  // User management
  setUser,
  getUser,

  // HBAR
  getHbarBalance,
  updateHbarBalance,
  deductHbarBalance,

  // Token balances
  getTokenBalance,
  updateTokenBalance,
  deductTokenBalance,
  getUserTokenBalances,
  getTokenBalances,

  // Transactions / processed list
  addProcessedTransaction,
  isTransactionProcessed,

  // Rain
  createRainEvent,
  getRainHistory,

  // Loot
  createLootEvent,
  getLootEvent,
  getActiveLootEvents,
  createLootClaim,
  updateLootEvent,
  getUserLootClaims,
  getLootClaims,

  // Token info helper
  getTokenDisplayInfo,

  // Bot settings
  getLastProcessedTimestamp,
  setLastProcessedTimestamp,

  // Active users helper
  getActiveUsers,

  // Admin
  getAllUsers,
  getSystemStats,

  // New helpers
  getExpiredLootEvents,
  updateLootStatus,
};
