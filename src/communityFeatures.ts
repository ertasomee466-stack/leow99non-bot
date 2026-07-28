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

const ROLE_SELECT_BUTTON_PREFIX = "role-select:";

interface RoleSelectionOption {
  roleName: string;
  label: string;
  emoji: string;
}

interface RoleSelectionPanel {
  channelName: string;
  options: RoleSelectionOption[];
}

const ROLE_SELECTION_PANELS: RoleSelectionPanel[] = [
  {
    channelName: "ilişki-seçim",
    options: [
      { roleName: "Sevgili Yapmıyorum", label: "Sevgili Yapmıyorum", emoji: "💔" },
      { roleName: "Sevgilim Var", label: "Sevgilim Var", emoji: "❤️" },
      { roleName: "Sapım", label: "Sapım", emoji: "💔" },
    ],
  },
  {
    channelName: "burç-seçim",
    options: [
      { roleName: "Koç", label: "Koç", emoji: "♈" },
      { roleName: "Boğa", label: "Boğa", emoji: "♉" },
      { roleName: "İkizler", label: "İkizler", emoji: "♊" },
      { roleName: "Yengeç", label: "Yengeç", emoji: "♋" },
      { roleName: "Aslan", label: "Aslan", emoji: "♌" },
      { roleName: "Başak", label: "Başak", emoji: "♍" },
      { roleName: "Terazi", label: "Terazi", emoji: "♎" },
      { roleName: "Akrep", label: "Akrep", emoji: "♏" },
      { roleName: "Yay", label: "Yay", emoji: "♐" },
      { roleName: "Oğlak", label: "Oğlak", emoji: "♑" },
      { roleName: "Kova", label: "Kova", emoji: "♒" },
      { roleName: "Balık", label: "Balık", emoji: "♓" },
    ],
  },
  {
    channelName: "renk-seçim",
    options: [
      { roleName: "pink", label: "pink", emoji: "🩷" },
      { roleName: "white", label: "white", emoji: "🤍" },
      { roleName: "purple", label: "purple", emoji: "💜" },
      { roleName: "green", label: "green", emoji: "💚" },
      { roleName: "blue", label: "blue", emoji: "🩵" },
      { roleName: "yellow", label: "yellow", emoji: "💛" },
      { roleName: "black", label: "black", emoji: "🖤" },
      { roleName: "red", label: "red", emoji: "❤️" },
    ],
  },
];

const ALL_SELECTION_ROLE_NAMES = new Set(
  ROLE_SELECTION_PANELS.flatMap((panel) =>
    panel.options.map((option) => option.roleName.toLocaleLowerCase("tr-TR")),
  ),
);

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


function findRoleByName(guild: Guild, roleName: string) {
  return guild.roles.cache.find(
    (role) =>
      role.name.toLocaleLowerCase("tr-TR") ===
      roleName.toLocaleLowerCase("tr-TR"),
  );
}

function findTextChannelByName(
  guild: Guild,
  channelName: string,
): TextChannel | undefined {
  return guild.channels.cache.find(
    (channel): channel is TextChannel =>
      channel.type === ChannelType.GuildText &&
      (
        channel.name === channelName ||
        normalizeChannelName(channel.name) === normalizeChannelName(channelName)
      ),
  );
}

function roleButtonCustomId(roleId: string): string {
  return `${ROLE_SELECT_BUTTON_PREFIX}${roleId}`;
}

