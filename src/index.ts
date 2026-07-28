import "dotenv/config";

import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ColorResolvable,
  type Interaction,
} from "discord.js";

import {
  addCustomCommand,
  addExemptRole,
  addExemptUser,
  database,
  getCustomCommand,
  getExemptRoleIds,
  getExemptUserIds,
  getVoiceModerationSettings,
  getWarningCount,
  removeCustomCommand,
  removeExemptRole,
  removeExemptUser,
  resetWarnings,
  setVoiceModerationSettings,
  type CustomCommand,
} from "./database.js";

import { initializeOwnerFollow } from "./ownerFollow.js";
import { ensureCommunitySetup, initializeCommunityFeatures } from "./communityFeatures.js";
import {
  ensureStaffSystemSetup,
  handleStaffSystemInteraction,
  staffSystemCommands,
} from "./staffSystem.js";

/* =========================================================
   ORTAM DEĞİŞKENLERİ
========================================================= */

function requireEnvironmentValue(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();

    if (value) {
      return value;
    }
  }

  throw new Error(
    `${names.join(" veya ")} bulunamadı. .env dosyasını kontrol et.`,
  );
}

const token: string = requireEnvironmentValue(
  "DISCORD_TOKEN",
  "TOKEN",
);

const clientId: string = requireEnvironmentValue(
  "CLIENT_ID",
);

const guildId: string | undefined =
  process.env.GUILD_ID?.trim() || undefined;

/* =========================================================
   DISCORD CLIENT
========================================================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

/* =========================================================
   YERLEŞİK KOMUTLAR
========================================================= */

const reservedCommandNames = new Set<string>([
  "ping",
  "yardim",
  "ses-cezasi",
  "uyari-goster",
  "uyari-sifirla",
  "uyari-limit",
  "muaf-rol-ekle",
  "muaf-rol-sil",
  "muaf-kullanici-ekle",
  "muaf-kullanici-sil",
  "muaf-liste",
  "komut-ekle",
  "komut-sil",
  "komut-listesi",
  "kurulum",
  "yetkili-panel",
]);

