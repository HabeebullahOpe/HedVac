// trash.js
const axios = require("axios");
const database = require("./database.js");
const { client: hederaClient } = require("./hedera.js");
const { EmbedBuilder } = require("discord.js");

class TransactionListener {
  constructor() {
    this.vaultAccountId = hederaClient.operatorAccountId.toString();
    this.MIRROR_NODE_URL = "https://mainnet-public.mirrornode.hedera.com";
    this.pollingInterval = 10000; // 10 seconds (safe within rate limits)
    this.isPolling = false;
    this.lastProcessedTimestamp = null;
    // this.processedTransactionIds = new Set();
  }

  async initialize() {
    this.lastProcessedTimestamp = await this.loadLastProcessedTimestamp();
    console.log(
      `⏰ Starting from timestamp: ${this.lastProcessedTimestamp.toISOString()}`
    );
  }

  async loadLastProcessedTimestamp() {
    try {
      return await database.getLastProcessedTimestamp();
    } catch (error) {
      console.error("Error loading timestamp from DB:", error);
      return new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago fallback
    }
  }

  async saveLastProcessedTimestamp(timestamp) {
    try {
      await database.setLastProcessedTimestamp(timestamp);
      this.lastProcessedTimestamp = timestamp;
    } catch (error) {
      console.error("Error saving timestamp to DB:", error);
    }
  }

  start() {
    console.log(
      `🔍 Starting transaction listener for vault: ${this.vaultAccountId}`
    );

    this.initialize().then(() => {
      setTimeout(() => {
        this.safePoll();
        setInterval(() => this.safePoll(), this.pollingInterval);
      }, 5000);
    });
  }

  async safePoll() {
    if (this.isPolling) {
      return; // Skip if already polling
    }

    this.isPolling = true;
    try {
      await this.pollTransactions();
    } catch (error) {
      console.error("❌ Polling error:", error.message);
    } finally {
      this.isPolling = false;
    }
  }

  async pollTransactions() {
    try {
      const timestampValue = Math.floor(
        this.lastProcessedTimestamp.getTime() / 1000
      );
      const url = `${this.MIRROR_NODE_URL}/api/v1/transactions?account.id=${this.vaultAccountId}&order=asc&timestamp=gt:${timestampValue}&limit=25`;

      const response = await axios.get(url, { timeout: 15000 });
      const transactions = response.data.transactions;

      if (!transactions || transactions.length === 0) {
        return;
      }

      let newestTimestamp = this.lastProcessedTimestamp;
      let processedCount = 0;

      for (const tx of transactions) {
        if (!tx.consensus_timestamp) continue;

        // CHECK DATABASE INSTEAD OF MEMORY
        const alreadyProcessed = await database.isTransactionProcessed(
          tx.transaction_id
        );
        if (alreadyProcessed) {
          continue;
        }

        const txTimestamp = new Date(tx.consensus_timestamp);

        if (txTimestamp > newestTimestamp) {
          newestTimestamp = txTimestamp;
        }

        try {
          await this.processTransaction(tx);
          // SAVE TO DATABASE INSTEAD OF MEMORY
          await database.addProcessedTransaction(tx.transaction_id);
          processedCount++;
        } catch (error) {
          console.log(
            `⏩ Skipping transaction ${tx.transaction_id}:`,
            error.message
          );
        }
      }

      if (processedCount > 0 && newestTimestamp > this.lastProcessedTimestamp) {
        await this.saveLastProcessedTimestamp(newestTimestamp);
        console.log(
          `✅ Processed ${processedCount} new transactions, updated to: ${newestTimestamp.toISOString()}`
        );
      }
    } catch (error) {
      console.error("❌ Polling error:", error.message);
    }
  }

