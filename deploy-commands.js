//deploy-commands.js
const { REST, Routes } = require("discord.js");
require("dotenv").config();

const commands = [
  {
    name: "register",
    description: "Link your Hedera account to your Discord profile",
    options: [
      {
        name: "accountid",
        type: 3,
        description: "Your existing Hedera Account ID (e.g., 0.0.1234567)",
        required: false,
      },
    ],
  },
  {
    name: "deposit",
    description: "Get the vault address to deposit HBAR or tokens",
  },
  {
    name: "balance",
    description: "Check your current HBAR and token balance",
  },
  {
    name: "send",
    description: "Send tokens or HBAR to another user",
    options: [
      {
        name: "recipient",
        type: 6, // USER
        description: "The user to send to",
        required: true,
      },
      {
        name: "amount",
        type: 10, // NUMBER
        description: "Amount to send",
        required: true,
      },
      {
        name: "message",
        type: 3, // STRING
        description: "Optional message",
        required: false,
      },
    ],
  },
  {
    name: "rain",
    description: "Make it rain tokens to active users",
    options: [
      {
        name: "amount",
        type: 10,
        description: "Total amount to distribute",
        required: true, // REQUIRED first
      },
      {
        name: "duration",
        type: 4,
        description: "Limit to activity within last [n] minutes (default 60)",
        required: false, // OPTIONAL third
      },
      {
        name: "recipients",
        type: 4,
        description: "Number of users to receive (default 10)",
        required: false, // OPTIONAL fourth
      },
      {
        name: "min_role",
        type: 3,
        description: "Minimum role required",
        required: false, // OPTIONAL fifth
      },
      {
        name: "message",
        type: 3,
        description: "Add a message to the rain",
        required: false, // OPTIONAL sixth
      },
    ],
  },
  {
    name: "withdraw",
    description: "Withdraw tokens to your connected wallet",
    options: [
      {
        name: "address",
        type: 3, // STRING
        description: "Hedera address to withdraw to",
        required: true, // REQUIRED comes first
      },
      {
        name: "amount",
        type: 10, // NUMBER
        description: "Amount to withdraw (leave empty to withdraw all)",
        required: false, // OPTIONAL comes after required
      },
    ],
  },
  {
    name: "loot",
    description: "Drop loot for users to claim",
    options: [
      {
        name: "amount",
        type: 10, // NUMBER
        description: "Total amount to distribute",
        required: true,
      },
      {
        name: "claims",
        type: 4, // INTEGER
        description: "Number of users who can claim",
        required: true,
      },
      {
        name: "type",
        type: 3, // STRING
        description: "Type of loot (normal or mystery)",
        required: true,
        choices: [
          { name: "normal", value: "normal" },
          { name: "mystery", value: "mystery" },
        ],
      },
      {
        name: "duration",
        type: 4, // INTEGER
        description: "Duration in hours (default 24)",
        required: false,
      },
      {
        name: "min_role",
        type: 3, // STRING
        description: "Minimum role required to claim",
        required: false,
      },
      {
        name: "message",
        type: 3, // STRING
        description: "Message to include with the loot",
        required: false,
      },
    ],
  },
  {
    name: "claim",
    description: "Claim available loot",
    options: [
      {
        name: "loot_id",
        type: 3, // STRING
        description: "ID of the loot to claim",
        required: false,
      },
    ],
  },
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Started refreshing application (/) commands.");

    const clientId = process.env.CLIENT_ID;

    await rest.put(Routes.applicationCommands(clientId), { body: commands });

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
})();
