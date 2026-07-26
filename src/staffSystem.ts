import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Guild,
  GuildMember,
  Interaction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type GuildTextBasedChannel,
  type Role,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";

/* =========================================================
   TEMİZ YETKİLİ NUMARA + GÖREV SİSTEMİ
========================================================= */

const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "staff-system.json");

const STAFF_ROLE_NAME = "Yetkili";
const DUTY_ROLE_NAME = "Görevde";
const CATEGORY_NAME = "YETKİLİ SİSTEMİ";
const PANEL_CHANNEL_NAME = "yetkili-panel";

const NUMBER_BUTTON_ID = "staff:number";
const DUTY_BUTTON_ID = "staff:duty";

interface GuildSettings {
  staffRoleId: string;
  dutyRoleId: string;
  panelChannelId: string;
  nextNumber: number;
  numbers: Record<string, number>;
}

interface Database {
  guilds: Record<string, GuildSettings>;
}

let database: Database = loadDatabase();

function loadDatabase(): Database {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { guilds: {} };
    }

    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as Database;

    return parsed?.guilds
      ? parsed
      : { guilds: {} };
  } catch (error) {
    console.error("❌ Yetkili sistemi veritabanı okunamadı:", error);
    return { guilds: {} };
  }
}

function saveDatabase(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2), "utf8");
}

function cleanName(name: string): string {
  return name.replace(/^\[\d+\]\s*-\s*/u, "").trim() || "Yetkili";
}

function createNickname(number: number, member: GuildMember): string {
  const baseName = cleanName(
    member.nickname ??
      member.user.globalName ??
      member.user.username,
  );

  const prefix = `[${number}] - `;
  return `${prefix}${baseName.slice(0, Math.max(1, 32 - prefix.length))}`;
}

async function findOrCreateRole(
  guild: Guild,
  name: string,
): Promise<Role> {
  await guild.roles.fetch();

  const existing = guild.roles.cache.find(
    (role) =>
      role.name.toLocaleLowerCase("tr-TR") ===
      name.toLocaleLowerCase("tr-TR"),
  );

  if (existing) {
    return existing;
  }

  return guild.roles.create({
    name,
    reason: "Yetkili sistemi kurulumu",
  });
}

async function getTextChannel(
  guild: Guild,
  channelId: string,
): Promise<GuildTextBasedChannel | null> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return null;
  }

  return channel as GuildTextBasedChannel;
}

function createPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Yetkili İşlem Paneli")
    .setDescription(
      [
        "Aşağıdaki butonlardan işlem yapabilirsin.",
        "",
        "🔢 **Numaramı Al**",
        "Sana sıradaki numarayı verir ve ismini düzenler.",
        "",
        "📋 **Görev Al**",
        "Görevde rolünü verir. Tekrar basarsan rol kaldırılır.",
      ].join("\n"),
    )
    .setFooter({
      text: "Her kullanıcı yalnızca bir numara alabilir.",
    });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(NUMBER_BUTTON_ID)
      .setLabel("Numaramı Al")
      .setEmoji("🔢")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(DUTY_BUTTON_ID)
      .setLabel("Görev Al")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Primary),
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

export async function ensureStaffSystemSetup(
  guild: Guild,
): Promise<GuildSettings> {
  const botMember = guild.members.me;

  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("Botta Rolleri Yönet yetkisi yok.");
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error("Botta Kanalları Yönet yetkisi yok.");
  }

  const staffRole = await findOrCreateRole(guild, STAFF_ROLE_NAME);
  const dutyRole = await findOrCreateRole(guild, DUTY_ROLE_NAME);

  let category = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildCategory &&
      channel.name === CATEGORY_NAME,
  );

  if (!category) {
    category = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: staffRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
      reason: "Yetkili sistemi kurulumu",
    });
  }

  let panelChannel = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.name === PANEL_CHANNEL_NAME,
  );

  if (!panelChannel) {
    panelChannel = await guild.channels.create({
      name: PANEL_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: "Yetkili numarası ve görev alma paneli",
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: staffRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
          ],
          deny: [PermissionFlagsBits.SendMessages],
        },
      ],
      reason: "Yetkili sistemi kurulumu",
    });
  }

  const previous = database.guilds[guild.id];

  const settings: GuildSettings = {
    staffRoleId: staffRole.id,
    dutyRoleId: dutyRole.id,
    panelChannelId: panelChannel.id,
    nextNumber: previous?.nextNumber ?? 1,
    numbers: previous?.numbers ?? {},
  };

  database.guilds[guild.id] = settings;
  saveDatabase();

  const channel = await getTextChannel(guild, panelChannel.id);

  if (!channel) {
    throw new Error("Yetkili panel kanalı kullanılamıyor.");
  }

  await channel.send(createPanel());

  return settings;
}