function normalizeCommandName(commandName: string): string {
  return commandName
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ç", "c")
    .replaceAll("ğ", "g")
    .replaceAll("ı", "i")
    .replaceAll("ö", "o")
    .replaceAll("ş", "s")
    .replaceAll("ü", "u")
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function isValidCommandName(commandName: string): boolean {
  return /^[a-z0-9_-]{1,32}$/.test(commandName);
}

/* =========================================================
   SLASH KOMUTLARINI OLUŞTUR
========================================================= */

function createBaseCommands() {
  const pingCommand = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Botun bağlantı gecikmesini gösterir.");

  const helpCommand = new SlashCommandBuilder()
    .setName("yardim")
    .setDescription("Botun kullanılabilir komutlarını gösterir.");

  const voiceModerationCommand = new SlashCommandBuilder()
    .setName("ses-cezasi")
    .setDescription("Ses moderasyonu ayarlarını değiştirir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((option) =>
      option
        .setName("durum")
        .setDescription("Ses moderasyonu açık olsun mu?")
        .setRequired(false),
    )
    .addNumberOption((option) =>
      option
        .setName("minimum_guven")
        .setDescription("Minimum Vosk güven oranı. Örnek: 0.80")
        .setMinValue(0)
        .setMaxValue(1)
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("zaman_asimi")
        .setDescription("Timeout süresi, dakika olarak.")
        .setMinValue(1)
        .setMaxValue(40_320)
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("uyari_limiti")
        .setDescription("Kaç uyarıdan sonra timeout uygulansın?")
        .setMinValue(1)
        .setMaxValue(20)
        .setRequired(false),
    );

  const showWarningCommand = new SlashCommandBuilder()
    .setName("uyari-goster")
    .setDescription("Bir kullanıcının uyarı sayısını gösterir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option
        .setName("kullanici")
        .setDescription("Uyarısı gösterilecek kullanıcı.")
        .setRequired(true),
    );

  const resetWarningCommand = new SlashCommandBuilder()
    .setName("uyari-sifirla")
    .setDescription("Bir kullanıcının uyarılarını sıfırlar.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option
        .setName("kullanici")
        .setDescription("Uyarıları sıfırlanacak kullanıcı.")
        .setRequired(true),
    );

  const warningLimitCommand = new SlashCommandBuilder()
    .setName("uyari-limit")
    .setDescription("Ses moderasyonu uyarı limitini değiştirir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("Timeout uygulanmadan önceki uyarı limiti.")
        .setMinValue(1)
        .setMaxValue(20)
        .setRequired(true),
    );

  const addExemptRoleCommand = new SlashCommandBuilder()
    .setName("muaf-rol-ekle")
    .setDescription("Ses moderasyonundan muaf rol ekler.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption((option) =>
      option
        .setName("rol")
        .setDescription("Muaf tutulacak rol.")
        .setRequired(true),
    );

  const removeExemptRoleCommand = new SlashCommandBuilder()
    .setName("muaf-rol-sil")
    .setDescription("Bir rolün ses moderasyonu muafiyetini kaldırır.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption((option) =>
      option
        .setName("rol")
        .setDescription("Muafiyeti kaldırılacak rol.")
        .setRequired(true),
    );

  const addExemptUserCommand = new SlashCommandBuilder()
    .setName("muaf-kullanici-ekle")
    .setDescription("Ses moderasyonundan muaf kullanıcı ekler.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option
        .setName("kullanici")
        .setDescription("Muaf tutulacak kullanıcı.")
        .setRequired(true),
    );

  const removeExemptUserCommand = new SlashCommandBuilder()
    .setName("muaf-kullanici-sil")
    .setDescription("Bir kullanıcının moderasyon muafiyetini kaldırır.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option
        .setName("kullanici")
        .setDescription("Muafiyeti kaldırılacak kullanıcı.")
        .setRequired(true),
    );

  const exemptionListCommand = new SlashCommandBuilder()
    .setName("muaf-liste")
    .setDescription("Muaf kullanıcı ve rolleri gösterir.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  const addCommand = new SlashCommandBuilder()
    .setName("komut-ekle")
    .setDescription("Metin, embed veya butonlu özel slash komutu ekler.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName("isim")
        .setDescription("Oluşturulacak komutun ismi.")
        .setMinLength(1)
        .setMaxLength(32)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("tur")
        .setDescription("Komutun cevap biçimi.")
        .setRequired(true)
        .addChoices(
          { name: "Metin", value: "text" },
          { name: "Embed", value: "embed" },
          { name: "Butonlu Embed", value: "button" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("cevap")
        .setDescription("Metin komutunun cevabı.")
        .setMaxLength(2_000),
    )
    .addStringOption((option) =>
      option
        .setName("baslik")
        .setDescription("Embed başlığı.")
        .setMaxLength(256),
    )
    .addStringOption((option) =>
      option
        .setName("aciklama")
        .setDescription("Embed açıklaması.")
        .setMaxLength(4_000),
    )
    .addStringOption((option) =>
      option
        .setName("renk")
        .setDescription("Embed rengi: mor, mavi, kırmızı veya #5865F2."),
    )
    .addStringOption((option) =>
      option
        .setName("buton-yazisi")
        .setDescription("Butonun üzerinde görünecek yazı.")
        .setMaxLength(80),
    )
    .addStringOption((option) =>
      option
        .setName("buton-linki")
        .setDescription("Butonun açacağı https:// bağlantısı."),
    )
    .addStringOption((option) =>
      option
        .setName("resim")
        .setDescription("Embed büyük resim bağlantısı (https://)."),
    )
    .addStringOption((option) =>
      option
        .setName("kucuk-resim")
        .setDescription("Embed küçük resim bağlantısı (https://)."),
    )
    .addStringOption((option) =>
      option
        .setName("alt-yazi")
        .setDescription("Embed alt yazısı.")
        .setMaxLength(2_048),
    );

  const removeCommand = new SlashCommandBuilder()
    .setName("komut-sil")
    .setDescription("Özel bir slash komutunu siler.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName("isim")
        .setDescription("Silinecek özel komutun ismi.")
        .setMinLength(1)
        .setMaxLength(32)
        .setRequired(true),
    );

  const commandList = new SlashCommandBuilder()
    .setName("komut-listesi")
    .setDescription("Kayıtlı özel komutları gösterir.");

  const setupCommand = new SlashCommandBuilder()
    .setName("kurulum")
    .setDescription("Kayıt ve geçici oda sistemini bu sunucuda kurar veya onarır.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  return [
    pingCommand,
    helpCommand,
    voiceModerationCommand,
    showWarningCommand,
    resetWarningCommand,
    warningLimitCommand,
    addExemptRoleCommand,
    removeExemptRoleCommand,
    addExemptUserCommand,
    removeExemptUserCommand,
    exemptionListCommand,
    addCommand,
    removeCommand,
    commandList,
    setupCommand,
  ];
}

function createCustomCommands(): SlashCommandBuilder[] {
  const commands: SlashCommandBuilder[] = [];

  for (const storedCommandName of Object.keys(database.customCommands)) {
    const commandName = normalizeCommandName(storedCommandName);

    if (!isValidCommandName(commandName)) {
      console.warn(`⚠️ Geçersiz özel komut atlandı: ${storedCommandName}`);
      continue;
    }

    if (reservedCommandNames.has(commandName)) {
      console.warn(`⚠️ Yerleşik komut ismi atlandı: ${commandName}`);
      continue;
    }

    commands.push(
      new SlashCommandBuilder()
        .setName(commandName)
        .setDescription(`Özel komut: /${commandName}`),
    );
  }

  return commands;
}

function createRestClient(): REST {
  return new REST({ version: "10" }).setToken(token);
}

function getCommandData() {
  return [
    ...createBaseCommands(),
    ...createCustomCommands(),
    ...staffSystemCommands,
  ].map((command) => command.toJSON());
}

async function registerCommands(): Promise<void> {
  const rest = createRestClient();
  const commandData = getCommandData();

  // GUILD_ID doluysa komutlar yalnızca o sunucuya kaydedilir.
  // GUILD_ID boşsa komutlar bütün sunucular için global kaydedilir.
  if (guildId) {
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commandData },
    );

    console.log(
      `✅ ${commandData.length} slash komutu ${guildId} sunucusuna kaydedildi.`,
    );
    return;
  }

  await rest.put(
    Routes.applicationCommands(clientId),
    { body: commandData },
  );

  console.log(`✅ ${commandData.length} global slash komutu kaydedildi.`);
}

async function clearLegacyGuildCommands(): Promise<void> {
  // Global modda eski sunucuya özel komutlar, global komutlarla beraber
  // iki kez görünebilir. Botun bulunduğu her sunucudaki eski guild
  // kayıtlarını temizleyerek yalnızca global komutları bırakıyoruz.
  if (guildId) {
    return;
  }

  const rest = createRestClient();

  for (const guild of client.guilds.cache.values()) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(clientId, guild.id),
        { body: [] },
      );
      console.log(`🧹 Eski sunucu komutları temizlendi: ${guild.name}`);
    } catch (error) {
      console.error(
        `❌ ${guild.name} sunucusundaki eski komutlar temizlenemedi:`,
        error,
      );
    }
  }
}