  async processTransaction(tx) {
    // MAKE IT NON-BLOCKING - don't await the processing
    setTimeout(async () => {
      try {
        if (tx.result !== "SUCCESS" || tx.name !== "CRYPTOTRANSFER") {
          return;
        }

        const txDetailsUrl = `${this.MIRROR_NODE_URL}/api/v1/transactions/${tx.transaction_id}`;
        const detailsResponse = await axios.get(txDetailsUrl, {
          timeout: 15000,
        });
        const txDetails = detailsResponse.data;

        if (!txDetails.transactions || txDetails.transactions.length === 0)
          return;

        const firstTx = txDetails.transactions[0];

        // Decode memo to get Discord ID
        const memoBase64 = firstTx.memo_base64 || "";
        let discordId = "";
        try {
          discordId = Buffer.from(memoBase64, "base64").toString("utf8").trim();
        } catch (e) {
          return; // No valid memo
        }

        if (!/^\d+$/.test(discordId)) {
          return; // Invalid Discord ID
        }

        // Check if user exists
        const user = await database.getUser(discordId);
        if (!user) {
          return; // User not registered
        }

        // Process token transfers
        if (firstTx.token_transfers && firstTx.token_transfers.length > 0) {
          for (const tokenTransfer of firstTx.token_transfers) {
            if (
              tokenTransfer.account === this.vaultAccountId &&
              tokenTransfer.amount > 0
            ) {
              console.log(
                `✅ Token transfer: ${tokenTransfer.amount} of ${tokenTransfer.token_id} to user ${discordId}`
              );
              await database.updateTokenBalance(
                discordId,
                tokenTransfer.token_id,
                tokenTransfer.amount
              );
              await this.sendDepositConfirmation(
                discordId,
                tokenTransfer.amount,
                tx.transaction_id,
                tokenTransfer.token_id
              );
            }
          }
        }

        // Process HBAR transfers
        if (firstTx.transfers && firstTx.transfers.length > 0) {
          const vaultTransfers = firstTx.transfers.filter(
            (t) => t.account === this.vaultAccountId && t.amount > 0
          );
          for (const transfer of vaultTransfers) {
            console.log(
              `✅ HBAR transfer: ${transfer.amount} tinybars to user ${discordId}`
            );
            await database.updateHbarBalance(discordId, transfer.amount);
            await this.sendDepositConfirmation(
              discordId,
              transfer.amount,
              tx.transaction_id,
              "HBAR"
            );
          }
        }
      } catch (error) {
        console.error("❌ Transaction processing error:", error.message);
      }
    }, 0); // Process in next event loop tick
  }

  formatTokenAmount(amount, decimals) {
    const rawAmount = amount / Math.pow(10, decimals);
    if (rawAmount % 1 === 0) {
      return rawAmount.toFixed(0);
    }
    return rawAmount
      .toString()
      .replace(/(\.\d*?[1-9])0+$/, "$1")
      .replace(/\.$/, "");
  }

  async sendDepositConfirmation(discordId, amount, transactionId, assetType) {
    try {
      const user = await global.discordClient.users.fetch(discordId);
      let displayAmount = amount;
      let assetName = assetType;

      if (assetType === "HBAR") {
        displayAmount = this.formatTokenAmount(amount, 8);
        assetName = "HBAR";
      } else {
        try {
          const tokenInfo = await this.getTokenInfo(assetType);
          const decimals = tokenInfo.decimals || 0;
          assetName = tokenInfo.symbol || tokenInfo.name || assetType;
          displayAmount = this.formatTokenAmount(amount, decimals);
        } catch (error) {
          displayAmount = amount.toString();
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("💰 Deposit Received!")
        .setDescription(
          "Your deposit has been confirmed and credited to your balance."
        )
        .addFields(
          {
            name: "Amount",
            value: `${displayAmount} ${assetName}`,
            inline: true,
          },
          {
            name: "Transaction ID",
            value: `\`${transactionId}\``,
            inline: true,
          },
          { name: "New Balance", value: "Check with `/balance`", inline: true }
        )
        .setTimestamp();

      await user.send({ embeds: [embed] });
    } catch (error) {
      console.error("❌ Could not send DM:", error.message);
    }
  }

  async getTokenInfo(tokenId) {
    try {
      const url = `${this.MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`;
      const response = await axios.get(url, { timeout: 10000 });
      const tokenInfo = response.data;

      // Fix name/symbol confusion
      let name = tokenInfo.name || tokenId;
      let symbol = tokenInfo.symbol || "";

      // If name looks like a symbol and we have a symbol, swap them
      if (name && name.length <= 10 && !name.includes(" ") && symbol) {
        [name, symbol] = [symbol, name];
      }

      return { name, symbol, decimals: tokenInfo.decimals || 0 };
    } catch (error) {
      return { name: tokenId, symbol: "", decimals: 0 };
    }
  }
}

module.exports = TransactionListener;