async function ensureRoleSelectionPanels(guild: Guild): Promise<void> {
  await guild.roles.fetch();
  await guild.channels.fetch();

  for (const panel of ROLE_SELECTION_PANELS) {
    const channel = findTextChannelByName(guild, panel.channelName);

    if (!channel) {
      console.warn(
        `⚠️ Rol seçim kanalı bulunamadı: #${panel.channelName}`,
      );
      continue;
    }

    const recentMessages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);

    for (const option of panel.options) {
      const role = findRoleByName(guild, option.roleName);

      if (!role) {
        console.warn(
          `⚠️ Rol seçim rolü bulunamadı: ${option.roleName}`,
        );
        continue;
      }

      const customId = roleButtonCustomId(role.id);
      const alreadyExists = recentMessages?.some((message) => {
        if (message.author.id !== guild.members.me?.id) {
          return false;
        }

        const serialized = JSON.stringify(
          message.components.map((component) => component.toJSON()),
        );

        return serialized.includes(customId);
      }) ?? false;

      if (alreadyExists) {
        continue;
      }

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(customId)
          .setLabel(option.label)
          .setEmoji(option.emoji)
          .setStyle(ButtonStyle.Secondary),
      );

      await channel.send({
        content: "Almak istediğin rolün butonuna tıkla.",
        components: [row],
      });
    }
  }
}

async function handleRoleSelection(
  interaction: import("discord.js").ButtonInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({
      content: "❌ Bu buton yalnızca sunucuda kullanılabilir.",
      ephemeral: true,
    });
    return;
  }

  const roleId = interaction.customId.slice(
    ROLE_SELECT_BUTTON_PREFIX.length,
  );

  const role = await interaction.guild.roles
    .fetch(roleId)
    .catch(() => null);

  if (!role) {
    await interaction.reply({
      content: "❌ Bu rol artık bulunmuyor.",
      ephemeral: true,
    });
    return;
  }

  const configuredRole = ALL_SELECTION_ROLE_NAMES.has(
    role.name.toLocaleLowerCase("tr-TR"),
  );

  if (!configuredRole) {
    await interaction.reply({
      content: "❌ Bu buton geçerli bir seçim rolüne bağlı değil.",
      ephemeral: true,
    });
    return;
  }

  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);

  if (!member) {
    await interaction.reply({
      content: "❌ Üyelik bilgin alınamadı.",
      ephemeral: true,
    });
    return;
  }

  if (!role.editable) {
    await interaction.reply({
      content:
        "❌ Bot bu rolü yönetemiyor. Bot rolünü seçim rollerinin üzerine taşı.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  if (member.roles.cache.has(role.id)) {
    await member.roles.remove(role, "Kullanıcı seçim rolünü bıraktı.");
    await interaction.editReply(`✅ **${role.name}** rolü kaldırıldı.`);
    return;
  }

  const selectedRoles = member.roles.cache.filter((memberRole) =>
    ALL_SELECTION_ROLE_NAMES.has(
      memberRole.name.toLocaleLowerCase("tr-TR"),
    ),
  );

  if (selectedRoles.size >= 2) {
    await interaction.editReply(
      "❌ En fazla **2 seçim rolü** alabilirsin. Önce rollerinden birini bırak.",
    );
    return;
  }

  await member.roles.add(role, "Kullanıcı seçim rolünü aldı.");
  await interaction.editReply(`✅ **${role.name}** rolü verildi.`);
}

export async function ensureCommunitySetup(guild: Guild): Promise<void> {
  if (setupLocks.has(guild.id)) return;
  setupLocks.add(guild.id);

  try {
    await guild.roles.fetch();
    await guild.channels.fetch();

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
    await ensureRoleSelectionPanels(guild);

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

    if (interaction.customId.startsWith(ROLE_SELECT_BUTTON_PREFIX)) {
      void handleRoleSelection(interaction).catch(async (error: unknown) => {
        console.error("❌ Rol seçim butonu hatası:", error);
        if (!interaction.isRepliable()) return;
        const content = "❌ Rol işlemi sırasında beklenmeyen bir hata oluştu.";
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content, ephemeral: true }).catch(() => null);
        } else {
          await interaction.reply({ content, ephemeral: true }).catch(() => null);
        }
      });
    }
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void handleVoiceStateUpdate(oldState, newState).catch((error: unknown) => {
      console.error("❌ Geçici oda sistemi hatası:", error);
    });
  });

  console.log("✅ Kayıt, DM, hoş geldin ve geçici oda sistemi başlatıldı.");
}
