import {
  EndBehaviorType,
  type VoiceConnection,
} from "@discordjs/voice";

import type {
  Guild,
} from "discord.js";

import prism from "prism-media";

import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";

import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline";

import type {
  Readable,
  Writable,
} from "node:stream";

import {
  moderateVoiceTranscript,
} from "./moderation.js";

/* =========================================================
   AYARLAR
========================================================= */

const PYTHON_COMMAND =
  process.env.PYTHON_COMMAND?.trim() ||
  "python3";

const TRANSCRIBE_SCRIPT =
  process.env.TRANSCRIBE_SCRIPT?.trim() ||
  "python/transcribe.py";

/*
Çok kısa ses kayıtları Vosk'a gönderilmez.
*/

const MINIMUM_AUDIO_DURATION_MS =
  800;

/*
Bir konuşma akışı en fazla 15 saniye açık kalır.
*/

const MAXIMUM_AUDIO_DURATION_MS =
  15_000;

/*
Bir moderasyon işleminden sonra aynı kullanıcı
bu süre boyunca tekrar işlenmez.
*/

const USER_COOLDOWN_MS =
  15_000;

/*
Konuşma bittikten sonra Python'un final sonucunu
göndermesi için beklenecek süre.
*/

const FINAL_RESULT_WAIT_MS =
  3_000;

/*
Python kapanmazsa zorla sonlandırılmadan önce
beklenecek süre.
*/

const PYTHON_FORCE_KILL_MS =
  2_000;

/* =========================================================
   PYTHON MESAJ TİPLERİ
========================================================= */

interface PythonReadyMessage {
  type: "ready";
  sample_rate: number;
  model_path: string;
}

interface PythonFinalMessage {
  type: "final";
  text: string;
  confidence: number;
}

interface PythonErrorMessage {
  type: "error";
  message: string;
}

interface PythonClosedMessage {
  type: "closed";
  reason?: string;
}

type PythonMessage =
  | PythonReadyMessage
  | PythonFinalMessage
  | PythonErrorMessage
  | PythonClosedMessage;

/* =========================================================
   AKTİF SES AKIŞI
========================================================= */

interface ActiveUserStream {
  pythonProcess:
    ChildProcessWithoutNullStreams;

  startedAt:
    number;

  cleanup:
    () => void;
}

/* =========================================================
   DURUM BİLGİLERİ
========================================================= */

const activeUsers =
  new Map<
    string,
    ActiveUserStream
  >();

const userCooldowns =
  new Map<
    string,
    number
  >();

/*
Aynı ses bağlantısına iki kez listener eklenmesini
engeller.
*/

const attachedConnections =
  new WeakSet<
    VoiceConnection
  >();

/* =========================================================
   YARDIMCI FONKSİYONLAR
========================================================= */

function createUserKey(
  guildId: string,
  userId: string,
): string {
  return `${guildId}:${userId}`;
}

function isUserOnCooldown(
  guildId: string,
  userId: string,
): boolean {
  const key =
    createUserKey(
      guildId,
      userId,
    );

  const cooldownEnd =
    userCooldowns.get(
      key,
    );

  if (!cooldownEnd) {
    return false;
  }

  if (
    Date.now() >=
    cooldownEnd
  ) {
    userCooldowns.delete(
      key,
    );

    return false;
  }

  return true;
}

function setUserCooldown(
  guildId: string,
  userId: string,
): void {
  const key =
    createUserKey(
      guildId,
      userId,
    );

  userCooldowns.set(
    key,
    Date.now() +
      USER_COOLDOWN_MS,
  );
}

function parsePythonMessage(
  line: string,
): PythonMessage | null {
  try {
    return JSON.parse(
      line,
    ) as PythonMessage;
  } catch {
    console.warn(
      "⚠️ Python tarafından geçersiz JSON gönderildi:",
      line,
    );

    return null;
  }
}

