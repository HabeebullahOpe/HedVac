// index.js
require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
} = require("discord.js");
const database = require("./database.js");
const { client: hederaClient } = require("./hedera.js");
const TransactionListener = require("./transaction-listener.js");
const { getTokenDisplayInfo } = require("./database");
const TokenSelector = require("./token-selector.js");
const WithdrawManager = require("./withdraw-manager.js");

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

// Check if required environment variables are set
const requiredEnvVars = [
  "DISCORD_TOKEN",
  "CLIENT_ID",
  "HEDERA_OPERATOR_ID",
  "HEDERA_OPERATOR_KEY",
];
const missingEnvVars = requiredEnvVars.filter(
  (varName) => !process.env[varName]
);

if (missingEnvVars.length > 0) {
  console.error(
    `❌ Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
  process.exit(1);
}

console.log("✅ All required environment variables are set");

// Message activity tracking
const userLastActivity = new Map();

discordClient.on("messageCreate", (message) => {
  if (message.author.bot || !message.guild) return;

  // Track user activity with timestamp
  if (!userLastActivity.has(message.guild.id)) {
    userLastActivity.set(message.guild.id, new Map());
  }

  const guildActivity = userLastActivity.get(message.guild.id);
  guildActivity.set(message.author.id, Date.now());

  // Clean up old entries periodically (keep only last 24 hours)
  if (Math.random() < 0.01) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [userId, timestamp] of guildActivity) {
      if (timestamp < cutoff) {
        guildActivity.delete(userId);
      }
    }
  }
});

// Add this helper function to check active users
function getActiveUsersFromCache(guildId, durationMinutes = 60) {
  if (!userLastActivity.has(guildId)) {
    return [];
  }

  const cutoffTime = Date.now() - durationMinutes * 60 * 1000;
  const guildActivity = userLastActivity.get(guildId);
  const activeUsers = [];

  for (const [userId, lastActivity] of guildActivity) {
    if (lastActivity >= cutoffTime) {
      activeUsers.push(userId);
    }
  }

  return activeUsers;
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
      console.log(
        "🔄 Processing balance command for user:",
        interaction.user.id
      );
      await interaction.deferReply({ ephemeral: true });

      try {
        const user = await database.getUser(interaction.user.id);
        console.log("✅ User found:", !!user);

        if (!user) {
          await interaction.editReply({
            content: "❌ You need to register first with `/register`!",
          });
          return;
        }

        // Get all balances
        const hbarBalance = await database.getHbarBalance(interaction.user.id);
        console.log("✅ HBAR balance:", hbarBalance);

        const tokenBalances = await database.getUserTokenBalances(
          interaction.user.id
        );
        console.log("✅ Token balances count:", tokenBalances.length);

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
          .setDescription(
            `**Account:** ${user.hedera_account_id || "Not set"}`
          );

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

        // FIX: Add await here - this was missing!
        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error("❌ Balance command error:", error);
        await interaction.editReply({
          content: "❌ Error fetching balance. Please try again.",
        });
      }
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

    // Handle /send
    if (commandName === "send") {
      await interaction.deferReply({ ephemeral: true });

      const recipientUser = interaction.options.getUser("recipient");
      const amount = interaction.options.getNumber("amount");
      const message = interaction.options.getString("message");

      if (recipientUser.bot) {
        await interaction.editReply({
          content: "❌ You cannot send to bots.",
        });
        return;
      }

      if (recipientUser.id === interaction.user.id) {
        await interaction.editReply({
          content: "❌ You cannot send to yourself.",
        });
        return;
      }

      if (amount <= 0) {
        await interaction.editReply({
          content: "❌ Amount must be positive.",
        });
        return;
      }

      const sender = await database.getUser(interaction.user.id);
      if (!sender) {
        await interaction.editReply({
          content: "❌ You need to register first with `/register`!",
        });
        return;
      }

      // Check if recipient is registered
      const recipient = await database.getUser(recipientUser.id);
      if (!recipient) {
        await interaction.editReply({
          content: "❌ Recipient needs to register first with `/register`!",
        });
        return;
      }

      // Get user tokens for selection
      const hbarBalance = await database.getHbarBalance(interaction.user.id);
      const tokenBalances = await database.getUserTokenBalances(
        interaction.user.id
      );

      const userTokens = {
        hbarBalance,
        otherTokens: [],
      };

      for (const token of tokenBalances) {
        try {
          const tokenInfo = await database.getTokenDisplayInfo(token.token_id);
          userTokens.otherTokens.push({
            tokenId: token.token_id,
            name: tokenInfo.name || token.token_id,
            symbol: tokenInfo.symbol || "",
            decimals: tokenInfo.decimals || 0,
            balance: token.balance,
          });
        } catch (error) {
          userTokens.otherTokens.push({
            tokenId: token.token_id,
            name: token.token_id,
            symbol: "",
            decimals: 0,
            balance: token.balance,
          });
        }
      }

      // Create token selection menu
      const selectionMenu = TokenSelector.createTokenSelectionMenu(
        userTokens,
        "send",
        `send_token_${interaction.user.id}_${recipientUser.id}_${amount}_${message || ""}`
      );

      if (!selectionMenu) {
        await interaction.editReply({
          content: "❌ You don't have any tokens to send!",
        });
        return;
      }

      const embed = TokenSelector.createTokenSelectionEmbed(
        "send",
        amount,
        recipientUser
      );

      await interaction.editReply({
        embeds: [embed],
        components: [selectionMenu],
        ephemeral: true,
      });
    }

    // Handle /rain
    if (commandName === "rain") {
      await interaction.deferReply({ ephemeral: true });

      const amount = interaction.options.getNumber("amount");
      const duration = interaction.options.getInteger("duration") || 720;
      const recipientCount = interaction.options.getInteger("recipients") || 10;
      const minRole = interaction.options.getString("min_role");
      const rainMessage = interaction.options.getString("message");

      if (amount <= 0) {
        await interaction.editReply({
          content: "❌ Amount must be positive.",
        });
        return;
      }

      const creator = await database.getUser(interaction.user.id);
      if (!creator) {
        await interaction.editReply({
          content: "❌ You need to register first with `/register`!",
        });
        return;
      }

      // Get user tokens for selection
      const hbarBalance = await database.getHbarBalance(interaction.user.id);
      const tokenBalances = await database.getUserTokenBalances(
        interaction.user.id
      );

      const userTokens = {
        hbarBalance,
        otherTokens: [],
      };

      for (const token of tokenBalances) {
        try {
          const tokenInfo = await database.getTokenDisplayInfo(token.token_id);
          userTokens.otherTokens.push({
            tokenId: token.token_id,
            name: tokenInfo.name || token.token_id,
            symbol: tokenInfo.symbol || "",
            decimals: tokenInfo.decimals || 0,
            balance: token.balance,
          });
        } catch (error) {
          userTokens.otherTokens.push({
            tokenId: token.token_id,
            name: token.token_id,
            symbol: "",
            decimals: 0,
            balance: token.balance,
          });
        }
      }

      // Create token selection menu
      const selectionMenu = TokenSelector.createTokenSelectionMenu(
        userTokens,
        "rain",
        `rain_token_${interaction.user.id}_${amount}_${duration}_${recipientCount}_${minRole || ""}_${rainMessage || ""}`
      );

      if (!selectionMenu) {
        await interaction.editReply({
          content: "❌ You don't have any tokens to rain!",
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("🌧️ Make it Rain!")
        .setDescription("Select which token you want to distribute")
        .addFields(
          { name: "Total Amount", value: amount.toString(), inline: true },
          { name: "Duration", value: `${duration} minutes`, inline: true },
          { name: "Recipients", value: recipientCount.toString(), inline: true }
        );

      if (rainMessage) {
        embed.addFields({ name: "Message", value: rainMessage, inline: false });
      }

      await interaction.editReply({
        embeds: [embed],
        components: [selectionMenu],
        ephemeral: true,
      });
    }

    // Handle /withdraw
    if (commandName === "withdraw") {
      await interaction.deferReply({ ephemeral: true });

      const address = interaction.options.getString("address");
      const amount = interaction.options.getNumber("amount");

      // Validate address
      if (!/^0\.0\.\d+$/.test(address)) {
        await interaction.editReply({
          content: "❌ Invalid Hedera address format. Use format: 0.0.1234567",
        });
        return;
      }

      const user = await database.getUser(interaction.user.id);
      if (!user) {
        await interaction.editReply({
          content: "❌ You need to register first with `/register`!",
        });
        return;
      }

      // Check HBAR balance for withdrawal fee (0.25 HBAR)
      const withdrawalFee = 15000000; // 0.25 HBAR in tinybars
      const userHbarBalance = await database.getHbarBalance(
        interaction.user.id
      );

      if (userHbarBalance < withdrawalFee) {
        await interaction.editReply({
          content: `❌ Insufficient HBAR for withdrawal fee! You need 0.15 HBAR for withdrawal fees, but only have ${(userHbarBalance / 100000000).toFixed(8)} HBAR.`,
        });
        return;
      }

      // Get user tokens for selection
      const hbarBalance = await database.getHbarBalance(interaction.user.id);
      const tokenBalances = await database.getUserTokenBalances(
        interaction.user.id
      );

      const userTokens = {
        hbarBalance,
        otherTokens: [],
      };

      for (const token of tokenBalances) {
        try {
          const tokenInfo = await database.getTokenDisplayInfo(token.token_id);
          userTokens.otherTokens.push({
            tokenId: token.token_id,
            name: tokenInfo.name || token.token_id,
            symbol: tokenInfo.symbol || "",
            decimals: tokenInfo.decimals || 0,
            balance: token.balance,
          });
        } catch (error) {
          userTokens.otherTokens.push({
            tokenId: token.token_id,
            name: token.token_id,
            symbol: "",
            decimals: 0,
            balance: token.balance,
          });
        }
      }

      // Create token selection menu with "Withdraw All" option
      const selectionMenu = TokenSelector.createTokenSelectionMenu(
        userTokens,
        "withdraw",
        `withdraw_token_${interaction.user.id}_${amount || "all"}_${address}`
      );

      if (!selectionMenu) {
        await interaction.editReply({
          content: "❌ You don't have any tokens to withdraw!",
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("🔄 Withdraw Tokens")
        .setDescription(
          amount
            ? `Select which token you want to withdraw`
            : `Select tokens to withdraw (amount will be your full balance)`
        )
        .addFields(
          {
            name: "Amount",
            value: amount ? amount.toString() : "Full Balance",
            inline: true,
          },
          { name: "Recipient", value: address, inline: true }
        );

      await interaction.editReply({
        embeds: [embed],
        components: [selectionMenu],
        ephemeral: true,
      });
    }

    // Handle /loot command
    if (commandName === "loot") {
      await interaction.deferReply({ ephemeral: true });

      const amount = interaction.options.getNumber("amount");
      const maxClaims = interaction.options.getInteger("claims");
      const lootType = interaction.options.getString("type");
      const duration = interaction.options.getInteger("duration") || 24;
      const minRole = interaction.options.getString("min_role");
      const lootMessage = interaction.options.getString("message");

      if (amount <= 0 || maxClaims <= 0) {
        await interaction.editReply({
          content: "❌ Amount and claims must be positive.",
        });
        return;
      }

      const creator = await database.getUser(interaction.user.id);
      if (!creator) {
        await interaction.editReply({
          content: "❌ You need to register first with `/register`!",
        });
        return;
      }

      // Get user tokens for selection
      const hbarBalance = await database.getHbarBalance(interaction.user.id);
      const tokenBalances = await database.getUserTokenBalances(
        interaction.user.id
      );

      const userTokens = {
        hbarBalance,
        otherTokens: [],
      };

      for (const token of tokenBalances) {
        try {
          const tokenInfo = await database.getTokenDisplayInfo(token.token_id);
          userTokens.otherTokens.push({
            tokenId: token.token_id,
            name: tokenInfo.name || token.token_id,
            symbol: tokenInfo.symbol || "",
            decimals: tokenInfo.decimals || 0,
            balance: token.balance,
          });
        } catch (error) {
          userTokens.otherTokens.push({
            tokenId: token.token_id,
            name: token.token_id,
            symbol: "",
            decimals: 0,
            balance: token.balance,
          });
        }
      }

      // Create token selection menu
      const selectionMenu = TokenSelector.createTokenSelectionMenu(
        userTokens,
        "loot",
        `loot_token_${interaction.user.id}_${amount}_${maxClaims}_${lootType}_${duration}_${minRole || ""}_${lootMessage || ""}`
      );

      if (!selectionMenu) {
        await interaction.editReply({
          content: "❌ You don't have any tokens to drop as loot!",
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("🎁 Drop Loot!")
        .setDescription("Select which token you want to drop as loot")
        .addFields(
          { name: "Total Amount", value: amount.toString(), inline: true },
          { name: "Max Claims", value: maxClaims.toString(), inline: true },
          { name: "Type", value: lootType, inline: true },
          { name: "Duration", value: `${duration} hours`, inline: true }
        );

      if (lootMessage) {
        embed.addFields({ name: "Message", value: lootMessage, inline: false });
      }

      await interaction.editReply({
        embeds: [embed],
        components: [selectionMenu],
        ephemeral: true,
      });
    }

    // Handle /claim command
    // if (commandName === "claim") {
    //   await interaction.deferReply({ ephemeral: true });

    //   const lootId = interaction.options.getString("loot_id");
    //   const user = await database.getUser(interaction.user.id);

    //   if (!user) {
    //     await interaction.editReply({
    //       content: "❌ You need to register first with `/register`!",
    //     });
    //     return;
    //   }

    //   // If loot ID is provided, claim that specific loot
    //   if (lootId) {
    //     await handleLootClaim(interaction, lootId);
    //     return;
    //   }

    //   // Show available loot list
    //   const activeLoot = await database.getActiveLootEvents(
    //     interaction.guild.id
    //   );

    //   if (activeLoot.length === 0) {
    //     await interaction.editReply({
    //       content: "❌ No active loot available to claim!",
    //     });
    //     return;
    //   }

    //   const lootOptions = activeLoot.map((loot, index) => {
    //     const expiresIn = Math.floor(
    //       (new Date(loot.expires_at) - new Date()) / (1000 * 60 * 60)
    //     );
    //     return {
    //       label: `Loot #${loot.id} - ${loot.loot_type === "mystery" ? "Mystery" : "Normal"}`,
    //       description: `Claims: ${loot.claim_count}/${loot.max_claims} - Expires: ${expiresIn}h`,
    //       value: loot.id.toString(),
    //     };
    //   });

    //   const selectMenu = new StringSelectMenuBuilder()
    //     .setCustomId(`claim_loot_${interaction.user.id}`)
    //     .setPlaceholder("Select loot to claim")
    //     .addOptions(lootOptions.slice(0, 25));

    //   const row = new ActionRowBuilder().addComponents(selectMenu);

    //   const embed = new EmbedBuilder()
    //     .setColor(0x0099ff)
    //     .setTitle("🎁 Available Loot")
    //     .setDescription("Select which loot you want to claim");

    //   await interaction.editReply({
    //     embeds: [embed],
    //     components: [row],
    //   });
    // }
  } catch (error) {
    if (error.code === 10062) {
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

// Handle token selection
discordClient.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  try {
    if (interaction.customId.startsWith("send_token_")) {
      await handleSendTokenSelection(interaction);
    } else if (interaction.customId.startsWith("rain_token_")) {
      await handleRainTokenSelection(interaction);
    } else if (interaction.customId.startsWith("withdraw_token_")) {
      await handleWithdrawTokenSelection(interaction);
    } else if (interaction.customId.startsWith("loot_token_")) {
      await handleLootTokenSelection(interaction);
    } else if (interaction.customId.startsWith("claim_loot_")) {
      await handleLootSelection(interaction);
    }
  } catch (error) {
    console.error("Token selection error:", error);
  }
});

// Handle button interactions
discordClient.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    if (interaction.customId.startsWith("withdraw_confirm_")) {
      // Defer immediately to prevent timeout
      await interaction.deferUpdate();
      await handleWithdrawConfirm(interaction);
    } else if (interaction.customId === "withdraw_cancel") {
      await interaction.deferUpdate();
      await interaction.editReply({
        content: "❌ Withdrawal cancelled",
        components: [],
        embeds: [],
      });
    } else if (interaction.customId.startsWith("withdraw_show_")) {
      await interaction.deferUpdate();
      const userId = interaction.customId.split("_")[2];

      if (interaction.user.id !== userId) {
        await interaction.editReply({
          content: "❌ This menu is not for you.",
          components: [],
        });
        return;
      }

      await handleWithdrawShow(interaction);
    } else if (
      interaction.customId === "withdraw_loading" ||
      interaction.customId === "withdraw_loading_cancel"
    ) {
      // Handle clicks on disabled buttons during processing
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "⏳ Withdrawal is already being processed. Please wait...",
          ephemeral: true,
        });
      } else {
        // If already replied/deferred, just ignore the click
        return;
      }
    } else if (interaction.customId.startsWith("claim_")) {
      const lootId = interaction.customId.split("_")[1];
      await interaction.deferReply({ ephemeral: true });
      await handleLootClaim(interaction, lootId);
    }
  } catch (error) {
    console.error("Button interaction error:", error);

    // Handle interaction already acknowledged errors
    if (
      error.code === 10062 ||
      error.message.includes("already acknowledged")
    ) {
      return; // Silent ignore - these are harmless
    }

    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ An error occurred processing your request.",
          ephemeral: true,
        });
      }
    } catch (e) {
      // Ignore follow-up errors
    }
  }
});

