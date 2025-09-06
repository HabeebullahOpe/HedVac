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
    name: "rain",
    description: "Make it rain tokens to active users",
    options: [
      {
        name: "amount",
        type: 10, // NUMBER (accepts decimals) ✅
        description: "Total amount to distribute", // ✅
        required: true,
      },
      {
        name: "token",
        type: 3, // STRING
        description: "Token ID to rain (e.g., 0.0.1234567)", // ✅
        required: true, // ✅ CHANGED TO REQUIRED
      },
      {
        name: "duration",
        type: 4, // INTEGER
        description: "Limit to activity within last [n] minutes (default 60)", // ✅
        required: false,
      },
      {
        name: "recipients",
        type: 4, // INTEGER
        description: "Number of users to receive (default 10)", // ✅
        required: false,
      },
      {
        name: "min_role",
        type: 3, // STRING
        description: "Minimum role required", // ✅
        required: false,
      },
      {
        name: "message",
        type: 3, // STRING
        description: "Add a message to the rain", // ✅
        required: false,
      },
    ],
  }
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
