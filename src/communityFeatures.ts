import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CategoryChannel,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  TextChannel,
  VoiceChannel,
} from "discord.js";

const UNREGISTERED_ROLE_NAME = "Kayıtsız";
const MEMBER_ROLE_NAME = "Member";
const REGISTRATION_CATEGORY_NAME = "KAYIT";
const RULES_CHANNEL_NAME = "kurallar";
const REGISTER_CHANNEL_NAME = "kayıt-ol";
const WELCOME_CHANNEL_NAME = "hoş-geldin";
const TEMP_CATEGORY_NAME = "ÖZEL ODALAR";
const CREATE_ROOM_CHANNEL_NAME = "➕・oda-oluştur";
const ACCEPT_RULES_BUTTON_ID = "accept_server_rules";

const ROLE_SELECTION_CATEGORY_NAME = "ROL SEÇİM";
const ROLE_SELECTION_BUTTON_PREFIX = "role-select";
const MAX_ROLES_PER_SELECTION_GROUP = 2;

type RoleSelectionGroupKey = "iliski" | "burc" | "renk";

interface RoleSelectionItem {
  roleName: string;
  buttonLabel: string;
  emoji: string;
}

interface RoleSelectionGroup {
  key: RoleSelectionGroupKey;
  channelName: string;
  items: RoleSelectionItem[];
}

const ROLE_SELECTION_GROUPS: RoleSelectionGroup[] = [
  {
    key: "iliski",
    channelName: "ilişki-seçim",
    items: [
      {
        roleName: "Sevgili yapmıyorum🖤",
        buttonLabel: "Sevgili yapmıyorum",
        emoji: "🖤",
      },
      {
        roleName: "Sevgili Yapıyorum🤍",
        buttonLabel: "Sevgili Yapıyorum",
        emoji: "🤍",
      },
      {
        roleName: "Sapığım💔",
        buttonLabel: "Sapığım",
        emoji: "💔",
      },
    ],
  },
  {
    key: "burc",
    channelName: "burç-seçim",
    items: [
      { roleName: "♈ Koç", buttonLabel: "Koç", emoji: "♈" },
      { roleName: "♉ Boğa", buttonLabel: "Boğa", emoji: "♉" },
      { roleName: "♊ İkizler", buttonLabel: "İkizler", emoji: "♊" },
      { roleName: "♋ Yengeç", buttonLabel: "Yengeç", emoji: "♋" },
      { roleName: "♌ Aslan", buttonLabel: "Aslan", emoji: "♌" },
      { roleName: "♍ Başak", buttonLabel: "Başak", emoji: "♍" },
      { roleName: "♎ Terazi", buttonLabel: "Terazi", emoji: "♎" },
      { roleName: "♏ Akrep", buttonLabel: "Akrep", emoji: "♏" },
      { roleName: "♐ Yay", buttonLabel: "Yay", emoji: "♐" },
      { roleName: "♑ Oğlak", buttonLabel: "Oğlak", emoji: "♑" },
      { roleName: "♒ Kova", buttonLabel: "Kova", emoji: "♒" },
      { roleName: "♓ Balık", buttonLabel: "Balık", emoji: "♓" },
    ],
  },
  {
    key: "renk",
    channelName: "renk-seçim",
    items: [
      { roleName: "🤍 White", buttonLabel: "White", emoji: "🤍" },
      { roleName: "🖤 Black", buttonLabel: "Black", emoji: "🖤" },
      { roleName: "💜 Purple", buttonLabel: "Purple", emoji: "💜" },
      { roleName: "🩷 Pink", buttonLabel: "Pink", emoji: "🩷" },
      { roleName: "❤️ Red", buttonLabel: "Red", emoji: "❤️" },
      { roleName: "💙 Blue", buttonLabel: "Blue", emoji: "💙" },
      { roleName: "💚 Green", buttonLabel: "Green", emoji: "💚" },
      { roleName: "💛 Gold", buttonLabel: "Gold", emoji: "💛" },
    ],
  },
];

