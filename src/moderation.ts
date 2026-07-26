import {
  GuildMember,
  PermissionFlagsBits,
} from "discord.js";

import {
  addWarning,
  getExemptRoleIds,
  getExemptUserIds,
  getVoiceModerationSettings,
  resetWarnings,
} from "./database.js";

/* =========================================================
   TÜRKÇE METİN NORMALLEŞTİRME
========================================================= */

function normalizeText(
  text: string,
): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ç", "c")
    .replaceAll("ğ", "g")
    .replaceAll("ı", "i")
    .replaceAll("ö", "o")
    .replaceAll("ş", "s")
    .replaceAll("ü", "u")
    .replace(
      /[^a-z0-9\s]/g,
      " ",
    )
    .replace(
      /\s+/g,
      " ",
    )
    .trim();
}

/* =========================================================
   KÜFÜR LİSTESİ
========================================================= */

/*
Çok kısa ve günlük kullanımda geçen kelimeler
yanlış tespit oluşturabilir.

Listeye eklediğin her kelime otomatik olarak
Türkçe karakterlerden arındırılır.
*/

const forbiddenWords =
  new Set<string>(
    [
      "amk",
      "aq",
      "amina",
      "amkoyim",
      "amkoyayim",
      "sik",
      "sikerim",
      "sikeyim",
      "siktir",
      "siktirgit",
      "orospu",
      "orospu cocugu",
      "pic",
      "yarrak",
      "yarak",
      "got",
      "gotveren",
      "ibne",
      "kahpe",
      "salak",
      "gerizekali",
      "mal",
      "aptal",
      "pezevenk",
      "serefsiz",
      "kaltak",
      "bok",
      "boktan",
    ].map(
      normalizeText,
    ),
  );

/* =========================================================
   YAZIM BOZMALARINI DÜZELTME
========================================================= */

function normalizeLeet(
  text: string,
): string {
  return text
    .replaceAll("0", "o")
    .replaceAll("1", "i")
    .replaceAll("3", "e")
    .replaceAll("4", "a")
    .replaceAll("5", "s")
    .replaceAll("7", "t");
}

function collapseRepeatedLetters(
  text: string,
): string {
  /*
  Örnek:
  "siiikkktir" -> "siktir"
  */

  return text.replace(
    /([a-z])\1{2,}/g,
    "$1",
  );
}

function prepareText(
  text: string,
): string {
  return collapseRepeatedLetters(
    normalizeLeet(
      normalizeText(
        text,
      ),
    ),
  );
}

/* =========================================================
   KÜFÜR TESPİTİ
========================================================= */

export interface ModerationMatch {
  matched: boolean;
  word?: string;
  normalizedText: string;
}

export function detectForbiddenSpeech(
  rawText: string,
): ModerationMatch {
  const normalizedText =
    prepareText(
      rawText,
    );

  if (!normalizedText) {
    return {
      matched: false,
      normalizedText,
    };
  }

  const words =
    normalizedText.split(
      " ",
    );

  /*
  Tek kelime kontrolü.
  */

  for (
    const word of words
  ) {
    if (
      forbiddenWords.has(
        word,
      )
    ) {
      return {
        matched: true,
        word,
        normalizedText,
      };
    }
  }

  /*
  İki kelimelik ifade kontrolü.
  Örnek: "orospu cocugu"
  */

  for (
    let index = 0;
    index <
    words.length - 1;
    index += 1
  ) {
    const phrase =
      `${words[index]} ${words[index + 1]}`;

    if (
      forbiddenWords.has(
        phrase,
      )
    ) {
      return {
        matched: true,
        word: phrase,
        normalizedText,
      };
    }
  }

  /*
  Boşluk ekleyerek söylenen veya yazılan
  ifadeleri kontrol eder.

  Örnek:
  "s i k t i r"
  */

  const joinedText =
    words.join("");

  for (
    const forbiddenWord
    of forbiddenWords
  ) {
    const joinedForbiddenWord =
      forbiddenWord.replaceAll(
        " ",
        "",
      );

    if (
      joinedForbiddenWord.length >=
        5 &&
      joinedText.includes(
        joinedForbiddenWord,
      )
    ) {
      return {
        matched: true,
        word:
          forbiddenWord,
        normalizedText,
      };
    }
  }

  return {
    matched: false,
    normalizedText,
  };
}

/* =========================================================
   MUAFİYET KONTROLÜ
========================================================= */

export interface ExemptionResult {
  exempt: boolean;
  reason?: string;
}

export function checkMemberExemption(
  member: GuildMember,
): ExemptionResult {
  if (member.user.bot) {
    return {
      exempt: true,
      reason:
        "Bot kullanıcıları moderasyondan muaftır.",
    };
  }

  if (
    member.id ===
    member.guild.ownerId
  ) {
    return {
      exempt: true,
      reason:
        "Sunucu sahibi moderasyondan muaftır.",
    };
  }

  const exemptUserIds =
    getExemptUserIds(
      member.guild.id,
    );

  if (
    exemptUserIds.includes(
      member.id,
    )
  ) {
    return {
      exempt: true,
      reason:
        "Kullanıcı muaf listesinde.",
    };
  }

  const exemptRoleIds =
    getExemptRoleIds(
      member.guild.id,
    );

  const exemptRole =
    member.roles.cache.find(
      (role) =>
        exemptRoleIds.includes(
          role.id,
        ),
    );

  if (exemptRole) {
    return {
      exempt: true,
      reason:
        `${exemptRole.name} rolü moderasyondan muaf.`,
    };
  }

  return {
    exempt: false,
  };
}

/* =========================================================
   MODERASYON SONUCU
========================================================= */

export type ModerationActionType =
  | "none"
  | "warning"
  | "timeout"
  | "exempt";

