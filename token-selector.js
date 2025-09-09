// token-selector.js
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

class TokenSelector {
  static createTokenSelectionMenu(userTokens, actionType, customId) {
    const options = [];

    // Add HBAR if user has balance
    if (userTokens.hbarBalance > 0) {
      options.push({
        label: "HBAR",
        description: `Balance: ${(userTokens.hbarBalance / 100000000).toFixed(8)}`,
        value: "HBAR",
      });
    }

    // Add other tokens
    userTokens.otherTokens.forEach((token) => {
      const displayBalance = token.balance / Math.pow(10, token.decimals || 0);
      const truncatedBalance = displayBalance.toFixed(6);

      options.push({
        label:
          token.name.length > 25
            ? token.name.substring(0, 22) + "..."
            : token.name,
        description: `Balance: ${truncatedBalance} | ${token.symbol || token.tokenId}`,
        value: token.tokenId,
      });
    });

    if (options.length === 0) {
      return null;
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(`Select token to ${actionType}`)
      .addOptions(options.slice(0, 25)); // Discord limit

    return new ActionRowBuilder().addComponents(selectMenu);
  }

  static createTokenSelectionEmbed(actionType, amount, recipient = null) {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(`🪙 Select Token to ${actionType.toUpperCase()}`)
      .setDescription(`Choose which token you want to ${actionType}`);

    if (actionType === "send") {
      embed.addFields(
        { name: "Amount", value: amount.toString(), inline: true },
        { name: "Recipient", value: recipient.tag, inline: true }
      );
    } else if (actionType === "rain") {
      embed.addFields({
        name: "Total Amount",
        value: amount.toString(),
        inline: true,
      });
    }
    return embed;
  }

  static createWithdrawConfirmation(tokenInfo, amount, address) {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle("⚠️ Confirm Withdrawal")
      .setDescription("Please confirm your withdrawal details:")
      .addFields(
        { name: "Amount", value: amount.toString(), inline: true },
        { name: "Token", value: tokenInfo.name, inline: true },
        { name: "To Address", value: address, inline: false }
      );

    return embed;
  }
}

module.exports = TokenSelector;
