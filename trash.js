// Gather eligible users from DB + cache
let eligibleUsers = await database.getActiveUsers(
  interaction.guild.id,
  duration
);
const cachedActiveUsers = getActiveUsersFromCache(
  interaction.guild.id,
  duration
);
let allEligibleUsers = [
  ...new Set([...(eligibleUsers || []), ...(cachedActiveUsers || [])]),
];

// Ensure creator is not included among candidates
allEligibleUsers = allEligibleUsers.filter((id) => id !== userId);

// If fewer candidates than requested, expand using guild members (non-bots) to try to reach requested number
if (allEligibleUsers.length < recipientCount) {
  try {
    const members = await interaction.guild.members.fetch();
    for (const m of members.values()) {
      if (allEligibleUsers.length >= recipientCount) break;
      if (m.user.bot) continue;
      if (m.id === userId) continue; // exclude creator
      if (!allEligibleUsers.includes(m.id)) allEligibleUsers.push(m.id);
    }
  } catch (err) {
    console.warn(
      "Could not expand eligible users from guild members:",
      err.message
    );
  }
}

if (!allEligibleUsers || allEligibleUsers.length === 0) {
  await interaction.editReply({
    content: "❌ No eligible users found for the rain.",
    components: [],
  });
  return;
}

// Randomize candidate list and pick recipients
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
shuffle(allEligibleUsers);

const actualRecipientCount = Math.min(recipientCount, allEligibleUsers.length);
const recipients = allEligibleUsers.slice(0, actualRecipientCount);

// Compute integer distribution
const base = Math.floor(totalAmount / actualRecipientCount);
const remainder = totalAmount - base * actualRecipientCount; // leftover tiny-units

if (base === 0) {
  await interaction.editReply({
    content: "❌ Amount per user would be zero. Increase the total amount.",
    components: [],
  });
  return;
}

// Deduct the full total from creator
try {
  if (tokenId === "HBAR") {
    await database.deductHbarBalance(userId, totalAmount);
  } else {
    await database.deductTokenBalance(userId, tokenId, totalAmount);
  }
} catch (err) {
  console.error("Error deducting creator balance for rain:", err);
  await interaction.editReply({
    content: "❌ Could not deduct amount from your balance. Please try again.",
    components: [],
  });
  return;
}

// Credit each recipient with base
let distributedAmount = 0;
let distributedCount = 0;
for (const uid of recipients) {
  try {
    if (tokenId === "HBAR") {
      await database.updateHbarBalance(uid, base);
    } else {
      await database.updateTokenBalance(uid, tokenId, base);
    }
    distributedAmount += base;
    distributedCount++;
    // DM the recipient (best-effort)
    try {
      const recipientUser = await discordClient.users.fetch(uid);
      const displayAmt = formatTokenAmount(base, decimals);
      const tokenInfo =
        tokenId === "HBAR"
          ? { name: "HBAR" }
          : await database.getTokenDisplayInfo(tokenId);
      const rainEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("🌧 You received rain!")
        .setDescription(
          `You received ${displayAmt} ${tokenInfo.name} from ${interaction.user.tag}'s rain!`
        )
        .addFields(
          { name: "Amount", value: displayAmt, inline: true },
          { name: "Asset", value: tokenInfo.name, inline: true }
        )
        .setTimestamp();

      if (rainMessage)
        rainEmbed.addFields({
          name: "Message",
          value: rainMessage,
          inline: false,
        });
      await recipientUser.send({ embeds: [rainEmbed] });
    } catch (dmErr) {
      // ignore DM errors
    }
  } catch (err) {
    console.error("Could not credit recipient in rain:", uid, err);
  }
}

// Credit remainder back to creator (no DM) so creator effectively pays only the distributedAmount
if (remainder > 0) {
  try {
    if (tokenId === "HBAR") {
      await database.updateHbarBalance(userId, remainder);
    } else {
      await database.updateTokenBalance(userId, tokenId, remainder);
    }
  } catch (err) {
    console.error("Could not return remainder to creator:", err);
    // Not fatal — recipients were already credited. Log for admin to inspect.
  }
}

// Record rain event
try {
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
} catch (err) {
  console.error("Could not record rain event:", err);
}

// Announcement
try {
  const tokenInfoForTitle =
    tokenId === "HBAR"
      ? { name: "HBAR" }
      : await database.getTokenDisplayInfo(tokenId);
  const rainAnnouncementEmbed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("🌧 IT'S RAINING!")
    .setDescription(
      `**${interaction.user.tag} rained ${formatTokenAmount(distributedAmount, decimals)} ${tokenInfoForTitle.name} to ${distributedCount} users**\n\n${rainMessage || ""}`
    )
    .setTimestamp();

  const recipientListMessage = recipients
    .map(
      (uid) =>
        `💰 <@${uid}>: ${formatTokenAmount(base, decimals)} ${tokenInfoForTitle.name}`
    )
    .join("\n");

  await interaction.editReply({
    content: "🌧 Rain distribution completed!",
    embeds: [],
    components: [],
  });

  await interaction.followUp({ embeds: [rainAnnouncementEmbed] });
  await interaction.followUp({ content: recipientListMessage });
} catch (err) {
  console.error("Could not send rain announcement:", err);
}