const initializedClients = new WeakSet<Client>();
const setupLocks = new Set<string>();
const temporaryVoiceChannels = new Set<string>();

function normalizeChannelName(name: string): string {
  return name
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ç", "c")
    .replaceAll("ğ", "g")
    .replaceAll("ı", "i")
    .replaceAll("ö", "o")
    .replaceAll("ş", "s")
    .replaceAll("ü", "u")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

async function getOrCreateRole(
  guild: Guild,
  name: string,
): Promise<import("discord.js").Role> {
  const existing = guild.roles.cache.find((role) => role.name === name);
  if (existing) return existing;

  return guild.roles.create({
    name,
    reason: "Bot kayıt sistemi kurulumu",
  });
}

async function getOrCreateCategory(
  guild: Guild,
  name: string,
): Promise<CategoryChannel> {
  const existing = guild.channels.cache.find(
    (channel): channel is CategoryChannel =>
      channel.type === ChannelType.GuildCategory && channel.name === name,
  );

  if (existing) return existing;

  return guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    reason: "Bot sistem kurulumu",
  });
}

async function getOrCreateTextChannel(
  guild: Guild,
  name: string,
  parent: CategoryChannel,
): Promise<TextChannel> {
  const existing = guild.channels.cache.find(
    (channel): channel is TextChannel =>
      channel.type === ChannelType.GuildText && channel.name === name,
  );

  if (existing) {
    if (existing.parentId !== parent.id) {
      await existing.setParent(parent, { lockPermissions: false }).catch(() => null);
    }
    return existing;
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent,
    reason: "Bot kayıt sistemi kurulumu",
  });
}

async function getOrCreateVoiceChannel(
  guild: Guild,
  name: string,
  parent: CategoryChannel,
): Promise<VoiceChannel> {
  const existing = guild.channels.cache.find(
    (channel): channel is VoiceChannel =>
      channel.type === ChannelType.GuildVoice && channel.name === name,
  );

  if (existing) {
    if (existing.parentId !== parent.id) {
      await existing.setParent(parent, { lockPermissions: false }).catch(() => null);
    }
    return existing;
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    parent,
    reason: "Geçici oda sistemi kurulumu",
  });
}

async function configureRegistrationPermissions(
  guild: Guild,
  registrationCategory: CategoryChannel,
  rulesChannel: TextChannel,
  registerChannel: TextChannel,
  welcomeChannel: TextChannel,
  unregisteredRoleId: string,
  memberRoleId: string,
): Promise<void> {
  await registrationCategory.permissionOverwrites.edit(guild.roles.everyone, {
    ViewChannel: false,
  });

  await registrationCategory.permissionOverwrites.edit(unregisteredRoleId, {
    ViewChannel: true,
    ReadMessageHistory: true,
  });

  await registrationCategory.permissionOverwrites.edit(memberRoleId, {
    ViewChannel: true,
    ReadMessageHistory: true,
  });

  for (const channel of [rulesChannel, registerChannel]) {
    await channel.permissionOverwrites.edit(unregisteredRoleId, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: false,
    });
  }

  await welcomeChannel.permissionOverwrites.edit(unregisteredRoleId, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: false,
  });

  for (const channel of guild.channels.cache.values()) {
    if (
      channel.id === registrationCategory.id ||
      channel.parentId === registrationCategory.id ||
      channel.type === ChannelType.GuildCategory ||
      channel.isThread() ||
      !("permissionOverwrites" in channel)
    ) {
      continue;
    }

    await channel.permissionOverwrites
      .edit(unregisteredRoleId, { ViewChannel: false })
      .catch((error: unknown) => {
        console.warn(`⚠️ Kanal izni ayarlanamadı (${channel.name}):`, error);
      });
  }
}