function isBrokenPipeError(
  error: unknown,
): boolean {
  if (
    !error ||
    typeof error !== "object"
  ) {
    return false;
  }

  const possibleError =
    error as {
      code?: unknown;
    };

  return (
    possibleError.code ===
    "EPIPE"
  );
}

function safelyDestroyStream(
  stream:
    | Readable
    | Writable
    | null
    | undefined,
): void {
  if (!stream) {
    return;
  }

  if (stream.destroyed) {
    return;
  }

  try {
    stream.destroy();
  } catch {
    /*
    Akış zaten kapanmış olabilir.
    */
  }
}

/* =========================================================
   PYTHON VOSK SÜRECİ
========================================================= */

function createPythonProcess():
  ChildProcessWithoutNullStreams {
  return spawn(
    PYTHON_COMMAND,
    [
      "-u",
      TRANSCRIBE_SCRIPT,
    ],
    {
      cwd:
        process.cwd(),

      stdio: [
        "pipe",
        "pipe",
        "pipe",
      ],

      env: {
        ...process.env,
      },
    },
  );
}

/* =========================================================
   KULLANICI SESİNİ DİNLE
========================================================= */

async function listenToUser(
  connection:
    VoiceConnection,

  guild:
    Guild,

  userId:
    string,
): Promise<void> {
  const userKey =
    createUserKey(
      guild.id,
      userId,
    );

  /*
  Aynı kullanıcı için zaten aktif bir konuşma
  işlemi varsa ikinci bir işlem açma.
  */

  if (
    activeUsers.has(
      userKey,
    )
  ) {
    return;
  }

  if (
    isUserOnCooldown(
      guild.id,
      userId,
    )
  ) {
    return;
  }

  const member =
    await guild.members
      .fetch(
        userId,
      )
      .catch(
        () => null,
      );

  if (!member) {
    return;
  }

  if (member.user.bot) {
    return;
  }

  const opusStream =
    connection.receiver.subscribe(
      userId,
      {
        end: {
          behavior:
            EndBehaviorType
              .AfterSilence,

          duration:
            800,
        },
      },
    );

  /*
  Discord Opus sesini PCM'e çevirir.
  */

  const opusDecoder =
    new prism.opus.Decoder({
      rate:
        48_000,

      channels:
        2,

      frameSize:
        960,
    });

  /*
  FFmpeg:

  48 kHz stereo PCM
       ↓
  16 kHz mono PCM

  Vosk 16 kHz mono PCM bekler.
  */

  const ffmpeg =
    new prism.FFmpeg({
      args: [
        "-loglevel",
        "error",

        "-f",
        "s16le",

        "-ar",
        "48000",

        "-ac",
        "2",

        "-i",
        "pipe:0",

        "-f",
        "s16le",

        "-ar",
        "16000",

        "-ac",
        "1",

        "pipe:1",
      ],
    });

  const pythonProcess =
    createPythonProcess();

  const startedAt =
    Date.now();

  let cleanedUp =
    false;

  let inputFinished =
    false;

  let receivedFinalResult =
    false;

  let pythonReady =
    false;

  let maximumDurationTimer:
    NodeJS.Timeout | undefined;

  let finalResultTimer:
    NodeJS.Timeout | undefined;

  let forceKillTimer:
    NodeJS.Timeout | undefined;

  let stdoutReader:
    ReadlineInterface | undefined;

  /* =======================================================
     ZAMANLAYICILARI TEMİZLE
  ======================================================= */

  const clearAllTimers =
    (): void => {
      if (
        maximumDurationTimer
      ) {
        clearTimeout(
          maximumDurationTimer,
        );

        maximumDurationTimer =
          undefined;
      }

      if (
        finalResultTimer
      ) {
        clearTimeout(
          finalResultTimer,
        );

        finalResultTimer =
          undefined;
      }

      if (
        forceKillTimer
      ) {
        clearTimeout(
          forceKillTimer,
        );

        forceKillTimer =
          undefined;
      }
    };

  /* =======================================================
     PYTHON'U GÜVENLİ KAPAT
  ======================================================= */

  const closePythonProcess =
    (): void => {
      if (
        pythonProcess.exitCode !==
          null ||
        pythonProcess.killed
      ) {
        return;
      }

      if (
        !pythonProcess.stdin
          .destroyed &&
        !pythonProcess.stdin
          .writableEnded
      ) {
        try {
          pythonProcess.stdin.end();
        } catch (
          error
        ) {
          if (
            !isBrokenPipeError(
              error,
            )
          ) {
            console.error(
              `❌ Python girişi kapatılamadı (${member.user.tag}):`,
              error,
            );
          }
        }
      }

      forceKillTimer =
        setTimeout(
          () => {
            if (
              pythonProcess.exitCode ===
                null &&
              !pythonProcess.killed
            ) {
              try {
                pythonProcess.kill(
                  "SIGKILL",
                );
              } catch {
                /*
                Python zaten kapanmış olabilir.
                */
              }
            }
          },
          PYTHON_FORCE_KILL_MS,
        );

      forceKillTimer.unref();
    };

  /* =======================================================
     GENEL TEMİZLEME
  ======================================================= */

  const cleanup =
    (): void => {
      if (cleanedUp) {
        return;
      }

      cleanedUp =
        true;

      clearAllTimers();

      activeUsers.delete(
        userKey,
      );

      if (stdoutReader) {
        try {
          stdoutReader.close();
        } catch {
          /*
          Readline zaten kapanmış olabilir.
          */
        }
      }

      /*
      Pipe bağlantılarını kaldır.
      */

      try {
        opusStream.unpipe(
          opusDecoder,
        );
      } catch {
        // Pipe zaten kapanmış olabilir.
      }

      try {
        opusDecoder.unpipe(
          ffmpeg,
        );
      } catch {
        // Pipe zaten kapanmış olabilir.
      }

      try {
        ffmpeg.unpipe(
          pythonProcess.stdin,
        );
      } catch {
        // Pipe zaten kapanmış olabilir.
      }

      safelyDestroyStream(
        opusStream,
      );

      safelyDestroyStream(
        opusDecoder,
      );

      safelyDestroyStream(
        ffmpeg,
      );

      closePythonProcess();
    };

  activeUsers.set(
    userKey,
    {
      pythonProcess,
      startedAt,
      cleanup,
    },
  );

  /* =======================================================
     PYTHON STDOUT
  ======================================================= */

  stdoutReader =
    createInterface({
      input:
        pythonProcess.stdout,
    });

  stdoutReader.on(
    "line",
    (line) => {
      void (
        async () => {
          const message =
            parsePythonMessage(
              line,
            );

          if (!message) {
            return;
          }

          if (
            message.type ===
            "ready"
          ) {
            pythonReady =
              true;

            return;
          }

          if (
            message.type ===
            "error"
          ) {
            console.error(
              `❌ Vosk hatası (${member.user.tag}):`,
              message.message,
            );

            cleanup();

            return;
          }

          if (
            message.type ===
            "closed"
          ) {
            if (
              !receivedFinalResult &&
              message.reason &&
              message.reason !==
                "stdin_closed"
            ) {
              console.warn(
                `⚠️ Vosk kapandı (${member.user.tag}): ${message.reason}`,
              );
            }

            cleanup();

            return;
          }

          if (
            message.type !==
            "final"
          ) {
            return;
          }

          receivedFinalResult =
            true;

          if (
            finalResultTimer
          ) {
            clearTimeout(
              finalResultTimer,
            );

            finalResultTimer =
              undefined;
          }

          const text =
            message.text.trim();

          if (!text) {
            cleanup();

            return;
          }

          const confidence =
            Number.isFinite(
              message.confidence,
            )
              ? message.confidence
              : 0;

          console.log(
            `🎙️ ${member.user.tag}: "${text}" ` +
              `(güven: ${confidence.toFixed(2)})`,
          );

          try {
            const result =
              await moderateVoiceTranscript(
                member,
                text,
                confidence,
              );

            if (
              result.success
            ) {
              console.log(
                `🛡️ Moderasyon sonucu: ${member.user.tag} — ${result.reason}`,
              );

              setUserCooldown(
                guild.id,
                member.id,
              );
            } else if (
              result.matchedWord
            ) {
              console.log(
                `⚠️ Küfür bulundu fakat işlem uygulanamadı: ` +
                  `${member.user.tag} — ${result.reason}`,
              );
            }
          } catch (
            error
          ) {
            console.error(
              `❌ Moderasyon işlemi başarısız (${member.user.tag}):`,
              error,
            );
          } finally {
            cleanup();
          }
        }
      )();
    },
  );

  /* =======================================================
     PYTHON STDERR
  ======================================================= */

  pythonProcess.stderr.on(
    "data",
    (
      data: Buffer,
    ) => {
      const message =
        data
          .toString(
            "utf8",
          )
          .trim();

      if (!message) {
        return;
      }

      console.error(
        `❌ Python stderr (${member.user.tag}):`,
        message,
      );
    },
  );

  /* =======================================================
     PYTHON STDIN HATALARI
  ======================================================= */

  pythonProcess.stdin.on(
    "error",
    (
      error:
        NodeJS.ErrnoException,
    ) => {
      /*
      Python daha önce kapandıysa pipe EPIPE verebilir.
      Bu durum yakalanarak Node uygulamasının çökmesi
      engellenir.
      */

      if (
        error.code ===
        "EPIPE"
      ) {
        if (!cleanedUp) {
          console.warn(
            `⚠️ Python ses girişi erken kapandı: ${member.user.tag}`,
          );
        }

        cleanup();

        return;
      }

      console.error(
        `❌ Python ses girişi hatası (${member.user.tag}):`,
        error,
      );

      cleanup();
    },
  );

  /* =======================================================
     PYTHON PROCESS EVENTLERİ
  ======================================================= */

  pythonProcess.on(
    "error",
    (error) => {
      console.error(
        `❌ Python başlatılamadı (${member.user.tag}):`,
        error,
      );

      cleanup();
    },
  );

  pythonProcess.on(
    "exit",
    (
      code,
      signal,
    ) => {
      if (
        forceKillTimer
      ) {
        clearTimeout(
          forceKillTimer,
        );

        forceKillTimer =
          undefined;
      }

      if (
        !cleanedUp &&
        code !== 0 &&
        signal !==
          "SIGKILL"
      ) {
        console.warn(
          `⚠️ Python süreci kapandı (${member.user.tag}): ` +
            `kod=${String(code)}, sinyal=${String(signal)}`,
        );
      }

      cleanup();
    },
  );

  /* =======================================================
     OPUS EVENTLERİ
  ======================================================= */

  opusStream.on(
    "error",
    (error) => {
      if (cleanedUp) {
        return;
      }

      console.error(
        `❌ Opus akışı hatası (${member.user.tag}):`,
        error,
      );

      cleanup();
    },
  );

  opusDecoder.on(
    "error",
    (error) => {
      if (cleanedUp) {
        return;
      }

      console.error(
        `❌ Opus çözücü hatası (${member.user.tag}):`,
        error,
      );

      cleanup();
    },
  );

  /* =======================================================
     FFMPEG EVENTLERİ
  ======================================================= */

  ffmpeg.on(
    "error",
    (error) => {
      if (cleanedUp) {
        return;
      }

      if (
        isBrokenPipeError(
          error,
        )
      ) {
        cleanup();

        return;
      }

      console.error(
        `❌ FFmpeg hatası (${member.user.tag}):`,
        error,
      );

      cleanup();
    },
  );

  /* =======================================================
     KONUŞMA BİTTİ
  ======================================================= */

  opusStream.once(
    "end",
    () => {
      if (cleanedUp) {
        return;
      }

      inputFinished =
        true;

      if (
        maximumDurationTimer
      ) {
        clearTimeout(
          maximumDurationTimer,
        );

        maximumDurationTimer =
          undefined;
      }

      const audioDuration =
        Date.now() -
        startedAt;

      /*
      Çok kısa sesleri işleme.
      */

      if (
        audioDuration <
        MINIMUM_AUDIO_DURATION_MS
      ) {
        cleanup();

        return;
      }

      /*
      Pipe sistemi FFmpeg tamamlandığında Python stdin'i
      otomatik kapatır. Python'un final sonucunu vermesi
      için kısa süre beklenir.
      */

      finalResultTimer =
        setTimeout(
          () => {
            if (
              cleanedUp ||
              receivedFinalResult
            ) {
              return;
            }

            console.warn(
              `⚠️ Konuşma sonucu alınamadı: ${member.user.tag}`,
            );

            cleanup();
          },
          FINAL_RESULT_WAIT_MS,
        );

      finalResultTimer.unref();
    },
  );

  /* =======================================================
     MAKSİMUM KONUŞMA SÜRESİ
  ======================================================= */

  maximumDurationTimer =
    setTimeout(
      () => {
        if (
          cleanedUp ||
          inputFinished
        ) {
          return;
        }

        console.warn(
          `⚠️ Maksimum konuşma süresi aşıldı: ${member.user.tag}`,
        );

        cleanup();
      },
      MAXIMUM_AUDIO_DURATION_MS,
    );

  maximumDurationTimer.unref();

  /* =======================================================
     SES VERİ HATTI
  ======================================================= */

  try {
    opusStream
      .pipe(
        opusDecoder,
      )
      .pipe(
        ffmpeg,
      )
      .pipe(
        pythonProcess.stdin,
      );
  } catch (
    error
  ) {
    if (
      !isBrokenPipeError(
        error,
      )
    ) {
      console.error(
        `❌ Ses veri hattı oluşturulamadı (${member.user.tag}):`,
        error,
      );
    }

    cleanup();
  }

  /*
  Python hemen kapanırsa model/yol hatasını daha anlaşılır
  şekilde göster.
  */

  setTimeout(
    () => {
      if (
        cleanedUp ||
        pythonReady
      ) {
        return;
      }

      if (
        pythonProcess.exitCode !==
        null
      ) {
        return;
      }

      console.warn(
        `⚠️ Python henüz hazır mesajı göndermedi: ${member.user.tag}`,
      );
    },
    5_000,
  ).unref();
}

