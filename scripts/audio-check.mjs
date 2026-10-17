// Planar Soundboard — which audio files are heavy for players to download. Pure: no Foundry globals.
// Every player downloads each file from the Foundry server; on a home server that shares the
// house upload, big or uncompressed files are what make everyone's connection lag.

/** Files above this size get flagged (bytes). */
export const HEAVY_BYTES = 8 * 1024 * 1024;

const UNCOMPRESSED = /\.(wav|flac|aiff?)(\?.*)?$/i;

/**
 * Why a file is heavy, or null if it's fine.
 * @param {string} path
 * @param {number|null} bytes  size from the server, if known
 * @returns {"uncompressed"|"large"|null}
 */
export function heaviness(path, bytes = null) {
  if (UNCOMPRESSED.test(String(path ?? ""))) return "uncompressed";
  if (Number.isFinite(bytes) && bytes > HEAVY_BYTES) return "large";
  return null;
}

/** "Rain.wav (34 MB)" for a warning. */
export function describeHeavy({ path, bytes }) {
  const name = decodeURIComponent(String(path).split("/").pop() ?? path);
  return Number.isFinite(bytes) ? `${name} (${Math.round(bytes / 1048576)} MB)` : name;
}