function createRulesEmbed(guild: Guild): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`${guild.name} • Kayıt`)
    .setDescription(
      [
        "Sunucuya erişmek için kuralları okuyup aşağıdaki butona bas.",
        "",
        "• Saygılı ol.",
        "• Küfür, spam ve taciz yapma.",
        "• Yetkililerin uyarılarına uy.",
        "• Discord topluluk kurallarına uy.",
      ].join("\n"),
    )
    .setFooter({ text: "Butona bastığında Member rolün verilir." })
    .setTimestamp();
}

function createRulesButtonRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ACCEPT_RULES_BUTTON_ID)
      .setLabel("Kuralları Kabul Ediyorum")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
  );
}

async function ensureRulesMessage(
  guild: Guild,
  registerChannel: TextChannel,
): Promise<void> {
  const recentMessages = await registerChannel.messages
    .fetch({ limit: 25 })
    .catch(() => null);

  const existing = recentMessages?.find(
    (message) =>
      message.author.id === guild.members.me?.id &&
      message.embeds.some(
        (embed) => embed.title === `${guild.name} • Kayıt`,
      ),
  );

  if (existing) return;

  await registerChannel.send({
    embeds: [createRulesEmbed(guild)],
    components: [createRulesButtonRow()],
  });
}

async function repairRegisteredMemberRoles(
  guild: Guild,
  memberRoleId: string,
  unregisteredRoleId: string,
): Promise<number> {
  await guild.members.fetch();

  let repairedCount = 0;

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) {
      continue;
    }

    const isRegistered = member.roles.cache.has(memberRoleId);
    const isUnregistered = member.roles.cache.has(unregisteredRoleId);

    if (!isRegistered || !isUnregistered) {
      continue;
    }

    await member.roles
      .remove(
        unregisteredRoleId,
        "Kayıtlı kullanıcıdaki hatalı Kayıtsız rolü temizlendi",
      )
      .then(() => {
        repairedCount += 1;
      })
      .catch((error: unknown) => {
        console.error(
          `❌ Hatalı Kayıtsız rolü kaldırılamadı (${member.user.tag}):`,
          error,
        );
      });
  }

  return repairedCount;
}


function normalizeRoleLookupName(name: string): string {
  return name
    .toLocaleLowerCase("tr-TR")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/\s+/g, "")
    .trim();
}

function findExistingRole(
  guild: Guild,
  configuredRoleName: string,
): import("discord.js").Role | undefined {
  const exactRole = guild.roles.cache.find(
    (role) => role.name === configuredRoleName,
  );

  if (exactRole) {
    return exactRole;
  }

  const normalizedConfiguredName =
    normalizeRoleLookupName(configuredRoleName);

  return guild.roles.cache.find(
    (role) =>
      normalizeRoleLookupName(role.name) === normalizedConfiguredName,
  );
}

async function getOrCreateRoleSelectionChannel(
  guild: Guild,
  channelName: string,
  category: CategoryChannel,
): Promise<TextChannel> {
  const existing = guild.channels.cache.find(
    (channel): channel is TextChannel =>
      channel.type === ChannelType.GuildText &&
      channel.name === channelName,
  );

  if (existing) {
    return existing;
  }

  return guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category,
    reason: "Rol seçim paneli kurulumu",
  });
}

function createRoleSelectionButton(
  groupIndex: number,
  itemIndex: number,
  item: RoleSelectionItem,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `${ROLE_SELECTION_BUTTON_PREFIX}:${groupIndex}:${itemIndex}`,
      )
      .setLabel(item.buttonLabel)
      .setEmoji(item.emoji)
      .setStyle(ButtonStyle.Secondary),
  );
}

async function clearOldRoleSelectionMessages(
  channel: TextChannel,
  botUserId: string,
): Promise<void> {
  const messages = await channel.messages
    .fetch({ limit: 100 })
    .catch(() => null);

  if (!messages) {
    return;
  }

  for (const message of messages.values()) {
    if (message.author.id !== botUserId) {
      continue;
    }

    const serializedComponents = JSON.stringify(
      message.components.map((component) => component.toJSON()),
    );

    if (
      serializedComponents.includes(
        `"custom_id":"${ROLE_SELECTION_BUTTON_PREFIX}:`,
      )
    ) {
      await message.delete().catch(() => null);
    }
  }
}