/* =========================================================
   ORTAK YETKİ KONTROLÜ
========================================================= */

async function requireManageGuild(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "❌ Bu komut yalnızca bir sunucuda kullanılabilir.",
      ephemeral: true,
    });

    return false;
  }

  const hasPermission =
    interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    ) ?? false;

  if (!hasPermission) {
    await interaction.reply({
      content:
        "❌ Bu komutu kullanmak için Sunucuyu Yönet yetkisine sahip olmalısın.",
      ephemeral: true,
    });

    return false;
  }

  return true;
}

/* =========================================================
   KOMUT İŞLEYİCİLERİ
========================================================= */

async function handlePingCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sentMessage = await interaction.reply({
    content: "🏓 Gecikme hesaplanıyor...",
    fetchReply: true,
  });

  const apiLatency =
    sentMessage.createdTimestamp - interaction.createdTimestamp;

  const websocketLatency = Math.round(interaction.client.ws.ping);

  await interaction.editReply(
    [
      "🏓 **Pong!**",
      "",
      `API gecikmesi: **${apiLatency} ms**`,
      `WebSocket gecikmesi: **${websocketLatency} ms**`,
    ].join("\n"),
  );
}

async function handleHelpCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const customCommandNames = Object.keys(database.customCommands);

  const customCommandText =
    customCommandNames.length > 0
      ? customCommandNames.map((name) => `/${name}`).join(", ")
      : "Henüz özel komut bulunmuyor.";

  await interaction.reply({
    content: [
      "🤖 **Bot komutları**",
      "",
      "`/ping` — Bot gecikmesini gösterir.",
      "`/yardim` — Yardım menüsünü gösterir.",
      "`/ses-cezasi` — Ses moderasyonunu ayarlar.",
      "`/uyari-goster` — Kullanıcının uyarılarını gösterir.",
      "`/uyari-sifirla` — Kullanıcının uyarılarını sıfırlar.",
      "`/uyari-limit` — Timeout öncesi uyarı limitini değiştirir.",
      "`/muaf-rol-ekle` — Muaf rol ekler.",
      "`/muaf-rol-sil` — Muaf rolü kaldırır.",
      "`/muaf-kullanici-ekle` — Muaf kullanıcı ekler.",
      "`/muaf-kullanici-sil` — Kullanıcı muafiyetini kaldırır.",
      "`/muaf-liste` — Muafiyet listesini gösterir.",
      "`/komut-ekle` — Özel komut oluşturur.",
      "`/komut-sil` — Özel komutu siler.",
      "`/komut-listesi` — Özel komutları gösterir.",
      "",
      "**Özel komutlar**",
      customCommandText,
    ].join("\n"),
    ephemeral: true,
  });
}

