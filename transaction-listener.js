//transaction-listener.js
const jobQueue = require("./job-queue");
const axios = require("axios");
const database = require("./database.js");
const { client: hederaClient } = require("./hedera.js");
const { EmbedBuilder } = require("discord.js");

class TransactionListener {
  constructor() {
    this.vaultAccountId = hederaClient.operatorAccountId.toString();
    this.MIRROR_NODE_URL = "https://mainnet-public.mirrornode.hedera.com";
    this.pollingInterval = 30000;
    this.isPolling = false;
    this.tokenCache = new Map();
    this.cacheDuration = 60 * 60 * 1000;
  }

  start() {
    console.log(
      `🔍 Starting transaction listener for vault: ${this.vaultAccountId}`
    );

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
      const url = `${this.MIRROR_NODE_URL}/api/v1/transactions?account.id=${this.vaultAccountId}&order=desc&limit=5`;
      const response = await axios.get(url, { timeout: 8000 });
      const transactions = response.data.transactions;

      if (!transactions) return;

      // Add each transaction to job queue (NON-BLOCKING)
      for (const tx of transactions) {
        if (tx.result !== "SUCCESS" || tx.name !== "CRYPTOTRANSFER") continue;

        jobQueue.addJob(async () => {
          await this.processTransactionJob(tx);
        });
      }
    } catch (error) {
      console.error("❌ Polling error:", error.message);
    }
  }

  async processTransactionJob(tx) {
    try {
      // Check if already processed
      const alreadyProcessed = await database.isTransactionProcessed(
        tx.transaction_id
      );
      if (alreadyProcessed) return;

      const txDetailsUrl = `${this.MIRROR_NODE_URL}/api/v1/transactions/${tx.transaction_id}`;
      const detailsResponse = await axios.get(txDetailsUrl, { timeout: 8000 });
      const txDetails = detailsResponse.data;

      if (!txDetails.transactions) return;

      const firstTx = txDetails.transactions[0];
      const memoBase64 = firstTx.memo_base64 || "";

      let discordId = "";
      try {
        discordId = Buffer.from(memoBase64, "base64").toString("utf8").trim();
      } catch (e) {
        return;
      }

      if (!/^\d+$/.test(discordId)) return;

      const user = await database.getUser(discordId);
      if (!user) return;

      // Process transfers
      if (firstTx.token_transfers) {
        for (const tokenTransfer of firstTx.token_transfers) {
          if (
            tokenTransfer.account === this.vaultAccountId &&
            tokenTransfer.amount > 0
          ) {
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

      if (firstTx.transfers) {
        const vaultTransfers = firstTx.transfers.filter(
          (t) => t.account === this.vaultAccountId && t.amount > 0
        );
        for (const transfer of vaultTransfers) {
          await database.updateHbarBalance(discordId, transfer.amount);
          await this.sendDepositConfirmation(
            discordId,
            transfer.amount,
            tx.transaction_id,
            "HBAR"
          );
        }
      }

      await database.addProcessedTransaction(tx.transaction_id);
    } catch (error) {
      console.error("❌ Transaction job error:", error.message);
    }
  }

  async sendDepositConfirmation(discordId, amount, transactionId, assetType) {
    try {
      const user = await global.discordClient.users.fetch(discordId);

      let displayAmount = amount;
      let assetName = assetType;

      if (assetType === "HBAR") {
        displayAmount = this.formatAmount(amount / 100000000);
        assetName = "HBAR";
      } else {
        try {
          const tokenInfo = await this.getTokenInfo(assetType);
          const decimals = tokenInfo.decimals || 0;
          assetName = tokenInfo.symbol || tokenInfo.name || assetType;
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
    } catch (error) {
      console.error("Could not send DM:", error.message);
    }
  }

  async getTokenInfo(tokenId) {
    // Check cache first
    const cached = this.tokenCache.get(tokenId);
    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }

    try {
      const url = `${this.MIRROR_NODE_URL}/api/v1/tokens/${tokenId}`;
      const response = await axios.get(url, { timeout: 5000 });
      const tokenInfo = response.data;

      const result = {
        name: tokenInfo.name || tokenId,
        symbol: tokenInfo.symbol || "",
        decimals: tokenInfo.decimals || 0,
      };

      this.tokenCache.set(tokenId, {
        data: result,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      return { name: tokenId, symbol: "", decimals: 0 };
    }
  }

  formatAmount(amount) {
    const number = Number(amount);
    return number % 1 === 0
      ? number.toString()
      : number.toString().replace(/(\.0*$)|(0*$)/, "");
  }
}

module.exports = TransactionListener;