async function ensureRoleSelectionPanels(
  guild: Guild,
): Promise<void> {
  const category = await getOrCreateCategory(
    guild,
    ROLE_SELECTION_CATEGORY_NAME,
  );

  const botUserId = guild.members.me?.id;

  if (!botUserId) {
    throw new Error("Botun sunucu üyelik bilgisi alınamadı.");
  }

  for (
    let groupIndex = 0;
    groupIndex < ROLE_SELECTION_GROUPS.length;
    groupIndex += 1
  ) {
    const group = ROLE_SELECTION_GROUPS[groupIndex];

    if (!group) {
      continue;
    }

    const channel = await getOrCreateRoleSelectionChannel(
      guild,
      group.channelName,
      category,
    );

    await channel.permissionOverwrites.edit(
      guild.roles.everyone,
      {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: false,
      },
    );

    await clearOldRoleSelectionMessages(channel, botUserId);

    for (
      let itemIndex = 0;
      itemIndex < group.items.length;
      itemIndex += 1
    ) {
      const item = group.items[itemIndex];

      if (!item) {
        continue;
      }

      const role = findExistingRole(guild, item.roleName);

      if (!role) {
        console.warn(
          `⚠️ Rol seçim rolü bulunamadı: ${item.roleName}`,
        );
        continue;
      }

      await channel.send({
        content: "Almak istediğin rolün butonuna tıkla.",
        components: [
          createRoleSelectionButton(
            groupIndex,
            itemIndex,
            item,
          ),
        ],
      });
    }
  }
}