async function handleVoiceModerationCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) {
    return;
  }

  const interactionGuildId = interaction.guildId;

  if (!interactionGuildId) {
    await interaction.reply({
      content: "❌ Sunucu bilgisi alınamadı.",
      ephemeral: true,
    });
    return;
  }

  const currentSettings =
    getVoiceModerationSettings(interactionGuildId);

  const enabled =
    interaction.options.getBoolean("durum", false) ??
    currentSettings.enabled;

  const minimumConfidence =
    interaction.options.getNumber("minimum_guven", false) ??
    currentSettings.minimumConfidence;

  const timeoutMinutes =
    interaction.options.getInteger("zaman_asimi", false) ??
    currentSettings.timeoutMinutes;

  const warningLimit =
    interaction.options.getInteger("uyari_limiti", false) ??
    currentSettings.warningLimit;

  setVoiceModerationSettings(interactionGuildId, {
    enabled,
    minimumConfidence,
    timeoutMinutes,
    warningLimit,
  });

  await interaction.reply({
    content: [
      "✅ **Ses moderasyonu ayarları kaydedildi.**",
      "",
      `Durum: **${enabled ? "Aktif" : "Kapalı"}**`,
      `Minimum güven: **${minimumConfidence.toFixed(2)}**`,
      `Timeout süresi: **${timeoutMinutes} dakika**`,
      `Uyarı limiti: **${warningLimit}**`,
      "",
      "Bot, sunucu sahibinin bulunduğu ses kanalını takip eder.",
    ].join("\n"),
    ephemeral: true,
  });
}

async function handleShowWarningCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) {
    return;
  }

  const interactionGuildId = interaction.guildId;

  if (!interactionGuildId) {
    return;
  }

  const user = interaction.options.getUser("kullanici", true);
  const settings = getVoiceModerationSettings(interactionGuildId);
  const warningCount = getWarningCount(interactionGuildId, user.id);

  await interaction.reply({
    content: [
      `⚠️ **${user.tag} uyarı bilgisi**`,
      "",
      `Uyarı sayısı: **${warningCount}/${settings.warningLimit}**`,
    ].join("\n"),
    ephemeral: true,
  });
}

async function handleResetWarningCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) {
    return;
  }

  const interactionGuildId = interaction.guildId;

  if (!interactionGuildId) {
    return;
  }

  const user = interaction.options.getUser("kullanici", true);
  const reset = resetWarnings(interactionGuildId, user.id);

  await interaction.reply({
    content: reset
      ? `✅ ${user} kullanıcısının uyarıları sıfırlandı.`
      : `ℹ️ ${user} kullanıcısının kayıtlı uyarısı bulunmuyor.`,
    ephemeral: true,
  });
}

