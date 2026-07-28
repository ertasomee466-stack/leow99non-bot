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
  nextNumber: number;
  numbers: Record<string, number>;
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

const NUMBER_BUTTON_ID = "staff:number";
const DUTY_BUTTON_ID = "staff:duty";

/* =========================================================
   VERİTABANI
========================================================= */

function loadDatabase(): StaffDatabase {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {
        guilds: {},
      };
    }

    const content = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(content) as Partial<StaffDatabase>;

    return {
      guilds: parsed.guilds ?? {},
    };
  } catch (error) {
    console.error("Yetkili sistemi veritabanı okunamadı:", error);

    return {
      guilds: {},
    };
  }
}

function saveDatabase(): void {
  try {
    fs.mkdirSync(DATA_DIRECTORY, {
      recursive: true,
    });

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
  const cleaned = name
    .replace(/^\[\d+\]\s*-\s*/u, "")
    .trim();

  return cleaned || "Yetkili";
}

function createNickname(
  number: number,
  member: GuildMember,
): string {
  const currentName =
    member.nickname ??
    member.user.globalName ??
    member.user.username;

  const prefix = `[${number}] - `;
  const cleanName = cleanNickname(currentName);

  // Discord takma adı en fazla 32 karakter olabilir.
  const availableLength = Math.max(1, 32 - prefix.length);

  return `${prefix}${cleanName.slice(0, availableLength)}`;
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
    reason: "Yetkili sistemi kurulumu",
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
    reason: "Yetkili sistemi kurulumu",
  });
}

async function findOrCreatePanelChannel(
  guild: Guild,
  staffRole: Role,
  category: CategoryChannel,
): Promise<TextChannel> {
  await guild.channels.fetch();

  const existingChannel = guild.channels.cache.find(
    (channel): channel is TextChannel =>
      channel.type === ChannelType.GuildText &&
      channel.name === PANEL_CHANNEL_NAME,
  );

  if (existingChannel) {
    return existingChannel;
  }

  return guild.channels.create({
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

/* =========================================================
   PANEL
========================================================= */

function createPanelMessage() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Yetkili İşlem Paneli")
    .setDescription(
      [
        "Aşağıdaki butonları kullanarak işlem yapabilirsin.",
        "",
        "🔢 **Numaramı Al**",
        "Sana sıradaki yetkili numarasını verir ve ismini düzenler.",
        "",
        "📋 **Görev Al / Bırak**",
        "Görevde rolünü verir. Tekrar bastığında rolünü kaldırır.",
      ].join("\n"),
    )
    .setFooter({
      text: "Her yetkili yalnızca bir numara alabilir.",
    })
    .setTimestamp();

  const buttons =
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(NUMBER_BUTTON_ID)
        .setLabel("Numaramı Al")
        .setEmoji("🔢")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(DUTY_BUTTON_ID)
        .setLabel("Görev Al / Bırak")
        .setEmoji("📋")
        .setStyle(ButtonStyle.Primary),
    );

  return {
    embeds: [embed],
    components: [buttons],
  };
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

  if (
    !botMember.permissions.has(PermissionFlagsBits.ManageRoles)
  ) {
    throw new Error("Botta Rolleri Yönet yetkisi bulunmuyor.");
  }

  if (
    !botMember.permissions.has(PermissionFlagsBits.ManageChannels)
  ) {
    throw new Error("Botta Kanalları Yönet yetkisi bulunmuyor.");
  }

  if (
    !botMember.permissions.has(PermissionFlagsBits.ManageNicknames)
  ) {
    throw new Error(
      "Botta Takma Adları Yönet yetkisi bulunmuyor.",
    );
  }

  const staffRole = await findOrCreateRole(
    guild,
    STAFF_ROLE_NAME,
  );

  const dutyRole = await findOrCreateRole(
    guild,
    DUTY_ROLE_NAME,
  );

  const category = await findOrCreateCategory(
    guild,
    staffRole,
  );

  const panelChannel = await findOrCreatePanelChannel(
    guild,
    staffRole,
    category,
  );

  const previousSettings = database.guilds[guild.id];

  const settings: GuildStaffSettings = {
    staffRoleId: staffRole.id,
    dutyRoleId: dutyRole.id,
    panelChannelId: panelChannel.id,
    nextNumber: previousSettings?.nextNumber ?? 1,
    numbers: previousSettings?.numbers ?? {},
  };

  database.guilds[guild.id] = settings;
  saveDatabase();

  // TextChannel olduğu kesin olduğu için send hatası oluşmaz.
  await panelChannel.send(createPanelMessage());

  return settings;
}

/* =========================================================
   SLASH KOMUTLARI
========================================================= */

export const staffSystemCommands = [
  new SlashCommandBuilder()
    .setName("yetkili-panel")
    .setDescription("Yetkili sistemini kurar ve paneli gönderir.")
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
      "❌ Yetkili sistemi kurulu değil. Bir yönetici `/yetkili-panel` komutunu kullanmalı.",
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

  return {
    member,
    settings,
  };
}

/* =========================================================
   NUMARAMI AL BUTONU
========================================================= */

async function handleNumberButton(
  interaction: ButtonInteraction,
): Promise<void> {
  await interaction.deferReply({
    ephemeral: true,
  });

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
        "❌ Bot senin takma adını değiştiremiyor.",
        "",
        "Botun rolünü Yetkili rolünün ve senin en yüksek rolünün üzerine taşı.",
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
    console.error("Yetkili takma adı değiştirilemedi:", error);

    await interaction.editReply(
      "❌ Takma adın değiştirilemedi. Bot rolünün yeterince yukarıda olduğundan emin ol.",
    );

    return;
  }

  settings.numbers[member.id] = number;
  settings.nextNumber += 1;

  saveDatabase();

  await interaction.editReply(
    [
      "✅ Yetkili numaran başarıyla verildi.",
      `🔢 Numaran: **${number}**`,
      `👤 Yeni ismin: **${nickname}**`,
    ].join("\n"),
  );
}