// ========== HANDLER FUNCTIONS ==========

async function handleSendTokenSelection(interaction) {
  await interaction.deferUpdate();

  const parts = interaction.customId.split("_");
  const userId = parts[2];
  const recipientId = parts[3];
  const amount = parseFloat(parts[4]);
  const message = parts.slice(5).join("_") || null;
  const tokenId = interaction.values[0];

  if (interaction.user.id !== userId) {
    await interaction.editReply({
      content: "❌ This menu is not for you.",
      components: [],
    });
    return;
  }

  const recipientUser = await discordClient.users.fetch(recipientId);

  // Convert amount to tinybars/tokens based on decimals
  let amountToSend = amount;
  let decimals = 8;

  if (tokenId !== "HBAR") {
    try {
      const tokenInfo = await database.getTokenDisplayInfo(tokenId);
      decimals = tokenInfo.decimals || 0;
      amountToSend = Math.round(amount * Math.pow(10, decimals));
    } catch (error) {
      await interaction.editReply({
        content: `❌ Error getting token information.`,
        components: [],
      });
      return;
    }
  } else {
    amountToSend = Math.round(amount * 100000000);
  }

  // Check sender balance
  let currentBalance;
  if (tokenId === "HBAR") {
    currentBalance = await database.getHbarBalance(userId);
  } else {
    currentBalance = await database.getTokenBalance(userId, tokenId);
  }

  if (currentBalance < amountToSend) {
    await interaction.editReply({
      content: `❌ Insufficient balance. You have ${formatTokenAmount(currentBalance, decimals)} ${tokenId === "HBAR" ? "HBAR" : "tokens"}.`,
      components: [],
    });
    return;
  }

  // Get token display info
  let displayName = tokenId === "HBAR" ? "HBAR" : tokenId;
  if (tokenId !== "HBAR") {
    try {
      const tokenInfo = await database.getTokenDisplayInfo(tokenId);
      displayName = tokenInfo.name || tokenInfo.symbol || tokenId;
    } catch (error) {
      displayName = tokenId;
    }
  }

  // Perform the transfer
  try {
    if (tokenId === "HBAR") {
      await database.deductHbarBalance(userId, amountToSend);
      await database.updateHbarBalance(recipientId, amountToSend);
    } else {
      await database.deductTokenBalance(userId, tokenId, amountToSend);
      await database.updateTokenBalance(recipientId, tokenId, amountToSend);
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("✅ Transfer Successful!")
      .setDescription(
        `You sent ${amount} ${displayName} to ${recipientUser.tag}`
      )
      .addFields(
        { name: "Amount", value: amount.toString(), inline: true },
        { name: "Asset", value: displayName, inline: true },
        { name: "Recipient", value: recipientUser.tag, inline: true }
      )
      .setTimestamp();

    if (message) {
      successEmbed.addFields({
        name: "Message",
        value: message,
        inline: false,
      });
    }

    await interaction.editReply({
      embeds: [successEmbed],
      components: [],
    });

    // SEND PUBLIC ANNOUNCEMENT
    const publicAnnouncement = new EmbedBuilder()
      .setColor(0x0099ff)
      .setDescription(
        `🚀 ${interaction.user.tag} sent ${amount} ${displayName} to ${recipientUser.tag}`
      )
      .setTimestamp();

    // Send to the same channel where the command was used
    await interaction.channel.send({ embeds: [publicAnnouncement] });

    // Notify recipient via DM
    try {
      const recipientEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("💰 Received Funds!")
        .setDescription(
          `You received ${amount} ${displayName} from ${interaction.user.tag}`
        )
        .addFields(
          { name: "Amount", value: amount.toString(), inline: true },
          { name: "Asset", value: displayName, inline: true },
          { name: "Sender", value: interaction.user.tag, inline: true }
        )
        .setTimestamp();

      if (message) {
        recipientEmbed.addFields({
          name: "Message",
          value: message,
          inline: false,
        });
      }

      await recipientUser.send({ embeds: [recipientEmbed] });
    } catch (dmError) {
      console.log("Could not send DM to recipient:", dmError.message);
    }
  } catch (error) {
    console.error("Transfer error:", error);
    await interaction.editReply({
      content: "❌ Error processing transfer. Please try again.",
      components: [],
    });
  }
}

async function handleRainTokenSelection(interaction) {
  await interaction.deferUpdate();

  const parts = interaction.customId.split("_");
  const userId = parts[2];
  const amount = parseFloat(parts[3]);
  const duration = parseInt(parts[4]) || 60;
  const recipientCount = parseInt(parts[5]) || 10;
  const minRole = parts[6] || null;
  const rainMessage = parts.slice(7).join("_") || null;
  const tokenId = interaction.values[0];

  if (interaction.user.id !== userId) {
    await interaction.editReply({
      content: "❌ This menu is not for you.",
      components: [],
    });
    return;
  }

  // Convert amount to tinybars/tokens
  let totalAmount;
  let decimals = 8;

  if (tokenId === "HBAR") {
    totalAmount = Math.round(amount * 100000000);
  } else {
    try {
      const tokenInfo = await database.getTokenDisplayInfo(tokenId);
      decimals = tokenInfo.decimals || 0;
      totalAmount = Math.round(amount * Math.pow(10, decimals));
    } catch (error) {
      await interaction.editReply({
        content: `❌ Error getting token information.`,
        components: [],
      });
      return;
    }
  }

  // Check creator balance
  let currentBalance;
  if (tokenId === "HBAR") {
    currentBalance = await database.getHbarBalance(userId);
  } else {
    currentBalance = await database.getTokenBalance(userId, tokenId);
  }

  if (currentBalance < totalAmount) {
    await interaction.editReply({
      content: `❌ Insufficient balance. You have ${formatTokenAmount(currentBalance, decimals)} ${tokenId === "HBAR" ? "HBAR" : "tokens"}.`,
      components: [],
    });
    return;
  }

  // Get token display info
  let displayName = tokenId === "HBAR" ? "HBAR" : tokenId;
  if (tokenId !== "HBAR") {
    try {
      const tokenInfo = await database.getTokenDisplayInfo(tokenId);
      displayName = tokenInfo.name || tokenInfo.symbol || tokenId;
    } catch (error) {
      displayName = tokenId;
    }
  }

  // Get eligible users
  let eligibleUsers = await database.getActiveUsers(
    interaction.guild.id,
    duration
  );
  console.log(`🌧️ Database found ${eligibleUsers.length} active users`);

  // Also check cache for recently active users
  const cachedActiveUsers = getActiveUsersFromCache(
    interaction.guild.id,
    duration
  );
  console.log(`🌧️ Cache found ${cachedActiveUsers.length} active users`);

  // Combine both lists and remove duplicates
  const allEligibleUsers = [
    ...new Set([...eligibleUsers, ...cachedActiveUsers]),
  ];
  console.log(`🌧️ Total eligible users: ${allEligibleUsers.length}`);

  eligibleUsers = allEligibleUsers;
  const actualRecipientCount = Math.min(recipientCount, eligibleUsers.length);

  if (actualRecipientCount === 0) {
    await interaction.editReply({
      content: "❌ No eligible users found for the rain.",
      components: [],
    });
    return;
  }

  const amountPerUser = Math.floor(totalAmount / actualRecipientCount);

  if (amountPerUser === 0) {
    await interaction.editReply({
      content: "❌ Amount per user would be zero. Increase the total amount.",
      components: [],
    });
    return;
  }

  // Deduct balance from creator
  try {
    if (tokenId === "HBAR") {
      await database.deductHbarBalance(userId, totalAmount);
    } else {
      await database.deductTokenBalance(userId, tokenId, totalAmount);
    }

    // Distribute to recipients
    let distributedCount = 0;
    let distributedAmount = 0;

    for (const userId of eligibleUsers.slice(0, actualRecipientCount)) {
      if (tokenId === "HBAR") {
        await database.updateHbarBalance(userId, amountPerUser);
      } else {
        await database.updateTokenBalance(userId, tokenId, amountPerUser);
      }
      distributedCount++;
      distributedAmount += amountPerUser;

      // Notify recipient
      try {
        const recipientUser = await discordClient.users.fetch(userId);
        const rainEmbed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle("🌧️ You received rain!")
          .setDescription(
            `You received ${formatTokenAmount(amountPerUser, decimals)} ${displayName} from ${interaction.user.tag}'s rain!`
          )
          .addFields(
            {
              name: "Amount",
              value: formatTokenAmount(amountPerUser, decimals),
              inline: true,
            },
            { name: "Asset", value: displayName, inline: true }
          )
          .setTimestamp();

        if (rainMessage) {
          rainEmbed.addFields({
            name: "Message",
            value: rainMessage,
            inline: false,
          });
        }

        await recipientUser.send({ embeds: [rainEmbed] });
      } catch (dmError) {
        console.log("Could not send DM to rain recipient:", dmError.message);
      }
    }

    // Record rain event
    await database.createRainEvent({
      creator_id: userId,
      amount: totalAmount,
      token_id: tokenId,
      distributed_amount: distributedAmount,
      recipient_count: distributedCount,
      duration_minutes: duration,
      min_role: minRole,
      message: rainMessage,
      status: "completed",
    });

    // Create Algo Leagues style rain announcement
    const rainAnnouncementEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("🌧️ IT'S RAINING!")
      .setDescription(
        `**${interaction.user.tag} rained ${formatTokenAmount(distributedAmount, decimals)} ${displayName} to ${distributedCount} users**\n\n${rainMessage || ""}`
      )
      .setTimestamp();

    // Add money bag emoji to each recipient line
    const recipientListMessage = eligibleUsers
      .slice(0, actualRecipientCount)
      .map((userId) => {
        return `💰 <@${userId}>: ${formatTokenAmount(amountPerUser, decimals)} ${displayName}`;
      })
      .join("\n");

    // Clear the selection menu
    await interaction.editReply({
      content: "🌧️ Rain distribution completed!",
      embeds: [],
      components: [],
    });

    // Send announcement embed
    await interaction.followUp({
      embeds: [rainAnnouncementEmbed],
    });

    // Send recipient list as separate message
    await interaction.followUp({
      content: recipientListMessage,
    });
  } catch (error) {
    console.error("Rain distribution error:", error);
    await interaction.editReply({
      content: "❌ Error processing rain. Please try again.",
      components: [],
    });
  }
}

async function handleWithdrawTokenSelection(interaction) {
  await interaction.deferUpdate();

  const parts = interaction.customId.split("_");
  const userId = parts[2];
  const amountParam = parts[3]; // This can be "all" or a number
  const address = parts[4];
  const tokenId = interaction.values[0];

  if (interaction.user.id !== userId) {
    await interaction.editReply({
      content: "❌ This menu is not for you.",
      components: [],
    });
    return;
  }

  let amount;
  let withdrawAll = false;

  if (amountParam === "all") {
    withdrawAll = true;
  } else {
    amount = parseFloat(amountParam);
  }

  // Check balance
  let currentBalance;
  let decimals = 8;
  let amountToSend;

  if (tokenId === "HBAR") {
    currentBalance = await database.getHbarBalance(userId);

    if (withdrawAll) {
      // For HBAR, subtract fee from the total
      const withdrawalFee = 15000000;
      amountToSend = currentBalance - withdrawalFee;
      if (amountToSend < 0) amountToSend = 0;
    } else {
      amountToSend = Math.round(amount * 100000000);
    }
  } else {
    try {
      const tokenInfo = await database.getTokenDisplayInfo(tokenId);
      decimals = tokenInfo.decimals || 0;
      currentBalance = await database.getTokenBalance(userId, tokenId);

      if (withdrawAll) {
        amountToSend = currentBalance;
        amount = amountToSend / Math.pow(10, decimals); // For display
      } else {
        amountToSend = Math.round(amount * Math.pow(10, decimals));
      }
    } catch (error) {
      await interaction.editReply({
        content: `❌ Error getting token information.`,
        components: [],
      });
      return;
    }
  }

  // Check if user has sufficient balance
  if (currentBalance < amountToSend) {
    const displayBalance =
      currentBalance /
      (tokenId === "HBAR" ? 100000000 : Math.pow(10, decimals));
    await interaction.editReply({
      content: `❌ Insufficient balance! You have ${displayBalance.toFixed(6)} ${tokenId === "HBAR" ? "HBAR" : "tokens"}, but tried to withdraw ${withdrawAll ? "all" : amount}.`,
      components: [],
    });
    return;
  }

  // Check HBAR for withdrawal fee
  const withdrawalFee = 15000000;
  const userHbarBalance = await database.getHbarBalance(userId);

  if (userHbarBalance < withdrawalFee) {
    await interaction.editReply({
      content: `❌ Insufficient HBAR for withdrawal fee! You need 0.15 HBAR for withdrawal fees, but only have ${(userHbarBalance / 100000000).toFixed(8)} HBAR.`,
      components: [],
    });
    return;
  }

  // Get token display info
  let displayName = tokenId === "HBAR" ? "HBAR" : tokenId;
  if (tokenId !== "HBAR") {
    try {
      const tokenInfo = await database.getTokenDisplayInfo(tokenId);
      displayName = tokenInfo.name || tokenInfo.symbol || tokenId;
    } catch (error) {
      displayName = tokenId;
    }
  }

  // Create confirmation embed
  const confirmEmbed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle("⚠️ Confirm Withdrawal")
    .setDescription(
      `Please confirm your withdrawal details:\n**Withdrawal Fee: 0.15 HBAR**`
    )
    .addFields(
      {
        name: "Amount",
        value: withdrawAll ? "Full Balance" : amount.toString(),
        inline: true,
      },
      { name: "Token", value: displayName, inline: true },
      { name: "To Address", value: address, inline: false },
      { name: "Withdrawal Fee", value: "0.15 HBAR", inline: true }
    )
    .setFooter({ text: "This action cannot be undone" });

  // Create confirmation buttons
  const confirmButton = new ButtonBuilder()
    .setCustomId(
      `withdraw_confirm_${userId}_${tokenId}_${withdrawAll ? "all" : amount}_${address}`
    )
    .setLabel("Confirm Withdraw")
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId("withdraw_cancel")
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Danger);

  const buttonRow = new ActionRowBuilder().addComponents(
    cancelButton,
    confirmButton
  );

  await interaction.editReply({
    embeds: [confirmEmbed],
    components: [buttonRow],
  });
}

