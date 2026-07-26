import {
  ChannelType,
  Client,
  Guild,
  PermissionFlagsBits,
  VoiceBasedChannel,
  VoiceState,
} from "discord.js";

import {
  DiscordGatewayAdapterCreator,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";

import {
  startSpeechModeration,
  stopSpeechModeration,
} from "./speech.js";

/* =========================================================
   AYARLAR
========================================================= */

/*
Bot, sunucu sahibi ses kanalına girdikten sonra
bu süre kadar bekleyip kanala bağlanır.

Bu kısa bekleme, Discord voice-state güncellemelerinin
tamamlanmasına yardımcı olur.
*/
const FOLLOW_DELAY_MS = 1_000;

/*
Bot bağlantısının hazır olması için beklenecek
en fazla süre.
*/
const CONNECTION_READY_TIMEOUT_MS = 20_000;

/* =========================================================
   DURUM BİLGİLERİ
========================================================= */

/*
Her sunucu için bekleyen takip zamanlayıcısını tutar.
Aynı anda birden fazla bağlantı girişimi yapılmasını önler.
*/
const followTimers = new Map<
  string,
  NodeJS.Timeout
>();

/*
Botun kendi yaptığı kanal değişikliklerini takip eder.
*/
const joiningGuilds = new Set<string>();

/*
Daha önce event listener eklenmiş client'ları tutar.
Aynı listener'ın iki kere eklenmesini engeller.
*/
const initializedClients =
  new WeakSet<Client>();

/* =========================================================
   YARDIMCI FONKSİYONLAR
========================================================= */

function clearFollowTimer(
  guildId: string,
): void {
  const timer =
    followTimers.get(guildId);

  if (!timer) {
    return;
  }

  clearTimeout(timer);
  followTimers.delete(guildId);
}

function isSupportedVoiceChannel(
  channel: VoiceBasedChannel,
): boolean {
  return (
    channel.type ===
      ChannelType.GuildVoice ||
    channel.type ===
      ChannelType.GuildStageVoice
  );
}

function canJoinChannel(
  guild: Guild,
  channel: VoiceBasedChannel,
): boolean {
  const botMember =
    guild.members.me;

  if (!botMember) {
    console.warn(
      `⚠️ Bot üyesi bulunamadı: ${guild.name}`,
    );

    return false;
  }

  const permissions =
    channel.permissionsFor(botMember);

  if (!permissions) {
    console.warn(
      `⚠️ Kanal izinleri okunamadı: ${channel.name}`,
    );

    return false;
  }

  if (
    !permissions.has(
      PermissionFlagsBits.ViewChannel,
    )
  ) {
    console.warn(
      `⚠️ Bot kanalı göremiyor: ${channel.name}`,
    );

    return false;
  }

  if (
    !permissions.has(
      PermissionFlagsBits.Connect,
    )
  ) {
    console.warn(
      `⚠️ Botun kanala bağlanma yetkisi yok: ${channel.name}`,
    );

    return false;
  }

  /*
  Stage kanallarında konuşmayacağımız için Speak
  izni zorunlu değildir. Bot sadece dinleyici olur.
  */

  return true;
}

/* =========================================================
   BAĞLANTIYI KAPAT
========================================================= */

export function disconnectOwnerFollow(
  guildId: string,
): void {
  clearFollowTimer(guildId);
  joiningGuilds.delete(guildId);

  stopSpeechModeration(guildId);

  const connection =
    getVoiceConnection(guildId);

  if (!connection) {
    return;
  }

  try {
    connection.destroy();

    console.log(
      `👋 Ses bağlantısı kapatıldı: ${guildId}`,
    );
  } catch (error) {
    console.error(
      `❌ Ses bağlantısı kapatılamadı (${guildId}):`,
      error,
    );
  }
}

/* =========================================================
   SES KANALINA BAĞLAN
========================================================= */

async function connectToOwnerChannel(
  guild: Guild,
  channel: VoiceBasedChannel,
): Promise<void> {
  if (
    joiningGuilds.has(guild.id)
  ) {
    return;
  }

  if (
    !isSupportedVoiceChannel(channel)
  ) {
    return;
  }

  if (
    !canJoinChannel(guild, channel)
  ) {
    return;
  }

  joiningGuilds.add(guild.id);

  try {
    const existingConnection =
      getVoiceConnection(guild.id);

    /*
    Bot zaten doğru kanaldaysa yeniden bağlanma.
    */
    if (
      existingConnection &&
      existingConnection.joinConfig
        .channelId === channel.id
    ) {
      startSpeechModeration(
        existingConnection,
        guild,
      );

      return;
    }

    /*
    Eski bağlantı varsa önce kapat.
    */
    if (existingConnection) {
      stopSpeechModeration(
        guild.id,
      );

      existingConnection.destroy();
    }

    console.log(
      `🔄 Sunucu sahibinin kanalına bağlanılıyor: ` +
        `${guild.name} / ${channel.name}`,
    );

    const connection =
      joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,

        adapterCreator:
          guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,

        /*
        Ses moderasyonu için bot sağır olmamalı.
        Bot konuşmayacağı için mikrofonu kapalı tutulur.
        */
        selfDeaf: false,
        selfMute: true,
      });

    setupConnectionEvents(
      connection,
      guild,
    );

    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      CONNECTION_READY_TIMEOUT_MS,
    );

    console.log(
      `✅ Sunucu sahibinin kanalına bağlanıldı: ` +
        `${guild.name} / ${channel.name}`,
    );

    startSpeechModeration(
      connection,
      guild,
    );
  } catch (error) {
    console.error(
      `❌ Ses kanalına bağlanılamadı (${guild.name}):`,
      error,
    );

    const connection =
      getVoiceConnection(guild.id);

    if (connection) {
      try {
        connection.destroy();
      } catch {
        // Bağlantı zaten kapanmış olabilir.
      }
    }
  } finally {
    joiningGuilds.delete(
      guild.id,
    );
  }
}