/* =========================================================
   GÖREV AL / BIRAK BUTONU
========================================================= */

async function handleDutyButton(
  interaction: ButtonInteraction,
): Promise<void> {
  await interaction.deferReply({
    ephemeral: true,
  });

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
      "❌ Görevde rolü bulunamadı. `/yetkili-panel` komutunu tekrar kullan.",
    );

    return;
  }

  if (!dutyRole.editable) {
    await interaction.editReply(
      "❌ Bot Görevde rolünü yönetemiyor. Bot rolünü Görevde rolünün üzerine taşı.",
    );

    return;
  }

  try {
    if (member.roles.cache.has(dutyRole.id)) {
      await member.roles.remove(
        dutyRole,
        "Yetkili görevden çıktı.",
      );

      await interaction.editReply(
        "✅ Görevden çıktın. Görevde rolün kaldırıldı.",
      );

      return;
    }

    await member.roles.add(
      dutyRole,
      "Yetkili göreve başladı.",
    );

    await interaction.editReply(
      "✅ Göreve başladın. Görevde rolün verildi.",
    );
  } catch (error) {
    console.error("Görev rolü işlemi başarısız:", error);

    await interaction.editReply(
      "❌ Görev rolü işlemi yapılamadı. Botun rol ve yetkilerini kontrol et.",
    );
  }
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

  await interaction.deferReply({
    ephemeral: true,
  });

  try {
    const settings = await ensureStaffSystemSetup(
      interaction.guild,
    );

    await interaction.editReply(
      `✅ Yetkili sistemi hazırlandı.\n📍 Panel: <#${settings.panelChannelId}>`,
    );
  } catch (error) {
    console.error("Yetkili sistemi kurulamadı:", error);

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

  if (interaction.customId === NUMBER_BUTTON_ID) {
    await handleNumberButton(interaction);
    return true;
  }

  if (interaction.customId === DUTY_BUTTON_ID) {
    await handleDutyButton(interaction);
    return true;
  }

  return false;
}