/* =========================================================
   SES MODERASYONUNU BAŞLAT
========================================================= */

export function startSpeechModeration(
  connection:
    VoiceConnection,

  guild:
    Guild,
): void {
  if (
    attachedConnections.has(
      connection,
    )
  ) {
    return;
  }

  attachedConnections.add(
    connection,
  );

  connection.receiver
    .speaking.on(
      "start",
      (
        userId,
      ) => {
        void listenToUser(
          connection,
          guild,
          userId,
        ).catch(
          (
            error,
          ) => {
            console.error(
              `❌ Kullanıcı sesi dinlenemedi (${userId}):`,
              error,
            );
          },
        );
      },
    );

  console.log(
    `🎧 Ses moderasyonu dinleyicisi başlatıldı: ${guild.name}`,
  );
}

/* =========================================================
   SES MODERASYONUNU DURDUR
========================================================= */

export function stopSpeechModeration(
  guildId:
    string,
): void {
  for (
    const [
      userKey,
      activeStream,
    ] of [
      ...activeUsers.entries(),
    ]
  ) {
    if (
      !userKey.startsWith(
        `${guildId}:`,
      )
    ) {
      continue;
    }

    activeStream.cleanup();
  }

  /*
  Sunucuya ait eski cooldown kayıtlarını da temizle.
  */

  for (
    const key of [
      ...userCooldowns.keys(),
    ]
  ) {
    if (
      key.startsWith(
        `${guildId}:`,
      )
    ) {
      userCooldowns.delete(
        key,
      );
    }
  }

  console.log(
    `🛑 Ses moderasyonu durduruldu: ${guildId}`,
  );
}