async function handleWarningLimitCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) {
    return;
  }

  const interactionGuildId = interaction.guildId;

  if (!interactionGuildId) {
    return;
  }

  const limit = interaction.options.getInteger("limit", true);
  const currentSettings =
    getVoiceModerationSettings(interactionGuildId);

  setVoiceModerationSettings(interactionGuildId, {
    ...currentSettings,
    warningLimit: limit,
  });

  await interaction.reply({
    content: `✅ Uyarı limiti **${limit}** olarak ayarlandı.`,
    ephemeral: true,
  });
}

async function handleAddExemptRoleCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) {
    return;
  }

  const interactionGuildId = interaction.guildId;

  if (!interactionGuildId) {
    return;
  }

  const role = interaction.options.getRole("rol", true);
  const added = addExemptRole(interactionGuildId, role.id);

  await interaction.reply({
    content: added
      ? `✅ ${role} rolü ses moderasyonundan muaf tutuldu.`
      : `ℹ️ ${role} rolü zaten muaf listesinde.`,
    ephemeral: true,
  });
}

async function handleRemoveExemptRoleCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) {
    return;
  }

  const interactionGuildId = interaction.guildId;

  if (!interactionGuildId) {
    return;
  }

  const role = interaction.options.getRole("rol", true);
  const removed = removeExemptRole(interactionGuildId, role.id);

  await interaction.reply({
    content: removed
      ? `✅ ${role} rolünün muafiyeti kaldırıldı.`
      : `ℹ️ ${role} rolü muaf listesinde değil.`,
    ephemeral: true,
  });
}

async function handleAddExemptUserCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) {
    return;
  }

  const interactionGuildId = interaction.guildId;

  if (!interactionGuildId) {
    return;
  }

  const user = interaction.options.getUser("kullanici", true);
  const added = addExemptUser(interactionGuildId, user.id);

  await interaction.reply({
    content: added
      ? `✅ ${user} ses moderasyonundan muaf tutuldu.`
      : `ℹ️ ${user} zaten muaf listesinde.`,
    ephemeral: true,
  });
}

async function handleRemoveExemptUserCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) {
    return;
  }

  const interactionGuildId = interaction.guildId;

  if (!interactionGuildId) {
    return;
  }

  const user = interaction.options.getUser("kullanici", true);
  const removed = removeExemptUser(interactionGuildId, user.id);

  await interaction.reply({
    content: removed
      ? `✅ ${user} kullanıcısının muafiyeti kaldırıldı.`
      : `ℹ️ ${user} muaf listesinde değil.`,
    ephemeral: true,
  });
}

async function handleExemptionListCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) {
    return;
  }

  const interactionGuildId = interaction.guildId;

  if (!interactionGuildId) {
    return;
  }

  const roleIds = getExemptRoleIds(interactionGuildId);
  const userIds = getExemptUserIds(interactionGuildId);

  const roleText =
    roleIds.length > 0
      ? roleIds.map((roleId) => `<@&${roleId}>`).join("\n")
      : "Muaf rol bulunmuyor.";

  const userText =
    userIds.length > 0
      ? userIds.map((userId) => `<@${userId}>`).join("\n")
      : "Muaf kullanıcı bulunmuyor.";

  await interaction.reply({
    content: [
      "🛡️ **Moderasyon muafiyet listesi**",
      "",
      "**Muaf roller**",
      roleText,
      "",
      "**Muaf kullanıcılar**",
      userText,
    ].join("\n"),
    ephemeral: true,
  });
}