/* =========================================================
   BAĞLANTI EVENTLERİ
========================================================= */

function setupConnectionEvents(
  connection: VoiceConnection,
  guild: Guild,
): void {
  connection.on(
    VoiceConnectionStatus.Disconnected,
    async () => {
      console.warn(
        `⚠️ Ses bağlantısı kesildi: ${guild.name}`,
      );

      try {
        /*
        Discord kısa süreli bağlantı değişikliklerinde
        yeniden bağlanmayı kendi başına deneyebilir.
        */
        await Promise.race([
          entersState(
            connection,
            VoiceConnectionStatus.Signalling,
            5_000,
          ),

          entersState(
            connection,
            VoiceConnectionStatus.Connecting,
            5_000,
          ),
        ]);

        console.log(
          `🔄 Ses bağlantısı yeniden kuruluyor: ${guild.name}`,
        );
      } catch {
        stopSpeechModeration(
          guild.id,
        );

        try {
          connection.destroy();
        } catch {
          // Bağlantı zaten kapalı olabilir.
        }

        console.warn(
          `🛑 Ses bağlantısı tamamen kapandı: ${guild.name}`,
        );
      }
    },
  );

  connection.on(
    VoiceConnectionStatus.Destroyed,
    () => {
      stopSpeechModeration(
        guild.id,
      );

      console.log(
        `🗑️ Ses bağlantısı yok edildi: ${guild.name}`,
      );
    },
  );

  connection.on(
    "error",
    (error) => {
      console.error(
        `❌ Voice connection hatası (${guild.name}):`,
        error,
      );
    },
  );
}

/* =========================================================
   SUNUCU SAHİBİNİ KONTROL ET
========================================================= */

export async function followGuildOwner(
  guild: Guild,
): Promise<void> {
  clearFollowTimer(guild.id);

  const owner =
    await guild
      .fetchOwner()
      .catch((error) => {
        console.error(
          `❌ Sunucu sahibi alınamadı (${guild.name}):`,
          error,
        );

        return null;
      });

  if (!owner) {
    return;
  }

  const ownerChannel =
    owner.voice.channel;

  /*
  Sunucu sahibi ses kanalında değilse bot da çıkar.
  */
  if (!ownerChannel) {
    disconnectOwnerFollow(
      guild.id,
    );

    console.log(
      `👤 Sunucu sahibi ses kanalında değil: ${guild.name}`,
    );

    return;
  }

  if (
    !isSupportedVoiceChannel(
      ownerChannel,
    )
  ) {
    disconnectOwnerFollow(
      guild.id,
    );

    return;
  }

  await connectToOwnerChannel(
    guild,
    ownerChannel,
  );
}

/* =========================================================
   VOICE STATE GÜNCELLEMESİ
========================================================= */

async function handleVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  const guild =
    newState.guild;

  const changedUserId =
    newState.id;

  /*
  Sadece sunucu sahibinin hareketleriyle ilgileniyoruz.
  */
  if (
    changedUserId !==
    guild.ownerId
  ) {
    return;
  }

  /*
  Kanal değişmediyse işlem yapma.
  Örneğin mute/deafen değişikliklerini yok say.
  */
  if (
    oldState.channelId ===
    newState.channelId
  ) {
    return;
  }

  clearFollowTimer(
    guild.id,
  );

  const timer =
    setTimeout(() => {
      followTimers.delete(
        guild.id,
      );

      void followGuildOwner(
        guild,
      ).catch((error) => {
        console.error(
          `❌ Owner Follow hatası (${guild.name}):`,
          error,
        );
      });
    }, FOLLOW_DELAY_MS);

  timer.unref();

  followTimers.set(
    guild.id,
    timer,
  );
}

/* =========================================================
   OWNER FOLLOW SİSTEMİNİ BAŞLAT
========================================================= */

export function initializeOwnerFollow(
  client: Client,
): void {
  if (
    initializedClients.has(client)
  ) {
    return;
  }

  initializedClients.add(
    client,
  );

  client.on(
    "voiceStateUpdate",
    (
      oldState,
      newState,
    ) => {
      void handleVoiceStateUpdate(
        oldState,
        newState,
      ).catch((error) => {
        console.error(
          "❌ Voice state işlenemedi:",
          error,
        );
      });
    },
  );

  /*
  Bot hazır olduğunda, sunucu sahibi zaten
  ses kanalındaysa bot ona bağlanır.
  */
  client.once(
    "clientReady",
    async () => {
      console.log(
        "👑 Owner Follow sistemi başlatıldı.",
      );

      for (
        const guild of client.guilds
          .cache.values()
      ) {
        await followGuildOwner(
          guild,
        ).catch((error) => {
          console.error(
            `❌ Başlangıç Owner Follow hatası (${guild.name}):`,
            error,
          );
        });
      }
    },
  );
}