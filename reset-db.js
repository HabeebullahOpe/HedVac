// reset-db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, 'database.db');

// Delete the database file if it exists
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('🗑️  Deleted old database file');
}

// Create a new database
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error creating database:', err.message);
        return;
    }
    console.log('✅ Created new database file');
    initializeDatabase();
});

function initializeDatabase() {
    console.log('🔄 Creating database tables...');
    
    // Create users table
    const createUsersTable = `
        CREATE TABLE users (
            discord_id TEXT PRIMARY KEY NOT NULL,
            hedera_account_id TEXT,
            hbar_balance INTEGER DEFAULT 0
        )
    `;
    
    // Create token_balances table
    const createTokenBalancesTable = `
        CREATE TABLE token_balances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT NOT NULL,
            token_id TEXT NOT NULL,
            balance INTEGER DEFAULT 0,
            FOREIGN KEY (discord_id) REFERENCES users (discord_id)
        )
    `;

    db.run(createUsersTable, (err) => {
        if (err) {
            console.error('❌ Error creating users table:', err.message);
        } else {
            console.log('✅ Users table created');
        }
    });

    db.run(createTokenBalancesTable, (err) => {
        if (err) {
            console.error('❌ Error creating token_balances table:', err.message);
        } else {
            console.log('✅ Token balances table created');
            db.close();
            console.log('🔒 Database connection closed');
            console.log('🎉 Database reset complete! You can now start your bot.');
        }
    });
}