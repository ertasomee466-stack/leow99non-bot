import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

import { dirname, resolve } from "node:path";

export interface VoiceModerationSettings {
  enabled: boolean;
  minimumConfidence: number;
  timeoutMinutes: number;
  warningLimit: number;
}

export type CustomCommandType = "text" | "embed" | "button";

export interface CustomCommand {
  type: CustomCommandType;
  response?: string;
  title?: string;
  description?: string;
  color?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  footer?: string;
}

export interface BotDatabase {
  customCommands: Record<string, CustomCommand>;
  temporaryChannelIds: string[];
  voiceModeration: Record<string, VoiceModerationSettings>;
  warnings: Record<string, Record<string, number>>;
  exemptRoleIds: Record<string, string[]>;
  exemptUserIds: Record<string, string[]>;
}

const databasePath = resolve(
  process.cwd(),
  "data",
  "database.json",
);

const defaultVoiceModerationSettings: VoiceModerationSettings = {
  enabled: false,
  minimumConfidence: 0.8,
  timeoutMinutes: 10,
  warningLimit: 3,
};

function createDefaultDatabase(): BotDatabase {
  return {
    customCommands: {},
    temporaryChannelIds: [],
    voiceModeration: {},
    warnings: {},
    exemptRoleIds: {},
    exemptUserIds: {},
  };
}

function ensureDatabaseDirectory(): void {
  mkdirSync(dirname(databasePath), {
    recursive: true,
  });
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.filter(
        (item): item is string =>
          typeof item === "string" &&
          item.length > 0,
      ),
    ),
  ];
}

function normalizeStringArrayMap(
  value: unknown,
): Record<string, string[]> {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return {};
  }

  const result:
    Record<string, string[]> = {};

  for (
    const [
      guildId,
      entries,
    ] of Object.entries(value)
  ) {
    result[guildId] =
      uniqueStrings(entries);
  }

  return result;
}

function normalizeWarnings(
  value: unknown,
): Record<
  string,
  Record<string, number>
> {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return {};
  }

  const result:
    Record<
      string,
      Record<string, number>
    > = {};

  for (
    const [
      guildId,
      guildWarnings,
    ] of Object.entries(value)
  ) {
    if (
      !guildWarnings ||
      typeof guildWarnings !== "object"
    ) {
      continue;
    }

    const normalizedGuildWarnings:
      Record<string, number> = {};

    for (
      const [
        userId,
        warningCount,
      ] of Object.entries(
        guildWarnings,
      )
    ) {
      if (
        typeof warningCount === "number" &&
        Number.isFinite(
          warningCount,
        ) &&
        warningCount >= 0
      ) {
        normalizedGuildWarnings[
          userId
        ] = Math.floor(
          warningCount,
        );
      }
    }

    result[guildId] =
      normalizedGuildWarnings;
  }

  return result;
}

function normalizeVoiceModeration(
  value: unknown,
): Record<
  string,
  VoiceModerationSettings
> {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return {};
  }

  const result:
    Record<
      string,
      VoiceModerationSettings
    > = {};

  for (
    const [
      guildId,
      rawSettings,
    ] of Object.entries(value)
  ) {
    if (
      !rawSettings ||
      typeof rawSettings !== "object"
    ) {
      continue;
    }

    const settings =
      rawSettings as
        Partial<VoiceModerationSettings>;

    result[guildId] = {
      enabled:
        typeof settings.enabled ===
        "boolean"
          ? settings.enabled
          : defaultVoiceModerationSettings.enabled,

      minimumConfidence:
        typeof settings.minimumConfidence ===
          "number" &&
        Number.isFinite(
          settings.minimumConfidence,
        )
          ? Math.min(
              1,
              Math.max(
                0,
                settings.minimumConfidence,
              ),
            )
          : defaultVoiceModerationSettings.minimumConfidence,

      timeoutMinutes:
        typeof settings.timeoutMinutes ===
          "number" &&
        Number.isFinite(
          settings.timeoutMinutes,
        )
          ? Math.max(
              1,
              Math.floor(
                settings.timeoutMinutes,
              ),
            )
          : defaultVoiceModerationSettings.timeoutMinutes,

      warningLimit:
        typeof settings.warningLimit ===
          "number" &&
        Number.isFinite(
          settings.warningLimit,
        )
          ? Math.min(
              20,
              Math.max(
                1,
                Math.floor(
                  settings.warningLimit,
                ),
              ),
            )
          : defaultVoiceModerationSettings.warningLimit,
    };
  }

  return result;
}


