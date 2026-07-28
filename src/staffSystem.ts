import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CategoryChannel,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Guild,
  GuildMember,
  Interaction,
  PermissionFlagsBits,
  Role,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";

import fs from "node:fs";
import path from "node:path";

/* =========================================================
   TÜRLER
========================================================= */

interface GuildStaffSettings {
  staffRoleId: string;
  dutyRoleId: string;
  panelChannelId: string;
  logChannelId: string;
  activeNumbers: Record<string, number>;
  dutyStartedAt: Record<string, number>;
}

interface StaffDatabase {
  guilds: Record<string, GuildStaffSettings>;
}

interface StaffCheckResult {
  member: GuildMember;
  settings: GuildStaffSettings;
}

/* =========================================================
   SABİTLER
========================================================= */

const DATA_DIRECTORY = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIRECTORY, "staff-system.json");

const STAFF_ROLE_NAME = "Yetkili";
const DUTY_ROLE_NAME = "Görevde";

const CATEGORY_NAME = "YETKİLİ SİSTEMİ";
const PANEL_CHANNEL_NAME = "yetkili-panel";
const LOG_CHANNEL_NAME = "yetkili-mesai-log";

const ENTER_DUTY_BUTTON_ID = "staff:mesai-gir";
const EXIT_DUTY_BUTTON_ID = "staff:mesai-cik";

const DUTY_PREFIX_REGEX = /^🟢\s*\[(\d+)\]\s*/u;

/* =========================================================
   VERİTABANI
========================================================= */

function loadDatabase(): StaffDatabase {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { guilds: {} };
    }

    const content = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(content) as Partial<StaffDatabase>;

    return {
      guilds: parsed.guilds ?? {},
    };
  } catch (error) {
    console.error("Yetkili sistemi veritabanı okunamadı:", error);
    return { guilds: {} };
  }
}

function saveDatabase(): void {
  try {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(database, null, 2),
      "utf8",
    );
  } catch (error) {
    console.error("Yetkili sistemi veritabanı kaydedilemedi:", error);
  }
}

const database: StaffDatabase = loadDatabase();

/* =========================================================
   YARDIMCI FONKSİYONLAR
========================================================= */

function cleanNickname(name: string): string {
  const cleaned = name.replace(DUTY_PREFIX_REGEX, "").trim();
  return cleaned || "Yetkili";
}

function createDutyNickname(
  number: number,
  member: GuildMember,
): string {
  const currentName =
    member.nickname ??
    member.user.globalName ??
    member.user.username;

  const prefix = `🟢 [${number}] `;
  const cleanName = cleanNickname(currentName);
  const availableLength = Math.max(1, 32 - prefix.length);

  return `${prefix}${cleanName.slice(0, availableLength)}`;
}