export const staffSystemCommands = [
  new SlashCommandBuilder()
    .setName("yetkili-panel")
    .setDescription("Yetkili panelini kurar veya tekrar gönderir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];

async function requireStaff(
  interaction: ButtonInteraction,
): Promise<{
  member: GuildMember;
  settings: GuildSettings;
} | null> {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.editReply("❌ Sunucu bilgisi alınamadı.");
    return null;
  }

  const settings = database.guilds[interaction.guildId];

  if (!settings) {
    await interaction.editReply(
      "❌ Sistem kurulu değil. Yönetici `/kurulum` yazmalı.",
    );
    return null;
  }

  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);

  if (!member) {
    await interaction.editReply("❌ Üyelik bilgin alınamadı.");
    return null;
  }

  if (!member.roles.cache.has(settings.staffRoleId)) {
    await interaction.editReply(
      "❌ Yetkili rolüne sahip değilsin.",
    );
    return null;
  }

  return { member, settings };
}

async function handleNumberButton(
  interaction: ButtonInteraction,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const result = await requireStaff(interaction);

  if (!result) {
    return;
  }

  const { member, settings } = result;
  const existingNumber = settings.numbers[member.id];

  if (existingNumber !== undefined) {
    await interaction.editReply(
      `ℹ️ Zaten **${existingNumber}** numarasına sahipsin.`,
    );
    return;
  }

  if (!member.manageable) {
    await interaction.editReply(
      [
        "❌ Bot takma adını değiştiremiyor.",
        "Bot rolünü Yetkili rolünün üstüne taşı.",
        "Sunucu sahibinin takma adı bot tarafından değiştirilemez.",
      ].join("\n"),
    );
    return;
  }

  const number = settings.nextNumber;
  const nickname = createNickname(number, member);

  try {
    await member.setNickname(
      nickname,
      `Yetkili numarası verildi: ${number}`,
    );
  } catch (error) {
    console.error("❌ Takma adı değiştirilemedi:", error);

    await interaction.editReply(
      "❌ Takma adın değiştirilemedi. Bot rolünü kullanıcının en yüksek rolünün üstüne taşı.",
    );
    return;
  }

  settings.numbers[member.id] = number;
  settings.nextNumber = number + 1;
  saveDatabase();

  await interaction.editReply(
    `✅ Numaran **${number}** oldu.\nYeni ismin: **${member.displayName}**`,
  );
}

async function handleDutyButton(
  interaction: ButtonInteraction,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const result = await requireStaff(interaction);

  if (!result || !interaction.guild) {
    return;
  }

  const { member, settings } = result;

  const dutyRole = await interaction.guild.roles
    .fetch(settings.dutyRoleId)
    .catch(() => null);

  if (!dutyRole) {
    await interaction.editReply("❌ Görevde rolü bulunamadı. `/kurulum` komutunu tekrar kullan.");
    return;
  }

  if (!dutyRole.editable) {
    await interaction.editReply("❌ Bot Görevde rolünü veremiyor. Bot rolünü yukarı taşı.");
    return;
  }

  if (member.roles.cache.has(dutyRole.id)) {
    await member.roles.remove(dutyRole, "Görev bırakıldı.");

    await interaction.editReply("✅ Görevden çıktın. Görevde rolün kaldırıldı.");
    return;
  }

  await member.roles.add(dutyRole, "Görev alındı.");

  await interaction.editReply("✅ Görev aldın. Görevde rolün verildi.");
}

async function handlePanelCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (
    !interaction.inGuild() ||
    !interaction.guild ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: "❌ Bu komut için Sunucuyu Yönet yetkisi gerekir.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const settings = await ensureStaffSystemSetup(interaction.guild);

  await interaction.editReply(
    `✅ Yetkili paneli hazırlandı: <#${settings.panelChannelId}>`,
  );
}

export async function handleStaffSystemInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "yetkili-panel"
  ) {
    await handlePanelCommand(interaction);
    return true;
  }

  if (!interaction.isButton()) {
    return false;
  }

  if (interaction.customId === NUMBER_BUTTON_ID) {
    await handleNumberButton(interaction);
    return true;
  }

  if (interaction.customId === DUTY_BUTTON_ID) {
    await handleDutyButton(interaction);
    return true;
  }

  return fals