function normalizeCustomCommands(
  value: unknown,
): Record<string, CustomCommand> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const result: Record<string, CustomCommand> = {};

  for (const [name, rawCommand] of Object.entries(value)) {
    // Eski sürümde komutlar yalnızca düz metin olarak saklanıyordu.
    if (typeof rawCommand === "string") {
      result[name] = {
        type: "text",
        response: rawCommand,
      };
      continue;
    }

    if (!rawCommand || typeof rawCommand !== "object") {
      continue;
    }

    const command = rawCommand as Partial<CustomCommand>;
    const type: CustomCommandType =
      command.type === "embed" || command.type === "button"
        ? command.type
        : "text";

    result[name] = {
      type,
      response: typeof command.response === "string" ? command.response : undefined,
      title: typeof command.title === "string" ? command.title : undefined,
      description:
        typeof command.description === "string" ? command.description : undefined,
      color: typeof command.color === "string" ? command.color : undefined,
      buttonLabel:
        typeof command.buttonLabel === "string" ? command.buttonLabel : undefined,
      buttonUrl:
        typeof command.buttonUrl === "string" ? command.buttonUrl : undefined,
      imageUrl:
        typeof command.imageUrl === "string" ? command.imageUrl : undefined,
      thumbnailUrl:
        typeof command.thumbnailUrl === "string" ? command.thumbnailUrl : undefined,
      footer: typeof command.footer === "string" ? command.footer : undefined,
    };
  }

  return result;
}

export function saveDatabase(
  currentDatabase: BotDatabase,
): void {
  try {
    ensureDatabaseDirectory();

    writeFileSync(
      databasePath,
      JSON.stringify(
        currentDatabase,
        null,
        2,
      ),
      "utf8",
    );
  } catch (error) {
    console.error(
      "❌ Veritabanı kaydedilemedi:",
      error,
    );
  }
}

export function loadDatabase():
  BotDatabase {
  try {
    ensureDatabaseDirectory();

    if (
      !existsSync(
        databasePath,
      )
    ) {
      const newDatabase =
        createDefaultDatabase();

      saveDatabase(
        newDatabase,
      );

      return newDatabase;
    }

    const content =
      readFileSync(
        databasePath,
        "utf8",
      );

    const parsed =
      JSON.parse(
        content,
      ) as Partial<BotDatabase>;

    return {
      customCommands: normalizeCustomCommands(
        parsed.customCommands,
      ),

      temporaryChannelIds:
        uniqueStrings(
          parsed.temporaryChannelIds,
        ),

      voiceModeration:
        normalizeVoiceModeration(
          parsed.voiceModeration,
        ),

      warnings:
        normalizeWarnings(
          parsed.warnings,
        ),

      exemptRoleIds:
        normalizeStringArrayMap(
          parsed.exemptRoleIds,
        ),

      exemptUserIds:
        normalizeStringArrayMap(
          parsed.exemptUserIds,
        ),
    };
  } catch (error) {
    console.error(
      "❌ Veritabanı okunamadı. Yeni veritabanı oluşturulacak:",
      error,
    );

    const newDatabase =
      createDefaultDatabase();

    saveDatabase(
      newDatabase,
    );

    return newDatabase;
  }
}

export const database =
  loadDatabase();

export function getVoiceModerationSettings(
  guildId: string,
): VoiceModerationSettings {
  return {
    ...defaultVoiceModerationSettings,
    ...database.voiceModeration[
      guildId
    ],
  };
}

export function setVoiceModerationSettings(
  guildId: string,
  settings:
    VoiceModerationSettings,
): void {
  database.voiceModeration[
    guildId
  ] = {
    enabled:
      settings.enabled,

    minimumConfidence:
      Math.min(
        1,
        Math.max(
          0,
          settings.minimumConfidence,
        ),
      ),

    timeoutMinutes:
      Math.max(
        1,
        Math.floor(
          settings.timeoutMinutes,
        ),
      ),

    warningLimit:
      Math.min(
        20,
        Math.max(
          1,
          Math.floor(
            settings.warningLimit,
          ),
        ),
      ),
  };

  saveDatabase(
    database,
  );
}

export function getWarningCount(
  guildId: string,
  userId: string,
): number {
  return (
    database.warnings[
      guildId
    ]?.[
      userId
    ] ?? 0
  );
}

