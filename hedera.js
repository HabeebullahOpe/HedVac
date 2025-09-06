// hedera.js
const {
  Client,
  PrivateKey,
  AccountBalanceQuery,
  TransferTransaction,
  Hbar,
} = require("@hashgraph/sdk");
require("dotenv").config();

// Configure the Hedera Client
let client;
if (process.env.HEDERA_NETWORK === "testnet") {
  client = Client.forTestnet();
} else if (process.env.HEDERA_NETWORK === "mainnet") {
  client = Client.forMainnet();
} else {
  client = Client.forMainnet(); // Default to mainnet for safety
}

// Set the operator account
const operatorId = process.env.HEDERA_OPERATOR_ID;
const operatorKey = PrivateKey.fromString(process.env.HEDERA_OPERATOR_KEY);
client.setOperator(operatorId, operatorKey);

// Function to get account balance
async function getAccountBalance(accountId) {
  try {
    const balanceQuery = new AccountBalanceQuery().setAccountId(accountId);
    const balance = await balanceQuery.execute(client);
    return balance;
  } catch (error) {
    console.error("Error fetching balance:", error);
    throw error;
  }
}

// Function to send HBAR
async function sendHbar(
  senderAccountId,
  senderPrivateKey,
  receiverAccountId,
  amount
) {
  try {
    const sendHbarTx = new TransferTransaction()
      .addHbarTransfer(senderAccountId, Hbar.fromTinybars(-amount))
      .addHbarTransfer(receiverAccountId, Hbar.fromTinybars(amount))
      .freezeWith(client);

    const signedTx = await sendHbarTx.sign(senderPrivateKey);
    const txResponse = await signedTx.execute(client);
    const receipt = await txResponse.getReceipt(client);

    return { success: true, receipt };
  } catch (error) {
    console.error("Error sending HBAR:", error);
    return { success: false, error };
  }
}

module.exports = {
  client,
  getAccountBalance,
  sendHbar,
};