async function handleWithdrawConfirm(interaction) {
  // Disable the confirm button immediately to prevent double-clicks
  const disabledConfirmButton = new ButtonBuilder()
    .setCustomId("withdraw_loading")
    .setLabel("Processing...")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const disabledCancelButton = new ButtonBuilder()
    .setCustomId("withdraw_loading_cancel")
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const disabledRow = new ActionRowBuilder().addComponents(
    disabledCancelButton,
    disabledConfirmButton
  );

  // Update the message with disabled buttons first
  await interaction.editReply({
    components: [disabledRow],
  });

  const parts = interaction.customId.split("_");
  const userId = parts[2];
  const tokenId = parts[3];
  const amountParam = parts[4];
  const address = parts.slice(5).join("_");

  if (interaction.user.id !== userId) {
    await interaction.editReply({
      content: "❌ This menu is not for you.",
      components: [],
    });
    return;
  }

  // Add a processing message
  const processingEmbed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle("⏳ Processing Withdrawal...")
    .setDescription(
      "Your withdrawal is being processed. This may take a few seconds."
    )
    .setTimestamp();

  await interaction.editReply({
    embeds: [processingEmbed],
    components: [disabledRow],
  });

  // Process the withdrawal
  const result = await WithdrawManager.processWithdrawal(
    userId,
    tokenId,
    amountParam,
    address
  );

  if (result.success) {
    let displayName = tokenId === "HBAR" ? "HBAR" : tokenId;
    if (tokenId !== "HBAR") {
      try {
        const tokenInfo = await database.getTokenDisplayInfo(tokenId);
        displayName = tokenInfo.name || tokenInfo.symbol || tokenId;
      } catch (error) {
        displayName = tokenId;
      }
    }

    // Use result.displayAmount instead of the original amount
    const displayAmount =
      result.displayAmount !== undefined
        ? result.displayAmount
        : amountParam === "all"
          ? "All"
          : amountParam;

    const successEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("✅ Withdrawal Successful!")
      .setDescription(
        `Successfully withdrew ${displayAmount} ${displayName} to your wallet\n**Withdrawal Fee: 0.15 HBAR**`
      )
      .addFields(
        { name: "Amount", value: displayAmount.toString(), inline: true },
        { name: "Token", value: displayName, inline: true },
        { name: "Withdrawal Fee", value: "0.15 HBAR", inline: true },
        { name: "Recipient", value: address, inline: false }
      )
      .setTimestamp();

    // Handle different receipt types gracefully
    if (result.txId && result.txId !== "unknown") {
      successEmbed.addFields({
        name: "Transaction ID",
        value: `\`${result.txId}\``,
        inline: false,
      });
    } else if (result.receipt?.transactionId) {
      successEmbed.addFields({
        name: "Transaction ID",
        value: `\`${result.receipt.transactionId.toString()}\``,
        inline: false,
      });
    }

    await interaction.editReply({
      embeds: [successEmbed],
      components: [],
    });
  } else {
    // Handle token association error specifically
    if (result.error === "TOKEN_NOT_ASSOCIATED") {
      const associateEmbed = new EmbedBuilder()
        .setColor(0xff9900)
        .setTitle("🔗 Token Association Required")
        .setDescription(
          `The recipient wallet needs to associate with this token before you can withdraw.`
        )
        .addFields(
          {
            name: "Token",
            value: result.tokenName || result.tokenId,
            inline: true,
          },
          { name: "Token ID", value: `\`${result.tokenId}\``, inline: true },
          { name: "Recipient", value: address, inline: false }
        )
        .addFields({
          name: "How to Associate",
          value: `1. Copy the Token ID: \`${result.tokenId}\`\n2. Use HashScan to associate: https://hashscan.io/\n3. Or use your wallet's token association feature`,
          inline: false,
        })
        .setFooter({ text: "Once associated, you can withdraw normally" })
        .setTimestamp();

      await interaction.editReply({
        embeds: [associateEmbed],
        components: [],
      });
    } else {
      // Regular error handling
      await interaction.editReply({
        content: `❌ Withdrawal failed: ${result.error}`,
        components: [],
        embeds: [],
      });
    }
  }
}