function isHttpUrl(value: string | null): value is string {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function resolveEmbedColor(value: string | null): ColorResolvable {
  const normalized = value?.trim().toLocaleLowerCase("tr-TR") ?? "";
  const namedColors: Record<string, ColorResolvable> = {
    mor: "Purple",
    mavi: "Blue",
    kirmizi: "Red",
    kırmızı: "Red",
    yesil: "Green",
    yeşil: "Green",
    sari: "Yellow",
    sarı: "Yellow",
    turuncu: "Orange",
    pembe: "Fuchsia",
    siyah: "NotQuiteBlack",
    beyaz: "White",
  };

  if (namedColors[normalized]) return namedColors[normalized];
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized as ColorResolvable;
  return "Purple";
}

async function handleAddCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) return;

  const commandName = normalizeCommandName(
    interaction.options.getString("isim", true),
  );
  const type = interaction.options.getString("tur", true) as CustomCommand["type"];
  const response = interaction.options.getString("cevap")?.trim();
  const title = interaction.options.getString("baslik")?.trim();
  const description = interaction.options.getString("aciklama")?.trim();
  const color = interaction.options.getString("renk")?.trim();
  const buttonLabel = interaction.options.getString("buton-yazisi")?.trim();
  const buttonUrl = interaction.options.getString("buton-linki")?.trim();
  const imageUrl = interaction.options.getString("resim")?.trim();
  const thumbnailUrl = interaction.options.getString("kucuk-resim")?.trim();
  const footer = interaction.options.getString("alt-yazi")?.trim();

  if (!isValidCommandName(commandName)) {
    await interaction.reply({
      content: "❌ Geçersiz komut ismi. Küçük harf, sayı, tire veya alt çizgi kullan.",
      ephemeral: true,
    });
    return;
  }

  if (reservedCommandNames.has(commandName)) {
    await interaction.reply({
      content: "❌ Bu isim botun yerleşik komutlarından biridir.",
      ephemeral: true,
    });
    return;
  }

  if (type === "text" && !response) {
    await interaction.reply({ content: "❌ Metin türünde `cevap` alanı zorunludur.", ephemeral: true });
    return;
  }

  if ((type === "embed" || type === "button") && !title && !description) {
    await interaction.reply({
      content: "❌ Embed için en az `baslik` veya `aciklama` alanını doldur.",
      ephemeral: true,
    });
    return;
  }

  if (type === "button" && (!buttonLabel || !isHttpUrl(buttonUrl ?? null))) {
    await interaction.reply({
      content: "❌ Butonlu embed için `buton-yazisi` ve geçerli bir `buton-linki` zorunludur.",
      ephemeral: true,
    });
    return;
  }

  for (const [label, url] of [["resim", imageUrl], ["kucuk-resim", thumbnailUrl]] as const) {
    if (url && !isHttpUrl(url)) {
      await interaction.reply({ content: `❌ \`${label}\` alanı geçerli bir http/https bağlantısı olmalı.`, ephemeral: true });
      return;
    }
  }

  const command: CustomCommand = {
    type,
    response: type === "text" ? response : undefined,
    title,
    description,
    color,
    buttonLabel: type === "button" ? buttonLabel : undefined,
    buttonUrl: type === "button" ? buttonUrl : undefined,
    imageUrl,
    thumbnailUrl,
    footer,
  };

  const commandAlreadyExists = getCustomCommand(commandName) !== undefined;
  addCustomCommand(commandName, command);
  await interaction.deferReply({ ephemeral: true });

  try {
    await registerCommands();
    await interaction.editReply([
      commandAlreadyExists ? "✅ Özel komut güncellendi." : "✅ Özel komut oluşturuldu.",
      `Komut: **/${commandName}**`,
      `Tür: **${type === "text" ? "Metin" : type === "embed" ? "Embed" : "Butonlu Embed"}**`,
    ].join("\n"));
  } catch (error) {
    console.error("❌ Özel komut Discord'a kaydedilemedi:", error);
    await interaction.editReply("⚠️ Komut veritabanına kaydedildi ancak Discord komut listesi güncellenemedi.");
  }
}