async function handleRoleSelection(
  interaction: import("discord.js").ButtonInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "❌ Bu buton yalnızca sunucuda çalışır.",
      ephemeral: true,
    });
    return;
  }

  const parts = interaction.customId.split(":");

  if (
    parts.length !== 3 ||
    parts[0] !== ROLE_SELECTION_BUTTON_PREFIX
  ) {
    return;
  }

  const groupIndex = Number.parseInt(parts[1] ?? "", 10);
  const itemIndex = Number.parseInt(parts[2] ?? "", 10);

  const group = ROLE_SELECTION_GROUPS[groupIndex];
  const item = group?.items[itemIndex];

  if (!group || !item) {
    await interaction.reply({
      content: "❌ Bu rol seçim butonu artık geçerli değil.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  await interaction.guild.roles.fetch();

  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);

  if (!member) {
    await interaction.editReply(
      "❌ Sunucudaki üyelik bilgin alınamadı.",
    );
    return;
  }

  const selectedRole = findExistingRole(
    interaction.guild,
    item.roleName,
  );

  if (!selectedRole) {
    await interaction.editReply(
      `❌ **${item.buttonLabel}** rolü sunucuda bulunamadı.`,
    );
    return;
  }

  if (!selectedRole.editable) {
    await interaction.editReply(
      "❌ Bot bu rolü yönetemiyor. Bot rolünü seçim rollerinin üzerine taşı.",
    );
    return;
  }

  if (member.roles.cache.has(selectedRole.id)) {
    await member.roles.remove(
      selectedRole,
      "Kullanıcı rol seçim panelinden rolü bıraktı.",
    );

    await interaction.editReply(
      `✅ **${selectedRole.name}** rolü kaldırıldı.`,
    );
    return;
  }

  const groupRoleIds = group.items
    .map((groupItem) =>
      findExistingRole(
        interaction.guild!,
        groupItem.roleName,
      )?.id,
    )
    .filter((roleId): roleId is string => Boolean(roleId));

  const currentGroupRoleCount = groupRoleIds.filter(
    (roleId) => member.roles.cache.has(roleId),
  ).length;

  if (
    currentGroupRoleCount >=
    MAX_ROLES_PER_SELECTION_GROUP
  ) {
    await interaction.editReply(
      [
        `❌ **${group.channelName}** grubundan en fazla **${MAX_ROLES_PER_SELECTION_GROUP} rol** alabilirsin.`,
        "Yeni bir rol almak için önce sahip olduğun rollerden birini bırak.",
      ].join("\n"),
    );
    return;
  }

  await member.roles.add(
    selectedRole,
    "Kullanıcı rol seçim panelinden rol aldı.",
  );

  await interaction.editReply(
    [
      `✅ **${selectedRole.name}** rolü verildi.`,
      `Bu grupta ${currentGroupRoleCount + 1}/${MAX_ROLES_PER_SELECTION_GROUP} rol kullanıyorsun.`,
    ].join("\n"),
  );
}

export async function ensureCommunitySetup(guild: Guild): Promise<void> {
  if (setupLocks.has(guild.id)) return;
  setupLocks.add(guild.id);

  try {
    await guild.roles.fetch();
    await guild.channels.fetch();

    await ensureRoleSelectionPanels(guild);

    const unregisteredRole = await getOrCreateRole(guild, UNREGISTERED_ROLE_NAME);
    const memberRole = await getOrCreateRole(guild, MEMBER_ROLE_NAME);

    const registrationCategory = await getOrCreateCategory(
      guild,
      REGISTRATION_CATEGORY_NAME,
    );

    const rulesChannel = await getOrCreateTextChannel(
      guild,
      RULES_CHANNEL_NAME,
      registrationCategory,
    );

    const registerChannel = await getOrCreateTextChannel(
      guild,
      REGISTER_CHANNEL_NAME,
      registrationCategory,
    );

    const welcomeChannel = await getOrCreateTextChannel(
      guild,
      WELCOME_CHANNEL_NAME,
      registrationCategory,
    );

    const temporaryCategory = await getOrCreateCategory(guild, TEMP_CATEGORY_NAME);
    await getOrCreateVoiceChannel(guild, CREATE_ROOM_CHANNEL_NAME, temporaryCategory);

    await configureRegistrationPermissions(
      guild,
      registrationCategory,
      rulesChannel,
      registerChannel,
      welcomeChannel,
      unregisteredRole.id,
      memberRole.id,
    );

    await ensureRulesMessage(guild, registerChannel);

    const repairedCount = await repairRegisteredMemberRoles(
      guild,
      memberRole.id,
      unregisteredRole.id,
    );

    console.log(
      `✅ Kayıt ve geçici oda sistemi hazır: ${guild.name}` +
        (repairedCount > 0
          ? ` | ${repairedCount} kayıtlı üyeden Kayıtsız rolü kaldırıldı.`
          : ""),
    );
  } finally {
    setupLocks.delete(guild.id);
  }
}

async function handleNewMember(member: GuildMember): Promise<void> {
  await ensureCommunitySetup(member.guild);

  const unregisteredRole = member.guild.roles.cache.find(
    (role) => role.name === UNREGISTERED_ROLE_NAME,
  );

  const memberRole = member.guild.roles.cache.find(
    (role) => role.name === MEMBER_ROLE_NAME,
  );

  const isAlreadyRegistered =
    memberRole !== undefined &&
    member.roles.cache.has(memberRole.id);

  if (unregisteredRole && !isAlreadyRegistered) {
    await member.roles
      .add(unregisteredRole, "Yeni üye kayıt bekliyor")
      .catch((error: unknown) => {
        console.error(
          `❌ Kayıtsız rolü verilemedi (${member.user.tag}):`,
          error,
        );
      });
  }

  const registerChannel = member.guild.channels.cache.find(
    (channel): channel is TextChannel =>
      channel.type === ChannelType.GuildText && channel.name === REGISTER_CHANNEL_NAME,
  );

  const welcomeChannel = member.guild.channels.cache.find(
    (channel): channel is TextChannel =>
      channel.type === ChannelType.GuildText && channel.name === WELCOME_CHANNEL_NAME,
  );

  const accountAgeDays = Math.floor(
    (Date.now() - member.user.createdTimestamp) / 86_400_000,
  );

  const securityText =
    accountAgeDays < 7
      ? "⚠️ Çok yeni hesap"
      : accountAgeDays < 30
        ? "🟡 Yeni hesap"
        : "✅ Güvenli";

  if (welcomeChannel) {
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setAuthor({
        name: `${member.user.username} sunucuya katıldı!`,
        iconURL: member.user.displayAvatarURL(),
      })
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "Kullanıcı", value: `${member}`, inline: true },
        { name: "Üye sayısı", value: String(member.guild.memberCount), inline: true },
        { name: "Hesap güvenliği", value: securityText, inline: true },
        {
          name: "Hesap oluşturma",
          value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`,
        },
      )
      .setFooter({ text: member.guild.name })
      .setTimestamp();

    await welcomeChannel.send({ content: `${member}`, embeds: [embed] }).catch(() => null);
  }

  const registerMention = registerChannel ? `${registerChannel}` : "kayıt-ol kanalı";

  await member.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`${member.guild.name} sunucusuna hoş geldin!`)
        .setDescription(
          [
            `Sunucuya erişebilmek için ${registerMention} bölümüne git.`,
            "Kuralları okuyup **Kuralları Kabul Ediyorum** butonuna bas.",
          ].join("\n"),
        )
        .setThumbnail(member.guild.iconURL({ size: 256 }))
        .setTimestamp(),
    ],
  }).catch(() => {
    console.warn(`⚠️ DM gönderilemedi: ${member.user.tag}`);
  });
}

async function handleAcceptRules(
  interaction: import("discord.js").ButtonInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: "❌ Bu buton yalnızca sunucuda çalışır.", ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const memberRole = interaction.guild.roles.cache.find((role) => role.name === MEMBER_ROLE_NAME);
  const unregisteredRole = interaction.guild.roles.cache.find(
    (role) => role.name === UNREGISTERED_ROLE_NAME,
  );

  if (!memberRole) {
    await interaction.reply({
      content: "❌ Member rolü bulunamadı. Bir yönetici botu yeniden başlatsın.",
      ephemeral: true,
    });
    return;
  }

  if (member.roles.cache.has(memberRole.id)) {
    if (
      unregisteredRole &&
      member.roles.cache.has(unregisteredRole.id)
    ) {
      await member.roles.remove(
        unregisteredRole,
        "Kayıtlı kullanıcıdaki hatalı Kayıtsız rolü temizlendi",
      );

      await interaction.reply({
        content:
          "✅ Zaten kayıtlıydın. Üzerindeki hatalı **Kayıtsız** rolü kaldırıldı ve kanal erişimin düzeltildi.",
        ephemeral: true,
      });

      return;
    }

    await interaction.reply({
      content: "ℹ️ Zaten kayıtlısın.",
      ephemeral: true,
    });

    return;
  }

  await interaction.deferReply({ ephemeral: true });

  await member.roles.add(memberRole, "Kuralları kabul etti");
  if (unregisteredRole && member.roles.cache.has(unregisteredRole.id)) {
    await member.roles.remove(unregisteredRole, "Kayıt tamamlandı");
  }

  await interaction.editReply(
    "✅ Kayıt tamamlandı. Sunucu kanallarına erişimin açıldı.",
  );
}

async function createTemporaryRoom(member: GuildMember): Promise<void> {
  const guild = member.guild;
  const temporaryCategory = guild.channels.cache.find(
    (channel): channel is CategoryChannel =>
      channel.type === ChannelType.GuildCategory && channel.name === TEMP_CATEGORY_NAME,
  );

  if (!temporaryCategory) return;

  const safeName = normalizeChannelName(`${member.displayName}-odasi`) || `${member.id}-odasi`;
  const channel = await guild.channels.create({
    name: `🔊・${safeName}`,
    type: ChannelType.GuildVoice,
    parent: temporaryCategory,
    userLimit: 0,
    permissionOverwrites: [
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.MoveMembers,
          PermissionFlagsBits.ManageChannels,
        ],
      },
    ],
    reason: `${member.user.tag} için geçici oda`,
  });

  temporaryVoiceChannels.add(channel.id);

  await member.voice.setChannel(channel).catch(async (error: unknown) => {
    console.error(`❌ Kullanıcı geçici odaya taşınamadı (${member.user.tag}):`, error);
    await channel.delete("Kullanıcı taşınamadı").catch(() => null);
    temporaryVoiceChannels.delete(channel.id);
  });
}

async function handleVoiceStateUpdate(
  oldState: import("discord.js").VoiceState,
  newState: import("discord.js").VoiceState,
): Promise<void> {
  const guild = newState.guild;
  const creatorChannel = guild.channels.cache.find(
    (channel): channel is VoiceChannel =>
      channel.type === ChannelType.GuildVoice && channel.name === CREATE_ROOM_CHANNEL_NAME,
  );

  if (
    newState.channelId &&
    creatorChannel &&
    newState.channelId === creatorChannel.id &&
    newState.member &&
    !newState.member.user.bot
  ) {
    await createTemporaryRoom(newState.member);
  }

  const oldChannel = oldState.channel;
  if (
    oldChannel?.type === ChannelType.GuildVoice &&
    temporaryVoiceChannels.has(oldChannel.id) &&
    oldChannel.members.size === 0
  ) {
    temporaryVoiceChannels.delete(oldChannel.id);
    await oldChannel.delete("Geçici oda boş kaldı").catch(() => null);
  }
}

export function initializeCommunityFeatures(client: Client): void {
  if (initializedClients.has(client)) return;
  initializedClients.add(client);

  client.once(Events.ClientReady, (readyClient) => {
    for (const guild of readyClient.guilds.cache.values()) {
      void ensureCommunitySetup(guild).catch((error: unknown) => {
        console.error(`❌ Topluluk sistemi kurulamadı (${guild.name}):`, error);
      });
    }
  });

  client.on(Events.GuildCreate, (guild) => {
    void ensureCommunitySetup(guild).catch((error: unknown) => {
      console.error(`❌ Yeni sunucuda sistem kurulamadı (${guild.name}):`, error);
    });
  });

  client.on(Events.GuildMemberAdd, (member) => {
    void handleNewMember(member).catch((error: unknown) => {
      console.error(`❌ Yeni üye işlemi başarısız (${member.user.tag}):`, error);
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isButton()) {
      return;
    }

    if (interaction.customId === ACCEPT_RULES_BUTTON_ID) {
      void handleAcceptRules(interaction).catch(async (error: unknown) => {
        console.error("❌ Kayıt butonu hatası:", error);
        if (!interaction.isRepliable()) return;
        const content = "❌ Kayıt sırasında beklenmeyen bir hata oluştu.";
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content, ephemeral: true }).catch(() => null);
        } else {
          await interaction.reply({ content, ephemeral: true }).catch(() => null);
        }
      });

      return;
    }

    if (
      interaction.customId.startsWith(
        `${ROLE_SELECTION_BUTTON_PREFIX}:`,
      )
    ) {
      void handleRoleSelection(interaction).catch(
        async (error: unknown) => {
          console.error("❌ Rol seçim butonu hatası:", error);

          if (!interaction.isRepliable()) {
            return;
          }

          const content =
            "❌ Rol işlemi sırasında beklenmeyen bir hata oluştu.";

          if (interaction.replied || interaction.deferred) {
            await interaction
              .followUp({ content, ephemeral: true })
              .catch(() => null);
          } else {
            await interaction
              .reply({ content, ephemeral: true })
              .catch(() => null);
          }
        },
      );
    }
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void handleVoiceStateUpdate(oldState, newState).catch((error: unknown) => {
      console.error("❌ Geçici oda sistemi hatası:", error);
    });
  });

  console.log("✅ Kayıt, rol seçimi, DM, hoş geldin ve geçici oda sistemi başlatıldı.");
}
