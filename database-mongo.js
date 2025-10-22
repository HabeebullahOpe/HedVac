const { MongoClient, ObjectId } = require('mongodb');

class Database {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
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
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      throw error;
    }
  }

  async createIndexes() {
    await this.db.collection('users').createIndex({ discord_id: 1 }, { unique: true });
    await this.db.collection('transactions').createIndex({ discord_id: 1, timestamp: -1 });
    await this.db.collection('transactions').createIndex({ transaction_id: 1 }, { unique: true });
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
    
    // Update balance
    const updateField = `balances.${tokenId}`;
    const result = await this.db.collection('users').updateOne(
      { discord_id: discordId },
      { 
        $inc: { [updateField]: amount },
        $set: { updated_at: new Date() }
      }
    );

    // Log transaction
    await this.logTransaction(discordId, tokenId, amount, reason, metadata);

    return result;
  }

  // TRANSACTION LOGGING (CRITICAL FOR AUDIT)
  async logTransaction(discordId, tokenId, amount, reason, metadata = {}) {
    await this.connect();
    
    const transaction = {
      discord_id: discordId,
      token_id: tokenId,
      amount: amount,
      balance_after: await this.getBalance(discordId, tokenId),
      reason: reason, // 'deposit', 'withdraw', 'rain', 'loot', 'send', 'receive'
      metadata: metadata, // { from_user, to_user, loot_id, rain_id, tx_hash, etc }
      timestamp: new Date(),
      transaction_id: `${discordId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    await this.db.collection('transactions').insertOne(transaction);
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

  // LOOT SYSTEM
  async createLootEvent(lootData) {
    await this.connect();
    
    const lootEvent = {
      ...lootData,
      created_at: new Date(),
      status: 'active',
      claims: []
    };

    const result = await this.db.collection('loot_events').insertOne(lootEvent);
    return { id: result.insertedId };
  }

  async claimLoot(lootId, userId, amount) {
    await this.connect();
    
    // Update loot event
    await this.db.collection('loot_events').updateOne(
      { _id: new ObjectId(lootId) },
      { 
        $inc: { claimed_amount: amount, claim_count: 1 },
        $push: { 
          claims: {
            user_id: userId,
            amount: amount,
            claimed_at: new Date()
          }
        }
      }
    );

    // Update user balance with proper logging
    await this.updateBalance(
      userId, 
      lootData.token_id, 
      amount, 
      'loot_claim',
      { loot_id: lootId }
    );
  }

  // RAIN SYSTEM
  async createRainEvent(rainData) {
    await this.connect();
    
    const rainEvent = {
      ...rainData,
      created_at: new Date(),
      status: 'completed',
      distributions: []
    };

    const result = await this.db.collection('rain_events').insertOne(rainEvent);
    return { id: result.insertedId };
  }

  async distributeRain(rainId, recipients) {
    await this.connect();
    
    for (const recipient of recipients) {
      await this.updateBalance(
        recipient.user_id,
        rainData.token_id,
        recipient.amount,
        'rain',
        { rain_id: rainId, from_user: rainData.creator_id }
      );
    }

    // Update rain event with distribution records
    await this.db.collection('rain_events').updateOne(
      { _id: new ObjectId(rainId) },
      { $set: { distributions: recipients } }
    );
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