async function handleRemoveCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireManageGuild(interaction))) {
    return;
  }

  const commandName = normalizeCommandName(
    interaction.options.getString("isim", true),
  );

  if (reservedCommandNames.has(commandName)) {
    await interaction.reply({
      content: "❌ Yerleşik bot komutları silinemez.",
      ephemeral: true,
    });
    return;
  }

  const removed = removeCustomCommand(commandName);

  if (!removed) {
    await interaction.reply({
      content: `❌ **/${commandName}** isimli özel komut bulunamadı.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    await registerCommands();
    await interaction.editReply(
      `✅ **/${commandName}** özel komutu silindi.`,
    );
  } catch (error) {
    console.error("❌ Discord komut listesi güncellenemedi:", error);

    await interaction.editReply(
      [
        "⚠️ Komut veritabanından silindi.",
        "Discord komut listesi şu anda güncellenemedi.",
      ].join("\n"),
    );
  }
}

async function handleCommandList(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const commands = Object.entries(database.customCommands);

  if (commands.length === 0) {
    await interaction.reply({ content: "📭 Kayıtlı özel komut bulunmuyor.", ephemeral: true });
    return;
  }

  const commandLines = commands.map(([commandName, command], index) => {
    const typeLabel = command.type === "text" ? "Metin" : command.type === "embed" ? "Embed" : "Butonlu Embed";
    const preview = command.response ?? command.description ?? command.title ?? "İçerik yok";
    const shortened = preview.length > 80 ? `${preview.slice(0, 77)}...` : preview;
    return `${index + 1}. **/${commandName}** · ${typeLabel} — ${shortened}`;
  });

  await interaction.reply({
    content: [`📋 **Özel komutlar (${commands.length})**`, "", ...commandLines].join("\n").slice(0, 2_000),
    ephemeral: true,
  });
}

async function handleCustomCommand(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const command = getCustomCommand(interaction.commandName);
  if (!command) return false;

  if (command.type === "text") {
    await interaction.reply({
      content: command.response ?? "⚠️ Bu komutun cevabı boş.",
      allowedMentions: { parse: [] },
    });
    return true;
  }

  const embed = new EmbedBuilder().setColor(resolveEmbedColor(command.color ?? null));
  if (command.title) embed.setTitle(command.title);
  if (command.description) embed.setDescription(command.description);
  if (command.imageUrl && isHttpUrl(command.imageUrl)) embed.setImage(command.imageUrl);
  if (command.thumbnailUrl && isHttpUrl(command.thumbnailUrl)) embed.setThumbnail(command.thumbnailUrl);
  if (command.footer) embed.setFooter({ text: command.footer });

  if (command.type === "button" && command.buttonLabel && command.buttonUrl && isHttpUrl(command.buttonUrl)) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel(command.buttonLabel)
        .setStyle(ButtonStyle.Link)
        .setURL(command.buttonUrl),
    );
    await interaction.reply({ embeds: [embed], components: [row] });
    return true;
  }

  await interaction.reply({ embeds: [embed] });
  return true;
}

async function handleSetupCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!(await requireManageGuild(interaction)) || !interaction.guild) return;

  await interaction.deferReply({ ephemeral: true });

  await ensureCommunitySetup(interaction.guild);
  const staffSettings = await ensureStaffSystemSetup(interaction.guild);

  await interaction.editReply(
    [
      "✅ Sunucu sistemleri kuruldu veya onarıldı.",
      "",
      `Yetkili paneli: <#${staffSettings.panelChannelId}>`,
      "Yetkililere oluşturulan **Yetkili** rolünü ver.",
    ].join("\n"),
  );
}

/* =========================================================
   INTERACTION YÖNETİCİSİ
========================================================= */