export function addWarning(
  guildId: string,
  userId: string,
): number {
  database.warnings[
    guildId
  ] ??= {};

  const nextCount =
    (
      database.warnings[
        guildId
      ][
        userId
      ] ?? 0
    ) + 1;

  database.warnings[
    guildId
  ][
    userId
  ] = nextCount;

  saveDatabase(
    database,
  );

  return nextCount;
}

export function resetWarnings(
  guildId: string,
  userId: string,
): boolean {
  const guildWarnings =
    database.warnings[
      guildId
    ];

  if (
    !guildWarnings ||
    guildWarnings[
      userId
    ] === undefined
  ) {
    return false;
  }

  delete guildWarnings[
    userId
  ];

  if (
    Object.keys(
      guildWarnings,
    ).length === 0
  ) {
    delete database.warnings[
      guildId
    ];
  }

  saveDatabase(
    database,
  );

  return true;
}

export function getExemptRoleIds(
  guildId: string,
): string[] {
  return [
    ...(
      database.exemptRoleIds[
        guildId
      ] ?? []
    ),
  ];
}

export function addExemptRole(
  guildId: string,
  roleId: string,
): boolean {
  const roles =
    database.exemptRoleIds[
      guildId
    ] ?? [];

  if (
    roles.includes(
      roleId,
    )
  ) {
    return false;
  }

  database.exemptRoleIds[
    guildId
  ] = [
    ...roles,
    roleId,
  ];

  saveDatabase(
    database,
  );

  return true;
}

export function removeExemptRole(
  guildId: string,
  roleId: string,
): boolean {
  const roles =
    database.exemptRoleIds[
      guildId
    ] ?? [];

  if (
    !roles.includes(
      roleId,
    )
  ) {
    return false;
  }

  database.exemptRoleIds[
    guildId
  ] =
    roles.filter(
      (
        storedRoleId,
      ) =>
        storedRoleId !==
        roleId,
    );

  saveDatabase(
    database,
  );

  return true;
}

export function getExemptUserIds(
  guildId: string,
): string[] {
  return [
    ...(
      database.exemptUserIds[
        guildId
      ] ?? []
    ),
  ];
}

export function addExemptUser(
  guildId: string,
  userId: string,
): boolean {
  const users =
    database.exemptUserIds[
      guildId
    ] ?? [];

  if (
    users.includes(
      userId,
    )
  ) {
    return false;
  }

  database.exemptUserIds[
    guildId
  ] = [
    ...users,
    userId,
  ];

  saveDatabase(
    database,
  );

  return true;
}

export function removeExemptUser(
  guildId: string,
  userId: string,
): boolean {
  const users =
    database.exemptUserIds[
      guildId
    ] ?? [];

  if (
    !users.includes(
      userId,
    )
  ) {
    return false;
  }

  database.exemptUserIds[
    guildId
  ] =
    users.filter(
      (
        storedUserId,
      ) =>
        storedUserId !==
        userId,
    );

  saveDatabase(
    database,
  );

  return true;
}

export function addTemporaryChannel(
  channelId: string,
): void {
  if (
    database.temporaryChannelIds.includes(
      channelId,
    )
  ) {
    return;
  }

  database.temporaryChannelIds.push(
    channelId,
  );

  saveDatabase(
    database,
  );
}

export function removeTemporaryChannel(
  channelId: string,
): void {
  database.temporaryChannelIds =
    database.temporaryChannelIds.filter(
      (
        storedChannelId,
      ) =>
        storedChannelId !==
        channelId,
    );

  saveDatabase(
    database,
  );
}

export function setTemporaryChannels(
  channelIds: string[],
): void {
  database.temporaryChannelIds = [
    ...new Set(
      channelIds,
    ),
  ];

  saveDatabase(
    database,
  );
}

export function addCustomCommand(
  commandName: string,
  command: CustomCommand,
): void {
  database.customCommands[commandName] = command;
  saveDatabase(database);
}

export function removeCustomCommand(
  commandName: string,
): boolean {
  if (
    database.customCommands[
      commandName
    ] === undefined
  ) {
    return false;
  }

  delete database.customCommands[
    commandName
  ];

  saveDatabase(
    database,
  );

  return true;
}

export function getCustomCommand(
  commandName: string,
): CustomCommand | undefined {
  return database.customCommands[commandName];
}
