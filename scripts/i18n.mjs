// Planar Soundboard — localization helpers. Every string a user reads lives in lang/*.json
// under PLANAR_SOUNDBOARD.*; code refers to it by the key without the prefix.

export const I18N = "PLANAR_SOUNDBOARD";

/** Full key, for places Foundry localizes itself (setting and keybinding names). */
export const key = k => `${I18N}.${k}`;

/** Localize a key; with data, fill its {placeholders}. */
export function t(k, data) {
  const full = key(k);
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

const notify = level => (k, data) => ui.notifications?.[level](`${t("Title")}: ${t(k, data)}`);

export const info = notify("info");
export const warn = notify("warn");
export const error = notify("error");