async function handleInteraction(
  interaction: Interaction,
): Promise<void> {
  if (await handleStaffSystemInteraction(interaction)) {
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  switch (interaction.commandName) {
    case "ping":
      await handlePingCommand(interaction);
      return;

    case "yardim":
      await handleHelpCommand(interaction);
      return;

    case "ses-cezasi":
      await handleVoiceModerationCommand(interaction);
      return;

    case "uyari-goster":
      await handleShowWarningCommand(interaction);
      return;

    case "uyari-sifirla":
      await handleResetWarningCommand(interaction);
      return;

    case "uyari-limit":
      await handleWarningLimitCommand(interaction);
      return;

    case "muaf-rol-ekle":
      await handleAddExemptRoleCommand(interaction);
      return;

    case "muaf-rol-sil":
      await handleRemoveExemptRoleCommand(interaction);
      return;

    case "muaf-kullanici-ekle":
      await handleAddExemptUserCommand(interaction);
      return;

    case "muaf-kullanici-sil":
      await handleRemoveExemptUserCommand(interaction);
      return;

    case "muaf-liste":
      await handleExemptionListCommand(interaction);
      return;

    case "komut-ekle":
      await handleAddCommand(interaction);
      return;

    case "komut-sil":
      await handleRemoveCommand(interaction);
      return;

    case "komut-listesi":
      await handleCommandList(interaction);
      return;

    case "kurulum":
      await handleSetupCommand(interaction);
      return;

    default: {
      const handled = await handleCustomCommand(interaction);

      if (!handled) {
        await interaction.reply({
          content: "❌ Bu komut veritabanında bulunamadı.",
          ephemeral: true,
        });
      }
    }
  }
}

/* =========================================================
   BOT OLAYLARI
========================================================= */

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ Bot giriş yaptı: ${readyClient.user.tag}`);
  console.log(`🏠 Sunucu sayısı: ${readyClient.guilds.cache.size}`);

  readyClient.user.setPresence({
    status: "online",
    activities: [
      {
        name: process.env.STREAM_NAME ?? "Sunucuyu koruyor",
        type: ActivityType.Streaming,
        url:
          process.env.STREAM_URL ??
          "https://www.twitch.tv/discord",
      },
    ],
  });
});


client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.inGuild()) return;

  const text = message.content.toLocaleLowerCase("tr-TR").trim();

  const replies: Record<string, string> = {
    "sa":"as",
    "selam":"as",
    "slm":"as",
    "ali":"italiy",
    "m?z":"meyra zana",
    "napıyon":"iyiyim sen",
    "nbr":"iyidir senden",
    "nasılsın":"iyiyim sen",
    "iyi misin":"iyiyim 😄",
    "günaydın":"günaydın ❤️",
    "iyi geceler":"iyi geceler 🌙",
    "bb":"görüşürüz 👋",
    "bye":"kendine iyi bak 👋",
    "efm":"efendim?",
    "bot":"buradayım 👀",
    "ping":"pong 🏓",
    "xd":"😂",
    "sj":"😄",
    "o7":"o7",
    "eyw":"rica ederim ❤️",
    "tşk":"ne demek ❤️",
    "teşekkürler":"her zaman ❤️",
    "gel":"geliyorum 🏃",
    "31":"🤨",
    "aşk":"❤️",
    "kedi":"🐱",
    "köpek":"🐶",
  };

  for (const [word, reply] of Object.entries(replies)) {
    if (text.includes(word)) {
      await message.reply(reply).catch(console.error);
      break;
    }
  }
});

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction).catch(
    async (error: unknown) => {
      console.error("❌ Komut çalıştırılırken hata oluştu:", error);

      if (!interaction.isRepliable()) {
        return;
      }

      const errorContent =
        "❌ Komut çalıştırılırken beklenmeyen bir hata oluştu.";

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: errorContent,
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: errorContent,
            ephemeral: true,
          });
        }
      } catch (replyError) {
        console.error("❌ Hata mesajı gönderilemedi:", replyError);
      }
    },
  );
});

client.on(Events.Error, (error) => {
  console.error("❌ Discord client hatası:", error);
});

client.on(Events.Warn, (warning) => {
  console.warn("⚠️ Discord uyarısı:", warning);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Yakalanmamış Promise hatası:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Yakalanmamış uygulama hatası:", error);
});

/* =========================================================
   BOTU BAŞLAT
========================================================= */

async function startBot(): Promise<void> {
  console.log("🔄 Slash komutları kaydediliyor...");
  await registerCommands();

  initializeOwnerFollow(client);
  initializeCommunityFeatures(client);

  console.log("🔄 Discord'a giriş yapılıyor...");
  await client.login(token);

  // Client hazır olduktan sonra sunucu önbelleği dolmuş olur.
  // Global kullanımda geçmişten kalan çift komut kayıtlarını temizler.
  await clearLegacyGuildCommands();
}

void startBot().catch((error: unknown) => {
  console.error("❌ Bot başlatılamadı:", error);
  process.exitCode = 1;
});
