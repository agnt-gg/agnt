/**
 * Client-side mirror of the marketplace's plugin version rule.
 *
 * The server is the authority (api.agnt.gg `libs/pluginVersionPolicy.js`).
 * This exists only so the Publish tab can disable the button and explain the
 * problem BEFORE uploading a multi-megabyte package and getting a 409 back.
 * Any disagreement resolves in the server's favour — this never permits an
 * upload the server would reject, only refuses one earlier.
 */

/** Minimal semver parse. Returns null for 'local' / 'latest' / '' / undefined. */
export function parsePluginSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3], prerelease: match[4] || '' };
}

/**
 * Can `localVersion` be published over `publishedVersion`?
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkPluginVersionPublishable(localVersion, publishedVersion) {
  const local = parsePluginSemver(localVersion);
  const published = parsePluginSemver(publishedVersion);

  if (!local || !published) {
    return {
      ok: false,
      reason: `Both versions must be semver to compare (installed "${localVersion}", published "${publishedVersion}").`,
    };
  }

  for (const key of ['major', 'minor', 'patch']) {
    if (local[key] !== published[key]) {
      return local[key] > published[key]
        ? { ok: true, reason: '' }
        : { ok: false, reason: `Installed v${localVersion} is older than the published v${publishedVersion}.` };
    }
  }

  // Same major.minor.patch — only the prerelease can differ.
  if (local.prerelease === published.prerelease) {
    return { ok: false, reason: `v${publishedVersion} is already published. Bump the version in manifest.json and rebuild the plugin.` };
  }
  if (local.prerelease && !published.prerelease) {
    return { ok: false, reason: `v${localVersion} is a prerelease of the already-published v${publishedVersion}.` };
  }
  // Release over prerelease, or a later prerelease identifier.
  if (!local.prerelease) return { ok: true, reason: '' };
  return local.prerelease > published.prerelease
    ? { ok: true, reason: '' }
    : { ok: false, reason: `Installed v${localVersion} is older than the published v${publishedVersion}.` };
}

export default { parsePluginSemver, checkPluginVersionPublishable };
