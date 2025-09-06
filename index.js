require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
} = require("discord.js");
const database = require("./database.js");
const { client: hederaClient } = require("./hedera.js");
const TransactionListener = require("./transaction-listener.js");
const { getTokenDisplayInfo } = require("./database");

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});

global.discordClient = discordClient;

// Global interaction timeout handling
discordClient.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isCommand()) return;
  setTimeout(() => {
    try {
      if (!interaction.responded && !interaction.replied) {
        // Let it timeout silently
      }
    } catch (error) {
      // Silent
    }
  }, 2000);
});

// Bot startup event
discordClient.once("ready", () => {
  console.log(`✅ Bot is online! Logged in as ${discordClient.user.tag}`);
  setTimeout(() => {
    const listener = new TransactionListener();
    listener.start();
  }, 5000);
});

// Helper function: Format token amounts
function formatTokenAmount(amount, decimals) {
  const rawAmount = amount / Math.pow(10, decimals);
  if (rawAmount % 1 === 0) {
    return rawAmount.toFixed(0);
  }
  return rawAmount
    .toString()
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.$/, "");
}

// Slash command handler
discordClient.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const { commandName } = interaction;

    // Handle /register
    if (commandName === "register") {
      try {
        await interaction.deferReply({ ephemeral: true });
        const providedAccountId = interaction.options.getString("accountid");

        if (providedAccountId && !/^0\.0\.\d+$/.test(providedAccountId)) {
          await interaction.editReply({
            content:
              "❌ That doesn't look like a valid Hedera Account ID (e.g., `0.0.1234567`). Please try again.",
          });
          return;
        }

        await database.setUser(interaction.user.id, providedAccountId || "");
        const successEmbed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle("Hedera Account Linked!")
          .setDescription(
            providedAccountId
              ? `Your Hedera account \`${providedAccountId}\` has been successfully linked!`
              : "Your account has been registered. Use `/register accountid: YOUR_ID` to add your Hedera address later."
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });
      } catch (error) {
        console.error("Database error on register:", error);
        await interaction.editReply({
          content: "❌ A database error occurred. Please try again later.",
        });
      }
    }

    // Handle /balance
    if (commandName === "balance") {
      await interaction.deferReply({ ephemeral: true });
      const user = await database.getUser(interaction.user.id);

      if (!user) {
        await interaction.editReply({
          content: "❌ You need to register first with `/register`!",
        });
        return;
      }

      // Get all balances
      const hbarBalance = await database.getHbarBalance(interaction.user.id);
      const tokenBalances = await database.getUserTokenBalances(
        interaction.user.id
      );
      const allBalances = [];

      // Add HBAR if non-zero
      if (hbarBalance > 0) {
        allBalances.push({
          name: "HBAR",
          amount: formatTokenAmount(hbarBalance, 8),
          isHbar: true,
        });
      }

      // Add tokens
      for (const token of tokenBalances) {
        try {
          const tokenInfo = await getTokenDisplayInfo(token.token_id);
          const decimals = tokenInfo.decimals || 0;
          allBalances.push({
            name: tokenInfo.name || token.token_id,
            amount: formatTokenAmount(token.balance, decimals),
            isHbar: false,
          });
        } catch (error) {
          allBalances.push({
            name: token.token_id,
            amount: token.balance.toString(),
            isHbar: false,
          });
        }
      }

      // Create embed
      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("💰 Your Balance")
        .setDescription(`**Account:** ${user.hedera_account_id || "Not set"}`);

      // Add all balances in one field
      if (allBalances.length > 0) {
        const balanceFields = allBalances
          .map((balance) => `${balance.name}: ${balance.amount}`)
          .join("\n");

        embed.addFields({
          name: "Balances",
          value: balanceFields,
          inline: false,
        });
      } else {
        embed.addFields({
          name: "Balances",
          value: "No balances yet",
          inline: false,
        });
      }

      embed.setFooter({ text: "Only you can see this" }).setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    }

    // Handle /deposit
    if (commandName === "deposit") {
      await interaction.deferReply({ ephemeral: true });
      const vaultAccountId = hederaClient.operatorAccountId.toString();

      const depositEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("💰 Deposit Address")
        .setDescription(
          `Send **HBAR** or **tokens** to this address:\n\n\`${vaultAccountId}\`\n\n**Important:**\n• Include your Discord ID (\`${interaction.user.id}\`) in the **memo field**\n• Only supported networks: Hedera\n• Deposits may take 1-2 minutes to process`
        )
        .addFields({
          name: "Memo Required",
          value: `You MUST include this in the memo:\n\`${interaction.user.id}\``,
          inline: false,
        })
        .setFooter({ text: "Do not send from exchanges" })
        .setTimestamp();

      await interaction.editReply({ embeds: [depositEmbed] });
    }

    // Handle /rain
    if (commandName === "rain") {
      await interaction.deferReply({ ephemeral: false });
      // ... (rain implementation needs to be added)
      await interaction.editReply({
        content: "🌧️ Rain feature is being implemented. Stay tuned!",
      });
    }
  } catch (error) {
    if (error.code === 10062) {
      // Ignore "Unknown interaction" errors - they're harmless
      console.log("⚠️ Interaction timed out (harmless)");
    } else {
      console.error("Interaction error:", error);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "❌ An error occurred",
            ephemeral: true,
          });
        }
      } catch (e) {
        // Ignore follow-up errors
      }
    }
  }
});

// Global error handling
process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

discordClient.on("error", (error) => {
  console.error("Discord client error:", error);
});

discordClient.login(process.env.DISCORD_TOKEN);