async function handleWithdrawShow(interaction) {
  await interaction.deferUpdate();

  const hbarBalance = await database.getHbarBalance(interaction.user.id);
  const tokenBalances = await database.getUserTokenBalances(
    interaction.user.id
  );

  const userTokens = {
    hbarBalance,
    otherTokens: [],
  };

  for (const token of tokenBalances) {
    try {
      const tokenInfo = await database.getTokenDisplayInfo(token.token_id);
      userTokens.otherTokens.push({
        tokenId: token.token_id,
        name: tokenInfo.name || token.token_id,
        symbol: tokenInfo.symbol || "",
        decimals: tokenInfo.decimals || 0,
        balance: token.balance,
      });
    } catch (error) {
      userTokens.otherTokens.push({
        tokenId: token.token_id,
        name: token.token_id,
        symbol: "",
        decimals: 0,
        balance: token.balance,
      });
    }
  }

  const selectionMenu = WithdrawManager.createWithdrawSelection(userTokens);
  const buttons = WithdrawManager.createWithdrawButtons();

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle("🔄 Withdraw Tokens")
    .setDescription("Select tokens to withdraw to your connected wallet");

  await interaction.editReply({
    embeds: [embed],
    components: [selectionMenu, buttons],
  });
}

async function handleLootTokenSelection(interaction) {
  await interaction.deferUpdate();

  const parts = interaction.customId.split("_");
  const userId = parts[2];
  const amount = parseFloat(parts[3]);
  const maxClaims = parseInt(parts[4]);
  const lootType = parts[5];
  const duration = parseInt(parts[6]);
  const minRole = parts[7] || null;
  const lootMessage = parts.slice(8).join("_") || null;
  const tokenId = interaction.values[0];

  if (interaction.user.id !== userId) {
    await interaction.editReply({
      content: "❌ This menu is not for you.",
      components: [],
    });
    return;
  }

  // Convert amount based on token type
  let totalAmount;
  let decimals = 8;

  if (tokenId === "HBAR") {
    totalAmount = Math.round(amount * 100000000);
  } else {
    try {
      const tokenInfo = await database.getTokenDisplayInfo(tokenId);
      decimals = tokenInfo.decimals || 0;
      totalAmount = Math.round(amount * Math.pow(10, decimals));
    } catch (error) {
      await interaction.editReply({
        content: `❌ Error getting token information.`,
        components: [],
      });
      return;
    }
  }

  // Check balance
  let currentBalance;
  if (tokenId === "HBAR") {
    currentBalance = await database.getHbarBalance(userId);
  } else {
    currentBalance = await database.getTokenBalance(userId, tokenId);
  }

  if (currentBalance < totalAmount) {
    await interaction.editReply({
      content: `❌ Insufficient balance. You have ${formatTokenAmount(currentBalance, decimals)} ${tokenId === "HBAR" ? "HBAR" : "tokens"}.`,
      components: [],
    });
    return;
  }

  // Create loot event
  const expiresAt = new Date(Date.now() + duration * 60 * 60 * 1000);

  const lootData = {
    creator_id: userId,
    token_id: tokenId,
    total_amount: totalAmount,
    max_claims: maxClaims,
    loot_type: lootType,
    message: lootMessage,
    min_role: minRole,
    expires_at: expiresAt.toISOString(),
    status: "active",
    channel_id: interaction.channel.id,
  };

  try {
    // Deduct balance first
    if (tokenId === "HBAR") {
      await database.deductHbarBalance(userId, totalAmount);
    } else {
      await database.deductTokenBalance(userId, tokenId, totalAmount);
    }

    const lootEvent = await database.createLootEvent(lootData);

    // Get token info for display
    let displayName = tokenId === "HBAR" ? "HBAR" : tokenId;
    if (tokenId !== "HBAR") {
      try {
        const tokenInfo = await database.getTokenDisplayInfo(tokenId);
        displayName = tokenInfo.name || tokenInfo.symbol || tokenId;
      } catch (error) {
        displayName = tokenId;
      }
    }

    // Create loot announcement
    const lootEmbed = new EmbedBuilder()
      .setColor(lootType === "mystery" ? 0x800080 : 0x00ff00)
      .setTitle(
        `🎁 ${interaction.user.tag} dropped ${lootType === "mystery" ? "Mystery" : ""} Loot! 🎁`
      )
      .setDescription(
        lootType === "mystery"
          ? "Mystery Loot!"
          : `${formatTokenAmount(totalAmount, decimals)} ${displayName}`
      )
      .addFields(
        { name: "Number of Claims", value: `0/${maxClaims}`, inline: true },
        {
          name: "Expires",
          value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`,
          inline: true,
        }
      );

    if (lootMessage) {
      lootEmbed.addFields({
        name: "Message",
        value: lootMessage,
        inline: false,
      });
    }

    if (minRole) {
      lootEmbed.addFields({
        name: "Minimum Role",
        value: minRole,
        inline: true,
      });
    }

    const claimButton = new ButtonBuilder()
      .setCustomId(`claim_${lootEvent.id}`)
      .setLabel("Claim!")
      .setStyle(ButtonStyle.Primary);

    const buttonRow = new ActionRowBuilder().addComponents(claimButton);

    // Send to channel
    await interaction.channel.send({
      embeds: [lootEmbed],
      components: [buttonRow],
    });

    await interaction.editReply({
      content: `✅ Loot dropped successfully! Loot ID: #${lootEvent.id}`,
      components: [],
      embeds: [],
    });
  } catch (error) {
    console.error("Loot creation error:", error);
    await interaction.editReply({
      content: "❌ Error creating loot. Please try again.",
      components: [],
    });
  }
}