function getLowestAvailableNumber(
  settings: GuildStaffSettings,
): number {
  const usedNumbers = new Set(
    Object.values(settings.activeNumbers)
      .filter((number) => Number.isSafeInteger(number) && number > 0),
  );

  let number = 1;

  while (usedNumbers.has(number)) {
    number += 1;
  }

  return number;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours} saat ${minutes} dakika`;
  }

  if (minutes > 0) {
    return `${minutes} dakika ${seconds} saniye`;
  }

  return `${seconds} saniye`;
}

async function findOrCreateRole(
  guild: Guild,
  roleName: string,
): Promise<Role> {
  await guild.roles.fetch();

  const existingRole = guild.roles.cache.find(
    (role) =>
      role.name.toLocaleLowerCase("tr-TR") ===
      roleName.toLocaleLowerCase("tr-TR"),
  );

  if (existingRole) {
    return existingRole;
  }

  return guild.roles.create({
    name: roleName,
    reason: "Yetkili mesai sistemi kurulumu",
  });
}

async function findOrCreateCategory(
  guild: Guild,
  staffRole: Role,
): Promise<CategoryChannel> {
  await guild.channels.fetch();

  const existingCategory = guild.channels.cache.find(
    (channel): channel is CategoryChannel =>
      channel.type === ChannelType.GuildCategory &&
      channel.name === CATEGORY_NAME,
  );

  if (existingCategory) {
    await existingCategory.permissionOverwrites.edit(
      guild.roles.everyone,
      { ViewChannel: false },
    );

    await existingCategory.permissionOverwrites.edit(
      staffRole,
      {
        ViewChannel: true,
        ReadMessageHistory: true,
      },
    );

    return existingCategory;
  }

  return guild.channels.create({
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
    reason: "Yetkili mesai sistemi kurulumu",
  });
}

async function findOrCreateTextChannel(
  guild: Guild,
  staffRole: Role,
  category: CategoryChannel,
  channelName: string,
  topic: string,
): Promise<TextChannel> {
  await guild.channels.fetch();

  const existingChannel = guild.channels.cache.find(
    (channel): channel is TextChannel =>
      channel.type === ChannelType.GuildText &&
      channel.name === channelName,
  );

  if (existingChannel) {
    if (existingChannel.parentId !== category.id) {
      await existingChannel.setParent(category.id);
    }

    await existingChannel.setTopic(topic).catch(() => null);

    await existingChannel.permissionOverwrites.edit(
      guild.roles.everyone,
      { ViewChannel: false },
    );

    await existingChannel.permissionOverwrites.edit(
      staffRole,
      {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: false,
      },
    );

    return existingChannel;
  }

  return guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category.id,
    topic,
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
    reason: "Yetkili mesai sistemi kurulumu",
  });
}

/* =========================================================
   PANEL
========================================================= */

function createPanelMessage() {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle("👮 Yetkili Mesai Paneli")
    .setDescription(
      [
        "Görev durumunu aşağıdaki butonlardan yönetebilirsin.",
        "",
        "🟢 **Mesaiye Gir**",
        "Görevde rolünü verir ve boş olan en küçük mesai numarasını atar.",
        "",
        "🔴 **Mesaiden Çık**",
        "Görevde rolünü, yeşil işareti ve mesai numarasını kaldırır.",
      ].join("\n"),
    )
    .setFooter({
      text: "Numaralar 1'den başlar. Boşalan numara yeniden kullanılır.",
    })
    .setTimestamp();

  const buttons =
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ENTER_DUTY_BUTTON_ID)
        .setLabel("Mesaiye Gir")
        .setEmoji("🟢")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(EXIT_DUTY_BUTTON_ID)
        .setLabel("Mesaiden Çık")
        .setEmoji("🔴")
        .setStyle(ButtonStyle.Danger),
    );

  return {
    embeds: [embed],
    components: [buttons],
  };
}

async function removeOldPanels(
  panelChannel: TextChannel,
): Promise<void> {
  const messages = await panelChannel.messages.fetch({
    limit: 50,
  }).catch(() => null);

  if (!messages) {
    return;
  }

  for (const message of messages.values()) {
    if (!message.author.bot) {
      continue;
    }

    const serializedComponents = JSON.stringify(
      message.components.map((component) => component.toJSON()),
    );

    const containsStaffButton =
      serializedComponents.includes('"custom_id":"staff:') ||
      serializedComponents.includes('"custom_id":"yetkili_');

    if (containsStaffButton) {
      await message.delete().catch(() => null);
    }
  }
}

/* =========================================================
   SİSTEM KURULUMU
========================================================= */

export async function ensureStaffSystemSetup(
  guild: Guild,
): Promise<GuildStaffSettings> {
  const botMember =
    guild.members.me ??
    (await guild.members.fetchMe().catch(() => null));

  if (!botMember) {
    throw new Error("Botun sunucu üyelik bilgisi alınamadı.");
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("Botta Rolleri Yönet yetkisi bulunmuyor.");
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error("Botta Kanalları Yönet yetkisi bulunmuyor.");
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) {
    throw new Error("Botta Takma Adları Yönet yetkisi bulunmuyor.");
  }

  const staffRole = await findOrCreateRole(guild, STAFF_ROLE_NAME);
  const dutyRole = await findOrCreateRole(guild, DUTY_ROLE_NAME);
  const category = await findOrCreateCategory(guild, staffRole);

  const panelChannel = await findOrCreateTextChannel(
    guild,
    staffRole,
    category,
    PANEL_CHANNEL_NAME,
    "Yetkililerin mesaiye giriş ve çıkış paneli",
  );

  const logChannel = await findOrCreateTextChannel(
    guild,
    staffRole,
    category,
    LOG_CHANNEL_NAME,
    "Yetkili mesai giriş ve çıkış kayıtları",
  );

  const previousSettings = database.guilds[guild.id];

  const settings: GuildStaffSettings = {
    staffRoleId: staffRole.id,
    dutyRoleId: dutyRole.id,
    panelChannelId: panelChannel.id,
    logChannelId: logChannel.id,
    activeNumbers: previousSettings?.activeNumbers ?? {},
    dutyStartedAt: previousSettings?.dutyStartedAt ?? {},
  };

  database.guilds[guild.id] = settings;
  saveDatabase();

  await removeOldPanels(panelChannel);
  await panelChannel.send(createPanelMessage());

  return settings;
}

/* =========================================================
   SLASH KOMUTLARI
========================================================= */

export const staffSystemCommands = [
  new SlashCommandBuilder()
    .setName("yetkili-panel")
    .setDescription("Yetkili mesai sistemini kurar ve paneli gönderir.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild,
    ),
];

/* =========================================================
   YETKİLİ KONTROLÜ
========================================================= */

async function requireStaff(
  interaction: ButtonInteraction,
): Promise<StaffCheckResult | null> {
  const guild = interaction.guild;

  if (!guild || !interaction.guildId) {
    await interaction.editReply(
      "❌ Bu işlem yalnızca bir sunucuda kullanılabilir.",
    );
    return null;
  }

  const settings = database.guilds[interaction.guildId];

  if (!settings) {
    await interaction.editReply(
      "❌ Yetkili sistemi kurulu değil. Bir yönetici `/kurulum` komutunu kullanmalı.",
    );
    return null;
  }

  const member = await guild.members
    .fetch(interaction.user.id)
    .catch(() => null);

  if (!member) {
    await interaction.editReply(
      "❌ Sunucudaki üyelik bilgin alınamadı.",
    );
    return null;
  }

  if (!member.roles.cache.has(settings.staffRoleId)) {
    await interaction.editReply(
      "❌ Bu butonu kullanmak için Yetkili rolüne sahip olmalısın.",
    );
    return null;
  }

  return { member, settings };
}

async function getLogChannel(
  guild: Guild,
  settings: GuildStaffSettings,
): Promise<TextChannel | null> {
  const channel = await guild.channels
    .fetch(settings.logChannelId)
    .catch(() => null);

  return channel?.type === ChannelType.GuildText
    ? channel
    : null;
}

/* =========================================================
   MESAİYE GİR
========================================================= */

async function handleEnterDuty(
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
    await interaction.editReply(
      "❌ Görevde rolü bulunamadı. `/kurulum` komutunu tekrar kullan.",
    );
    return;
  }

  if (!dutyRole.editable) {
    await interaction.editReply(
      "❌ Bot Görevde rolünü yönetemiyor. Bot rolünü Görevde rolünün üzerine taşı.",
    );
    return;
  }

  if (member.roles.cache.has(dutyRole.id)) {
    const currentNumber = settings.activeNumbers[member.id];

    await interaction.editReply(
      currentNumber
        ? `ℹ️ Zaten mesaidesin. Mesai numaran: **${currentNumber}**`
        : "ℹ️ Zaten mesaidesin.",
    );
    return;
  }

  const number = getLowestAvailableNumber(settings);
  const nickname = createDutyNickname(number, member);

  try {
    await member.roles.add(
      dutyRole,
      `Yetkili mesaiye girdi. Numara: ${number}`,
    );
  } catch (error) {
    console.error("Görevde rolü verilemedi:", error);
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`❌ Görevde rolü verilemedi: ${message}`);
    return;
  }

  let nicknameChanged = false;

  if (member.manageable) {
    nicknameChanged = await member
      .setNickname(
        nickname,
        `Yetkili mesaiye girdi. Numara: ${number}`,
      )
      .then(() => true)
      .catch((error: unknown) => {
        console.warn("Takma ad değiştirilemedi:", error);
        return false;
      });
  }

  const startedAt = Date.now();

  settings.activeNumbers[member.id] = number;
  settings.dutyStartedAt[member.id] = startedAt;
  saveDatabase();

  const logChannel = await getLogChannel(
    interaction.guild,
    settings,
  );

  if (logChannel) {
    const logEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("🟢 Mesaiye Giriş")
      .addFields(
        {
          name: "Yetkili",
          value: `${member}`,
          inline: true,
        },
        {
          name: "Mesai numarası",
          value: String(number),
          inline: true,
        },
        {
          name: "Başlangıç",
          value: `<t:${Math.floor(startedAt / 1_000)}:F>`,
        },
      )
      .setTimestamp();

    await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
  }

  await interaction.editReply(
    [
      "✅ Mesaiye başarıyla girdin.",
      `🔢 Mesai numaran: **${number}**`,
      nicknameChanged
        ? `👤 Yeni ismin: **${nickname}**`
        : "⚠️ Rolün verildi ancak Discord rol sırası nedeniyle ismin değiştirilemedi.",
    ].join("\n"),
  );
}

/* =========================================================
   MESAİDEN ÇIK
========================================================= */

async function handleExitDuty(
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
    await interaction.editReply(
      "❌ Görevde rolü bulunamadı. `/kurulum` komutunu tekrar kullan.",
    );
    return;
  }

  if (!member.roles.cache.has(dutyRole.id)) {
    await interaction.editReply(
      "ℹ️ Şu anda mesaide değilsin.",
    );
    return;
  }

  const number =
    settings.activeNumbers[member.id] ??
    Number.parseInt(
      (
        member.nickname ??
        member.user.globalName ??
        member.user.username
      ).match(DUTY_PREFIX_REGEX)?.[1] ?? "",
      10,
    );

  const startedAt = settings.dutyStartedAt[member.id];
  const endedAt = Date.now();
  const duration = startedAt
    ? formatDuration(endedAt - startedAt)
    : "Bilinmiyor";

  const currentName =
    member.nickname ??
    member.user.globalName ??
    member.user.username;

  const cleanName = cleanNickname(currentName).slice(0, 32);

  try {
    await member.roles.remove(
      dutyRole,
      "Yetkili mesaiden çıktı.",
    );
  } catch (error) {
    console.error("Görevde rolü kaldırılamadı:", error);
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`❌ Görevde rolü kaldırılamadı: ${message}`);
    return;
  }

  let nicknameChanged = false;

  if (member.manageable) {
    nicknameChanged = await member
      .setNickname(cleanName, "Yetkili mesaiden çıktı.")
      .then(() => true)
      .catch((error: unknown) => {
        console.warn("Takma ad geri yüklenemedi:", error);
        return false;
      });
  }

  delete settings.activeNumbers[member.id];
  delete settings.dutyStartedAt[member.id];
  saveDatabase();

  const logChannel = await getLogChannel(
    interaction.guild,
    settings,
  );

  if (logChannel) {
    const logEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("🔴 Mesaiden Çıkış")
      .addFields(
        {
          name: "Yetkili",
          value: `${member}`,
          inline: true,
        },
        {
          name: "Boşalan numara",
          value: Number.isSafeInteger(number)
            ? String(number)
            : "Bilinmiyor",
          inline: true,
        },
        {
          name: "Toplam mesai",
          value: duration,
        },
        {
          name: "Çıkış",
          value: `<t:${Math.floor(endedAt / 1_000)}:F>`,
        },
      )
      .setTimestamp();

    await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
  }

  await interaction.editReply(
    [
      "✅ Mesaiden başarıyla çıktın.",
      `⏱️ Toplam mesai süren: **${duration}**`,
      Number.isSafeInteger(number)
        ? `🔢 **${number}** numarası artık yeniden kullanılabilir.`
        : "🔢 Mesai numarası kaldırıldı.",
      nicknameChanged
        ? "👤 Mesai işareti ve numarası isminden kaldırıldı."
        : "⚠️ Rol kaldırıldı ancak Discord rol sırası nedeniyle ismin değiştirilemedi.",
    ].join("\n"),
  );
}

/* =========================================================
   PANEL KOMUTU
========================================================= */

async function handlePanelCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (
    !interaction.inGuild() ||
    !interaction.guild ||
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content:
        "❌ Bu komutu kullanmak için Sunucuyu Yönet yetkisine sahip olmalısın.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const settings = await ensureStaffSystemSetup(
      interaction.guild,
    );

    await interaction.editReply(
      [
        "✅ Yetkili mesai sistemi hazırlandı.",
        `📍 Panel: <#${settings.panelChannelId}>`,
        `📜 Log: <#${settings.logChannelId}>`,
      ].join("\n"),
    );
  } catch (error) {
    console.error("Yetkili mesai sistemi kurulamadı:", error);

    const errorMessage =
      error instanceof Error
        ? error.message
        : "Bilinmeyen bir hata oluştu.";

    await interaction.editReply(
      `❌ Kurulum başarısız oldu: ${errorMessage}`,
    );
  }
}

/* =========================================================
   ETKİLEŞİM YÖNETİCİSİ
========================================================= */

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

  if (interaction.customId === ENTER_DUTY_BUTTON_ID) {
    try {
      await handleEnterDuty(interaction);
    } catch (error) {
      console.error("Mesaiye girişte beklenmeyen hata:", error);
      const message = error instanceof Error ? error.message : String(error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`❌ Mesaiye giriş hatası: ${message}`).catch(() => null);
      } else {
        await interaction.reply({ content: `❌ Mesaiye giriş hatası: ${message}`, ephemeral: true }).catch(() => null);
      }
    }
    return true;
  }

  if (interaction.customId === EXIT_DUTY_BUTTON_ID) {
    try {
      await handleExitDuty(interaction);
    } catch (error) {
      console.error("Mesaiden çıkışta beklenmeyen hata:", error);
      const message = error instanceof Error ? error.message : String(error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`❌ Mesaiden çıkış hatası: ${message}`).catch(() => null);
      } else {
        await interaction.reply({ content: `❌ Mesaiden çıkış hatası: ${message}`, ephemeral: true }).catch(() => null);
      }
    }
    return true;
  }

  return false;
}
