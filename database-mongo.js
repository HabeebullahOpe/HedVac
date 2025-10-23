const { MongoClient, ObjectId } = require('mongodb');

class Database {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
  }

  // Replace the connect() method in the Database class with this version

async connect() {
  if (this.isConnected) return;

  try {
    const uri = process.env.MONGODB_URI;
    if (!uri || typeof uri !== 'string' || uri.trim() === '') {
      const msg = 'MONGODB_URI is not set or is empty. Please set this env var in Railway (no surrounding quotes).';
      console.error('❌ MongoDB connection failed:', msg);
      throw new Error(msg);
    }

    // Mask credentials for logging: show user and host but hide password
    const maskedUri = uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:*****@');
    console.log('🔗 Connecting to MongoDB (masked):', maskedUri);

    this.client = new MongoClient(uri, {
      // useUnifiedTopology silences the legacy SDAM warning on older drivers
      useUnifiedTopology: true,
      // keep serverApi for strict deprecation behavior if you want it
      serverApi: {
        version: '1',
        strict: true,
        deprecationErrors: true,
      }
    });

    await this.client.connect();
    this.db = this.client.db('hedvac');
    this.isConnected = true;

    console.log('✅ Connected to MongoDB successfully!');
    await this.createIndexes();
    await this.testConnection();

  } catch (error) {
    console.error('❌ MongoDB connection failed:', error && error.message ? error.message : error);
    throw error;
  }
}

  async testConnection() {
    try {
      console.log('🔗 Testing MongoDB connection...');
      
      // Test the connection
      await this.db.command({ ping: 1 });
      console.log('✅ MongoDB ping successful!');
      
      // Test inserting a document
      const testResult = await this.db.collection('connection_test').insertOne({
        test: true,
        message: 'MongoDB connection test',
        timestamp: new Date()
      });
      
      console.log('✅ Test document inserted:', testResult.insertedId);
      
      // Clean up test document
      await this.db.collection('connection_test').deleteOne({ _id: testResult.insertedId });
      console.log('✅ Test document cleaned up');
      
    } catch (error) {
      console.error('❌ MongoDB connection test failed:', error);
      throw error;
    }
  }

  async createIndexes() {
    try {
      await this.db.collection('users').createIndex({ discord_id: 1 }, { unique: true });
      await this.db.collection('transactions').createIndex({ discord_id: 1, timestamp: -1 });
      await this.db.collection('transactions').createIndex({ transaction_id: 1 }, { unique: true });
      await this.db.collection('loot_events').createIndex({ status: 1, expires_at: 1 });
      console.log('✅ MongoDB indexes created');
    } catch (error) {
      console.error('❌ Error creating indexes:', error);
    }
  }

  // USER MANAGEMENT
  async getUser(discordId) {
    await this.connect();
    return await this.db.collection('users').findOne({ discord_id: discordId });
  }

  async createUser(discordId, hederaAccountId = null) {
    await this.connect();
    
    const user = {
      discord_id: discordId,
      hedera_account_id: hederaAccountId,
      balances: {
        HBAR: 0
      },
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await this.db.collection('users').updateOne(
      { discord_id: discordId },
      { $setOnInsert: user },
      { upsert: true }
    );

    console.log(`✅ User ${discordId} created/updated in MongoDB`);
    return result;
  }

  async setUser(discordId, hederaAccountId) {
    return await this.createUser(discordId, hederaAccountId);
  }

  // BALANCE MANAGEMENT
  async getHbarBalance(discordId) {
    return await this.getBalance(discordId, 'HBAR');
  }

  async getBalance(discordId, tokenId = 'HBAR') {
    await this.connect();
    const user = await this.getUser(discordId);
    return user ? (user.balances[tokenId] || 0) : 0;
  }

  async updateBalance(discordId, tokenId, amount, reason, metadata = {}) {
    await this.connect();
    
    // Create user if doesn't exist (for unregistered users receiving funds)
    await this.createUser(discordId);
    
    // Get current balance first
    const currentBalance = await this.getBalance(discordId, tokenId);
    const newBalance = currentBalance + amount;
    
    // Update balance
    const updateField = `balances.${tokenId}`;
    const result = await this.db.collection('users').updateOne(
      { discord_id: discordId },
      { 
        $set: { 
          [updateField]: newBalance,
          updated_at: new Date() 
        }
      }
    );

    // Log transaction
    await this.logTransaction(discordId, tokenId, amount, reason, metadata, newBalance);

    console.log(`💰 Balance update: ${discordId} | ${tokenId} | ${amount} | ${reason} | New balance: ${newBalance}`);
    return result;
  }

  async updateHbarBalance(discordId, amount) {
    return await this.updateBalance(discordId, 'HBAR', amount, 'deposit');
  }

  async deductHbarBalance(discordId, amount) {
    return await this.updateBalance(discordId, 'HBAR', -amount, 'withdraw');
  }

  async getTokenBalance(discordId, tokenId) {
    return await this.getBalance(discordId, tokenId);
  }

  async updateTokenBalance(discordId, tokenId, amount) {
    const reason = amount > 0 ? 'token_deposit' : 'token_withdraw';
    return await this.updateBalance(discordId, tokenId, amount, reason);
  }

  async deductTokenBalance(discordId, tokenId, amount) {
    return await this.updateBalance(discordId, tokenId, -amount, 'token_send');
  }

  // TOKEN BALANCES
  async getUserTokenBalances(discordId) {
    await this.connect();
    const user = await this.getUser(discordId);
    if (!user || !user.balances) return [];
    
    return Object.entries(user.balances)
      .filter(([tokenId, balance]) => balance > 0 && tokenId !== 'HBAR')
      .map(([tokenId, balance]) => ({ token_id: tokenId, balance }));
  }

  // TRANSACTION LOGGING
  async logTransaction(discordId, tokenId, amount, reason, metadata = {}, balanceAfter) {
    await this.connect();
    
    const transaction = {
      discord_id: discordId,
      token_id: tokenId,
      amount: amount,
      balance_after: balanceAfter,
      reason: reason,
      metadata: metadata,
      timestamp: new Date(),
      transaction_id: `${discordId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    await this.db.collection('transactions').insertOne(transaction);
    console.log(`📝 Transaction logged: ${discordId} | ${reason} | ${amount} ${tokenId}`);
    return transaction;
  }

  // GET TRANSACTION HISTORY
  async getTransactionHistory(discordId, limit = 50) {
    await this.connect();
    return await this.db.collection('transactions')
      .find({ discord_id: discordId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  // RAIN FUNCTIONS
  async createRainEvent(rainData) {
    await this.connect();
    
    const rainEvent = {
      ...rainData,
      created_at: new Date(),
      status: 'completed'
    };

    const result = await this.db.collection('rain_events').insertOne(rainEvent);
    console.log(`🌧️ Rain event created: ${result.insertedId}`);
    return { id: result.insertedId };
  }

  async getRainHistory(limit = 10) {
    await this.connect();
    return await this.db.collection('rain_events')
      .find()
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
  }

  // LOOT FUNCTIONS
  async createLootEvent(lootData) {
    await this.connect();
    
    const lootEvent = {
      ...lootData,
      created_at: new Date(),
      status: 'active',
      claims: []
    };

    const result = await this.db.collection('loot_events').insertOne(lootEvent);
    console.log(`🎁 Loot event created: ${result.insertedId}`);
    return { id: result.insertedId };
  }

  async getLootEvent(lootId) {
    await this.connect();
    return await this.db.collection('loot_events').findOne({ _id: new ObjectId(lootId) });
  }

  async getActiveLootEvents() {
    await this.connect();
    return await this.db.collection('loot_events')
      .find({ 
        status: 'active',
        expires_at: { $gt: new Date() }
      })
      .toArray();
  }

  async createLootClaim(claimData) {
    await this.connect();
    
    const result = await this.db.collection('loot_claims').insertOne({
      ...claimData,
      claimed_at: new Date()
    });
    
    console.log(`🎯 Loot claim created: ${result.insertedId}`);
    return { id: result.insertedId };
  }

  async updateLootEvent(lootId, amount) {
    await this.connect();
    
    const result = await this.db.collection('loot_events').updateOne(
      { _id: new ObjectId(lootId) },
      { 
        $inc: { 
          claimed_amount: amount,
          claim_count: 1 
        }
      }
    );
    
    return { changes: result.modifiedCount };
  }

  async getUserLootClaims(userId, lootId) {
    await this.connect();
    return await this.db.collection('loot_claims').findOne({ 
      user_id: userId, 
      loot_id: lootId 
    });
  }

  async getLootClaims(lootId) {
    await this.connect();
    return await this.db.collection('loot_claims')
      .find({ loot_id: lootId })
      .sort({ claimed_at: -1 })
      .toArray();
  }

    // returns active loot events where expires_at < now (for compatibility with sqlite helper)
  async getExpiredLootEvents() {
    await this.connect();
    return await this.db.collection('loot_events').find({
      status: 'active',
      expires_at: { $lt: new Date() }
    }).toArray();
  }

  // update the status of a loot event (compat parity with sqlite)
  async updateLootStatus(lootId, status) {
    await this.connect();
    try {
      const result = await this.db.collection('loot_events').updateOne(
        { _id: new ObjectId(lootId) },
        { $set: { status } }
      );
      return { modifiedCount: result.modifiedCount };
    } catch (err) {
      console.error("Error updating loot status:", err);
      throw err;
    }
  }

  // ACTIVE USERS (for rain)
  async getActiveUsers(guildId, durationMinutes = 60) {
    // For now, return empty array - you can implement this later
    return [];
  }

  // PROCESSED TRANSACTIONS (for deposit tracking)
  async addProcessedTransaction(transactionId) {
    await this.connect();
    
    const result = await this.db.collection('processed_transactions').updateOne(
      { transaction_id: transactionId },
      { $setOnInsert: { transaction_id: transactionId, processed_at: new Date() } },
      { upsert: true }
    );
    
    return { changes: result.upsertedCount || result.modifiedCount };
  }

  async isTransactionProcessed(transactionId) {
    await this.connect();
    const result = await this.db.collection('processed_transactions').findOne({ 
      transaction_id: transactionId 
    });
    return !!result;
  }

  // BOT SETTINGS
  async getLastProcessedTimestamp() {
    await this.connect();
    const setting = await this.db.collection('bot_settings').findOne({ key: 'last_processed_timestamp' });
    
    if (setting && setting.value) {
      return new Date(parseInt(setting.value));
    } else {
      // Return 1 hour ago if not set
      return new Date(Date.now() - 60 * 60 * 1000);
    }
  }

  async setLastProcessedTimestamp(timestamp) {
    await this.connect();
    
    const result = await this.db.collection('bot_settings').updateOne(
      { key: 'last_processed_timestamp' },
      { $set: { value: timestamp.getTime().toString() } },
      { upsert: true }
    );
    
    return { changes: result.modifiedCount };
  }

  // TOKEN INFO (from your original database.js)
  async getTokenDisplayInfo(tokenId) {
    // You can keep this as is or implement MongoDB version
    const axios = require('axios');
    
    try {
      const MIRROR_NODE_URL = "https://mainnet-public.mirrornode.hedera.com";
      const url = `${MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`;
      const response = await axios.get(url, { timeout: 10000 });
      const tokenInfo = response.data;

      let displayName = tokenInfo.name;
      let symbol = tokenInfo.symbol || "";

      if (displayName && displayName.length <= 10 && !displayName.includes(" ") && symbol) {
        [displayName, symbol] = [symbol, displayName];
      }

      if (!displayName || displayName === tokenId) {
        displayName = symbol || tokenId;
      }

      return {
        name: tokenInfo.symbol || tokenInfo.name || tokenId,
        symbol: tokenInfo.symbol || "",
        decimals: tokenInfo.decimals || 0,
      };
    } catch (error) {
      console.error(`❌ Error fetching token info for ${tokenId}:`, error.message);
      return { name: tokenId, symbol: "", decimals: 0 };
    }
  }

  // ADMIN QUERIES
  async getAllUsers() {
    await this.connect();
    return await this.db.collection('users').find().toArray();
  }

  async getSystemStats() {
    await this.connect();
    
    const totalUsers = await this.db.collection('users').countDocuments();
    const totalTransactions = await this.db.collection('transactions').countDocuments();
    const totalLootEvents = await this.db.collection('loot_events').countDocuments();
    const totalRainEvents = await this.db.collection('rain_events').countDocuments();

    return { totalUsers, totalTransactions, totalLootEvents, totalRainEvents };
  }
}

module.exports = new Database();