async function handleLootSelection(interaction) {
  await interaction.deferUpdate();
  const lootId = interaction.values[0];
  await handleLootClaim(interaction, lootId);
}

async function handleLootClaim(interaction, lootId) {
  const lootEvent = await database.getLootEvent(lootId);

  if (!lootEvent || lootEvent.status !== "active") {
    await interaction.editReply({
      content: ":smiling_face_with_tear:  This loot is no longer available.",
      components: [],
    });
    return;
  }

  // Check if user already claimed
  const existingClaim = await database.getUserLootClaims(
    interaction.user.id,
    lootId
  );
  if (existingClaim) {
    await interaction.editReply({
      content: ":stuck_out_tongue:  You've already claimed this loot!",
      components: [],
    });
    return;
  }

  // Calculate amount per claim
  const amountPerClaim = Math.floor(
    lootEvent.total_amount / lootEvent.max_claims
  );

  // Create claim
  try {
    await database.createLootClaim({
      loot_id: lootId,
      user_id: interaction.user.id,
      amount: amountPerClaim,
    });

    await database.updateLootEvent(lootId, { amount: amountPerClaim });

    // Credit user balance
    if (lootEvent.token_id === "HBAR") {
      await database.updateHbarBalance(interaction.user.id, amountPerClaim);
    } else {
      await database.updateTokenBalance(
        interaction.user.id,
        lootEvent.token_id,
        amountPerClaim
      );
    }

    // Get updated loot event with new claim count
    const updatedLoot = await database.getLootEvent(lootId);

    // Get token info
    let displayName =
      lootEvent.token_id === "HBAR" ? "HBAR" : lootEvent.token_id;
    let decimals = 8;

    if (lootEvent.token_id !== "HBAR") {
      try {
        const tokenInfo = await database.getTokenDisplayInfo(
          lootEvent.token_id
        );
        displayName = tokenInfo.name || tokenInfo.symbol || lootEvent.token_id;
        decimals = tokenInfo.decimals || 0;
      } catch (error) {
        displayName = lootEvent.token_id;
      }
    }

    const claimedEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(":partying_face:  Loot Claimed!")
      .setDescription(
        `You claimed ${formatTokenAmount(amountPerClaim, decimals)} ${displayName}!`
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [claimedEmbed],
      components: [],
    });

    // UPDATE THE ORIGINAL LOOT MESSAGE WITH NEW CLAIM COUNT
    try {
      // Find the original loot message (this assumes the loot message is in the same channel)
      const messages = await interaction.channel.messages.fetch({ limit: 50 });
      const lootMessage = messages.find(
        (msg) =>
          msg.embeds.length > 0 &&
          msg.embeds[0].data.title &&
          msg.embeds[0].data.title.includes("dropped") &&
          msg.components.length > 0
      );

      if (lootMessage && lootMessage.embeds[0]) {
        const originalEmbed = lootMessage.embeds[0];
        const newEmbed = EmbedBuilder.from(originalEmbed);

        // Update the claims field
        const fields = newEmbed.data.fields.map((field) => {
          if (field.name === "Number of Claims") {
            return {
              name: "Number of Claims",
              value: `${updatedLoot.claim_count}/${updatedLoot.max_claims}`,
              inline: field.inline,
            };
          }
          return field;
        });

        newEmbed.setFields(fields);

        // Remove claim button if all claims are taken
        let components = lootMessage.components;
        if (updatedLoot.claim_count >= updatedLoot.max_claims) {
          setTimeout(() => {
            sendLootCompletionSummary(lootId, interaction.channel);
          }, 2000);
          components = [];
        }

        await lootMessage.edit({
          embeds: [newEmbed],
          components: components,
        });
      }
    } catch (updateError) {
      console.error("Could not update loot message:", updateError.message);
    }
  } catch (error) {
    console.error("Claim error:", error);
    await interaction.editReply({
      content: "❌ Error claiming loot. Please try again.",
      components: [],
    });
  }
}