export interface ModerationActionResult {
  success: boolean;
  action: ModerationActionType;
  reason: string;
  matchedWord?: string;
  warningCount?: number;
  warningLimit?: number;
}

/* =========================================================
   SES MODERASYONU
========================================================= */

export async function moderateVoiceTranscript(
  member: GuildMember,
  transcript: string,
  confidence: number,
): Promise<ModerationActionResult> {
  const settings =
    getVoiceModerationSettings(
      member.guild.id,
    );

  if (!settings.enabled) {
    return {
      success: false,
      action: "none",
      reason:
        "Ses moderasyonu kapalı.",
    };
  }

  if (
    confidence <
    settings.minimumConfidence
  ) {
    return {
      success: false,
      action: "none",
      reason:
        `Güven skoru düşük: ${confidence.toFixed(2)}`,
    };
  }

  const match =
    detectForbiddenSpeech(
      transcript,
    );

  if (!match.matched) {
    return {
      success: false,
      action: "none",
      reason:
        "Küfür tespit edilmedi.",
    };
  }

  const exemption =
    checkMemberExemption(
      member,
    );

  if (exemption.exempt) {
    console.log(
      `🛡️ ${member.user.tag} moderasyondan muaf. ` +
      `Sebep: ${exemption.reason ?? "Bilinmiyor"} | ` +
      `Kelime: ${match.word ?? "Bilinmiyor"} | ` +
      `Güven: ${confidence.toFixed(2)}`,
    );

    return {
      success: false,
      action: "exempt",
      reason:
        exemption.reason ??
        "Kullanıcı moderasyondan muaf.",
      matchedWord:
        match.word,
    };
  }

  /*
  Küfür tespit edildiğinde uyarıyı artır.
  */

  const warningCount =
    addWarning(
      member.guild.id,
      member.id,
    );

  /*
  Uyarı limiti henüz dolmadıysa yalnızca
  uyarı kaydedilir.
  */

  if (
    warningCount <
    settings.warningLimit
  ) {
    console.log(
      `⚠️ ${member.user.tag} sesli kanal uyarısı aldı. ` +
      `Uyarı: ${warningCount}/${settings.warningLimit} | ` +
      `Kelime: ${match.word ?? "Bilinmiyor"} | ` +
      `Metin: ${match.normalizedText} | ` +
      `Güven: ${confidence.toFixed(2)}`,
    );

    return {
      success: true,
      action: "warning",
      reason:
        `${warningCount}/${settings.warningLimit} uyarı kaydedildi.`,
      matchedWord:
        match.word,
      warningCount,
      warningLimit:
        settings.warningLimit,
    };
  }

  /*
  Uyarı limiti doldu.
  Timeout uygulanmadan önce bot yetkileri
  ve rol sıralaması kontrol edilir.
  */

  const botMember =
    member.guild.members.me;

  if (!botMember) {
    return {
      success: false,
      action: "none",
      reason:
        "Botun sunucu üyeliği bulunamadı.",
      matchedWord:
        match.word,
      warningCount,
      warningLimit:
        settings.warningLimit,
    };
  }

  if (
    !botMember.permissions.has(
      PermissionFlagsBits.ModerateMembers,
    )
  ) {
    return {
      success: false,
      action: "none",
      reason:
        "Uyarı limiti doldu ancak botta Üyelere Zaman Aşımı Uygula yetkisi yok.",
      matchedWord:
        match.word,
      warningCount,
      warningLimit:
        settings.warningLimit,
    };
  }

  if (!member.moderatable) {
    return {
      success: false,
      action: "none",
      reason:
        "Uyarı limiti doldu ancak bu üyeye timeout uygulanamıyor. Rol sırasını kontrol et.",
      matchedWord:
        match.word,
      warningCount,
      warningLimit:
        settings.warningLimit,
    };
  }

  const timeoutMilliseconds =
    settings.timeoutMinutes *
    60 *
    1000;

  try {
    await member.timeout(
      timeoutMilliseconds,
      [
        "Sesli kanal uyarı limiti doldu.",
        `Uyarı: ${warningCount}/${settings.warningLimit}`,
        `Tespit: ${match.word ?? "Bilinmiyor"}`,
      ].join(" "),
    );

    /*
    Timeout başarılı olduktan sonra kullanıcının
    uyarı sayısı sıfırlanır.
    */

    resetWarnings(
      member.guild.id,
      member.id,
    );

    console.log(
      `🔇 ${member.user.tag} timeout aldı. ` +
      `Uyarı: ${warningCount}/${settings.warningLimit} | ` +
      `Süre: ${settings.timeoutMinutes} dakika | ` +
      `Kelime: ${match.word ?? "Bilinmiyor"} | ` +
      `Metin: ${match.normalizedText} | ` +
      `Güven: ${confidence.toFixed(2)}`,
    );

    return {
      success: true,
      action: "timeout",
      reason:
        `${settings.warningLimit} uyarıya ulaşıldı. ` +
        `${settings.timeoutMinutes} dakika timeout uygulandı ve uyarılar sıfırlandı.`,
      matchedWord:
        match.word,
      warningCount: 0,
      warningLimit:
        settings.warningLimit,
    };
  } catch (error) {
    console.error(
      `❌ ${member.user.tag} kullanıcısına timeout uygulanamadı:`,
      error,
    );

    /*
    Timeout başarısız olursa uyarıları silmiyoruz.
    Yetki veya rol sorunu düzeltildikten sonra
    sonraki tespitte tekrar denenebilir.
    */

    return {
      success: false,
      action: "none",
      reason:
        "Uyarı limiti doldu ancak timeout uygulanırken Discord hatası oluştu.",
      matchedWord:
        match.word,
      warningCount,
      warningLimit:
        settings.warningLimit,
    };
  }
}