const { MongoClient, ObjectId } = require('mongodb');

class Database {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
    this.connect(); // Auto-connect on initialization
  }

  async connect() {
    if (this.isConnected) return;
    
    try {
      this.client = new MongoClient(process.env.MONGODB_URI);
      await this.client.connect();
      this.db = this.client.db('hedvac');
      this.isConnected = true;
      console.log('✅ Connected to MongoDB');
      
      await this.createIndexes();
      await this.testConnection(); // Test after connection
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      throw error;
    }
  }

  async testConnection() {
    try {
      console.log('🔗 Testing MongoDB connection...');
      
      // Test by inserting a simple document
      const testResult = await this.db.collection('connection_test').insertOne({
        test: true,
        message: 'MongoDB connection test',
        timestamp: new Date()
      });
      
      console.log('✅ MongoDB connection test passed. Document ID:', testResult.insertedId);
      
      // Clean up test document
      await this.db.collection('connection_test').deleteOne({ _id: testResult.insertedId });
      
    } catch (error) {
      console.error('❌ MongoDB connection test failed:', error);
    }
  }

  async createIndexes() {
    try {
      await this.db.collection('users').createIndex({ discord_id: 1 }, { unique: true });
      await this.db.collection('transactions').createIndex({ discord_id: 1, timestamp: -1 });
      await this.db.collection('transactions').createIndex({ transaction_id: 1 }, { unique: true });
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

  // BALANCE MANAGEMENT
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

    console.log(`💰 Balance update: ${discordId} | ${tokenId} | ${amount} | New balance: ${newBalance}`);
    return result;
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

  // GET ALL BALANCES FOR USER
  async getUserTokenBalances(discordId) {
    await this.connect();
    const user = await this.getUser(discordId);
    if (!user || !user.balances) return [];
    
    return Object.entries(user.balances)
      .filter(([tokenId, balance]) => balance > 0)
      .map(([tokenId, balance]) => ({ token_id: tokenId, balance }));
  }

  // Add other functions as needed (deductHbarBalance, updateTokenBalance, etc.)
  // For now, let's use updateBalance for everything

  async deductHbarBalance(discordId, amount) {
    return await this.updateBalance(discordId, 'HBAR', -amount, 'withdraw');
  }

  async updateHbarBalance(discordId, amount) {
    return await this.updateBalance(discordId, 'HBAR', amount, 'deposit');
  }

  async updateTokenBalance(discordId, tokenId, amount) {
    const reason = amount > 0 ? 'token_deposit' : 'token_withdraw';
    return await this.updateBalance(discordId, tokenId, amount, reason);
  }

  async deductTokenBalance(discordId, tokenId, amount) {
    return await this.updateBalance(discordId, tokenId, -amount, 'token_send');
  }
}

module.exports = new Database();