async function sendLootCompletionSummary(lootId, channel) {
  try {
    const lootEvent = await database.getLootEvent(lootId);
    const claims = await database.getLootClaims(lootId);

    if (!lootEvent || claims.length === 0) return;

    // Get token info
    let displayName =
      lootEvent.token_id === "HBAR" ? "HBAR" : lootEvent.token_id;
    let decimals = 8;

    if (lootEvent.token_id !== "HBAR") {
      try {
        const tokenInfo = await database.getTokenDisplayInfo(
          lootEvent.token_id
        );
        displayName = tokenInfo.name || tokenInfo.symbol || lootEvent.token_id;
        decimals = tokenInfo.decimals || 0;
      } catch (error) {
        displayName = lootEvent.token_id;
      }
    }

    const totalDistributed = claims.reduce(
      (sum, claim) => sum + claim.amount,
      0
    );
    const formattedAmount = formatTokenAmount(totalDistributed, decimals);

    // Create summary embed
    const summaryEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(`🎉 Loot Claimed!`)
      .setDescription(
        `${formattedAmount} ${displayName} claimed by ${claims.length} users:`
      );

    // Add top claimants (first 15-20)
    const topClaims = claims.slice(0, 18);
    let claimantsList = "";

    for (const claim of topClaims) {
      const user = await discordClient.users
        .fetch(claim.user_id)
        .catch(() => null);
      const username = user ? user.username : `Unknown User (${claim.user_id})`;
      const amount = formatTokenAmount(claim.amount, decimals);
      claimantsList += `- **${username}**: ${amount} ${displayName}\n`;
    }

    if (claims.length > 18) {
      claimantsList += `\n...and ${claims.length - 18} more`;
    }

    summaryEmbed.addFields({
      name: "Claimants",
      value: claimantsList,
      inline: false,
    });

    summaryEmbed.setFooter({
      text: `Loot #${lootId} • ${new Date().toLocaleDateString()}`,
    });

    // Send summary to channel
    await channel.send({ embeds: [summaryEmbed] });

    // Update loot status to completed
    await database.db.run(
      "UPDATE loot_events SET status = 'completed' WHERE id = ?",
      [lootId]
    );
  } catch (error) {
    console.error("Error sending loot summary:", error);
  }
}

// Add this function to check for expired loot periodically
async function checkExpiredLoot() {
  try {
    const expiredLoot = await database.db.all(
      "SELECT * FROM loot_events WHERE status = 'active' AND expires_at < datetime('now')"
    );

    if (!expiredLoot || !Array.isArray(expiredLoot)) {
      return; // Silent return - no loot or table doesn't exist yet
    }

    for (const loot of expiredLoot) {
      const channel = await discordClient.channels
        .fetch(loot.channel_id)
        .catch(() => null);
      if (channel) {
        await sendLootCompletionSummary(loot.id, channel);

        // Return unclaimed funds to creator
        const unclaimedAmount = loot.total_amount - loot.claimed_amount;
        if (unclaimedAmount > 0) {
          if (loot.token_id === "HBAR") {
            await database.updateHbarBalance(loot.creator_id, unclaimedAmount);
          } else {
            await database.updateTokenBalance(
              loot.creator_id,
              loot.token_id,
              unclaimedAmount
            );
          }
        }
      }
    }
  } catch (error) {
    if (!error.message.includes('no such table')) {
      console.error("Error checking expired loot:", error.message);
    }
  }
}

// Run this check every 5 minutes
setInterval(checkExpiredLoot, 5 * 60 * 1000);

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
