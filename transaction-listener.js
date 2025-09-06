const axios = require("axios");
const database = require("./database.js");
const { client: hederaClient } = require("./hedera.js");
const { EmbedBuilder } = require("discord.js");

class TransactionListener {
  constructor() {
    this.vaultAccountId = hederaClient.operatorAccountId.toString();
    this.MIRROR_NODE_URL = "https://mainnet-public.mirrornode.hedera.com";
    this.pollingInterval = 30000; // Check every 30 seconds
    this.isPolling = false;
  }

  start() {
    console.log(
      `🔍 Starting transaction listener for vault: ${this.vaultAccountId}`
    );
    console.log(`⏰ Only processing transactions from NOW onward`);

    setTimeout(() => {
      this.safePoll();
      setInterval(() => this.safePoll(), this.pollingInterval);
    }, 10000);
  }

  async safePoll() {
    if (this.isPolling) return;
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
      const url = `${this.MIRROR_NODE_URL}/api/v1/transactions?account.id=${this.vaultAccountId}&order=desc&limit=10`;
      const response = await axios.get(url, { timeout: 10000 });
      const transactions = response.data.transactions;

      if (!transactions || transactions.length === 0) return;

      // Process transactions in parallel with limit
      const processingPromises = [];
      let processedCount = 0;
      const MAX_CONCURRENT = 3;

      for (const tx of transactions) {
        if (processedCount >= MAX_CONCURRENT) break;

        processingPromises.push(
          this.processTransactionWithCheck(tx).catch(console.error)
        );
        processedCount++;
      }

      await Promise.all(processingPromises);
    } catch (error) {
      console.error("❌ Polling error:", error.message);
    }
  }

  async processTransactionWithCheck(tx) {
    // Check if already processed
    const alreadyProcessed = await database.isTransactionProcessed(
      tx.transaction_id
    );
    if (alreadyProcessed) return;

    // Process the transaction
    await this.processTransaction(tx);

    // Mark as processed
    await database.addProcessedTransaction(tx.transaction_id);
  }

  async processTransaction(tx) {
    // Return immediately and process in background
    return new Promise((resolve) => {
      setTimeout(async () => {
        try {
          const txDetailsUrl = `${this.MIRROR_NODE_URL}/api/v1/transactions/${tx.transaction_id}`;
          const detailsResponse = await axios.get(txDetailsUrl, {
            timeout: 10000,
          });
          const txDetails = detailsResponse.data;

          if (!txDetails.transactions || txDetails.transactions.length === 0) {
            resolve();
            return;
          }

          const firstTx = txDetails.transactions[0];

          // Decode memo
          const memoBase64 = firstTx.memo_base64 || "";
          let discordId = "";
          try {
            discordId = Buffer.from(memoBase64, "base64")
              .toString("utf8")
              .trim();
          } catch (e) {
            resolve();
            return;
          }

          if (!/^\d+$/.test(discordId)) {
            resolve();
            return;
          }

          const user = await database.getUser(discordId);
          if (!user) {
            resolve();
            return;
          }

          // Process token transfers (non-blocking)
          if (firstTx.token_transfers && firstTx.token_transfers.length > 0) {
            for (const tokenTransfer of firstTx.token_transfers) {
              if (
                tokenTransfer.account === this.vaultAccountId &&
                tokenTransfer.amount > 0
              ) {
                console.log(`✅ Token transfer to user ${discordId}`);
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

          // Process HBAR transfers (non-blocking)
          if (firstTx.transfers && firstTx.transfers.length > 0) {
            const vaultTransfers = firstTx.transfers.filter(
              (t) => t.account === this.vaultAccountId && t.amount > 0
            );
            for (const transfer of vaultTransfers) {
              console.log(`✅ HBAR transfer to user ${discordId}`);
              await database.updateHbarBalance(discordId, transfer.amount);
              await this.sendDepositConfirmation(
                discordId,
                transfer.amount,
                tx.transaction_id,
                "HBAR"
              );
            }
          }

          resolve();
        } catch (error) {
          console.error("❌ Transaction processing error:", error.message);
          resolve();
        }
      }, 0); // Process in next event loop tick
    });
  }

  async sendDepositConfirmation(discordId, amount, transactionId, assetType) {
    try {
      const user = await global.discordClient.users.fetch(discordId);

      let displayAmount = amount;
      let assetName = assetType;

      if (assetType === "HBAR") {
        // Remove trailing zeros for HBAR
        displayAmount = this.formatAmount(amount / 100000000);
        assetName = "HBAR";
      } else {
        try {
          const tokenInfo = await this.getTokenInfo(assetType);
          const decimals = tokenInfo.decimals || 0;
          assetName = tokenInfo.symbol || tokenInfo.name || assetType;
          // Remove trailing zeros for tokens
          displayAmount = this.formatAmount(amount / Math.pow(10, decimals));
        } catch (error) {
          displayAmount = this.formatAmount(amount);
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
      console.log(`📨 Sent DM to user ${discordId}`);
    } catch (error) {
      console.error("Could not send DM:", error.message);
    }
  }

  formatAmount(amount) {
    // Convert to number and remove trailing zeros
    const number = Number(amount);
    return number % 1 === 0
      ? number.toString()
      : number.toString().replace(/(\.0*$)|(0*$)/, "");
  }

  async getTokenInfo(tokenId) {
    try {
      const url = `${this.MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`;
      const response = await axios.get(url, { timeout: 10000 });
      const tokenInfo = response.data;

      return {
        name: tokenInfo.name || tokenId,
        symbol: tokenInfo.symbol || "",
        decimals: tokenInfo.decimals || 0,
      };
    } catch (error) {
      return { name: tokenId, symbol: "", decimals: 0 };
    }
  }
}

module.exports = TransactionListener;
