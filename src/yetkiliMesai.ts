import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
} from "discord.js";

const PANEL_CHANNEL_ID = "1531523283332370447";
const YETKILI_ROLE_ID = "1530910316899336395";
const GOREVDE_ROLE_ID = "1530910319185236118";

const START_BUTTON_ID = "yetkili-mesai-basla";
const STOP_BUTTON_ID = "yetkili-mesai-bitir";
const ACTIVE_PREFIX = "🟢 ";

const mesaiBaslangiclari = new Map<string, number>();
const eskiTakmaAdlar = new Map<string, string | null>();

export const yetkiliMesaiCommands = [
  new SlashCommandBuilder()
    .setName("yetkili-mesai-panel")
    .setDescription("Yetkili mesai panelini gönderir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];

function createPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor("DarkButNotBlack")
    .setTitle("Yetkili Mesai Paneli")
    .setDescription(
      [
        "Göreve başlamak veya görevden çıkmak için aşağıdaki butonları kullan.",
        "",
        "🟢 **Mesaiye Başla** — Görevde rolünü verir.",
        "🔴 **Mesaiden Çık** — Görevde rolünü kaldırır.",
      ].join("\n"),
    );
}

function createPanelRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(START_BUTTON_ID)
      .setLabel("Mesaiye Başla")
      .setEmoji("🟢")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(STOP_BUTTON_ID)
      .setLabel("Mesaiden Çık")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger),
  );
}

async function handlePanelCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "❌ Bu komut yalnızca bir sunucuda kullanılabilir.",
      ephemeral: true,
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "❌ Bu paneli kurmak için Sunucuyu Yönet yetkisine sahip olmalısın.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.channelId !== PANEL_CHANNEL_ID) {
    await interaction.reply({
      content: `❌ Bu komutu <#${PANEL_CHANNEL_ID}> kanalında kullanmalısın.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    embeds: [createPanelEmbed()],
    components: [createPanelRow()],
  });
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours} saat ${minutes} dakika`;
  }

  return `${minutes} dakika`;
}

async function sendLog(
  interaction: ButtonInteraction,
  content: string,
): Promise<void> {
  const channel = interaction.guild?.channels.cache.get(PANEL_CHANNEL_ID);

  if (channel?.isTextBased() && "send" in channel) {
    await channel.send({ content }).catch(console.error);
  }
}

async function handleStartButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "❌ Bu buton yalnızca bir sunucuda kullanılabilir.",
      ephemeral: true,
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);

  if (!member.roles.cache.has(YETKILI_ROLE_ID)) {
    await interaction.reply({
      content: `❌ Bu işlemi kullanmak için <@&${YETKILI_ROLE_ID}> rolüne sahip olmalısın.`,
      ephemeral: true,
    });
    return;
  }

  if (member.roles.cache.has(GOREVDE_ROLE_ID)) {
    await interaction.reply({
      content: "ℹ️ Zaten mesaidesin.",
      ephemeral: true,
    });
    return;
  }

  await member.roles.add(GOREVDE_ROLE_ID, "Yetkili mesaisi başladı");
  mesaiBaslangiclari.set(member.id, Date.now());

  if (!eskiTakmaAdlar.has(member.id)) {
    eskiTakmaAdlar.set(member.id, member.nickname);
  }

  const mevcutAd = member.displayName.replace(/^🟢\s*/, "");
  const yeniAd = `${ACTIVE_PREFIX}${mevcutAd}`.slice(0, 32);

  if (member.manageable) {
    await member.setNickname(yeniAd, "Yetkili mesaisi başladı").catch(console.error);
  }

  await interaction.reply({
    content: "🟢 Mesaiye başladın. Görevde rolün verildi.",
    ephemeral: true,
  });

  await sendLog(
    interaction,
    `🟢 ${member} mesaiye başladı. • <t:${Math.floor(Date.now() / 1000)}:F>`,
  );
}

async function handleStopButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "❌ Bu buton yalnızca bir sunucuda kullanılabilir.",
      ephemeral: true,
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);

  if (!member.roles.cache.has(YETKILI_ROLE_ID)) {
    await interaction.reply({
      content: `❌ Bu işlemi kullanmak için <@&${YETKILI_ROLE_ID}> rolüne sahip olmalısın.`,
      ephemeral: true,
    });
    return;
  }

  if (!member.roles.cache.has(GOREVDE_ROLE_ID)) {
    await interaction.reply({
      content: "ℹ️ Zaten mesaide değilsin.",
      ephemeral: true,
    });
    return;
  }

  await member.roles.remove(GOREVDE_ROLE_ID, "Yetkili mesaisi bitti");

  const startedAt = mesaiBaslangiclari.get(member.id);
  const duration = startedAt ? formatDuration(Date.now() - startedAt) : "süre kaydı bulunamadı";
  mesaiBaslangiclari.delete(member.id);

  if (member.manageable) {
    if (eskiTakmaAdlar.has(member.id)) {
      await member
        .setNickname(eskiTakmaAdlar.get(member.id) ?? null, "Yetkili mesaisi bitti")
        .catch(console.error);
    } else if (member.nickname?.startsWith(ACTIVE_PREFIX)) {
      await member
        .setNickname(member.nickname.slice(ACTIVE_PREFIX.length) || null, "Yetkili mesaisi bitti")
        .catch(console.error);
    }
  }

  eskiTakmaAdlar.delete(member.id);

  await interaction.reply({
    content: `🔴 Mesaiden çıktın. Toplam süre: **${duration}**.`,
    ephemeral: true,
  });

  await sendLog(
    interaction,
    `🔴 ${member} mesaiden çıktı. • Süre: **${duration}** • <t:${Math.floor(Date.now() / 1000)}:F>`,
  );
}

export async function handleYetkiliMesaiInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "yetkili-mesai-panel"
  ) {
    await handlePanelCommand(interaction);
    return true;
  }

  if (!interaction.isButton()) {
    return false;
  }

  if (interaction.customId === START_BUTTON_ID) {
    await handleStartButton(interaction);
    return true;
  }

  if (interaction.customId === STOP_BUTTON_ID) {
    await handleStopButton(interaction);
    return true;
  }

  return false;
}
