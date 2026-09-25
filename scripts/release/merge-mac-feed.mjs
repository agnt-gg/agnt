#!/usr/bin/env node
/**
 * merge-mac-feed: one latest-mac.yml from the two Mac builds.
 *
 *   node scripts/release/merge-mac-feed.mjs <arm64/latest-mac.yml> <x64/latest-mac.yml> <out/latest-mac.yml>
 *
 * The Intel and Apple Silicon apps now build on separate runners (each must
 * rebuild its native modules on its own architecture), so each writes its own
 * feed. Uploading both would let the last writer win, as v0.6.6's feeds did.
 */
import fs from 'node:fs';
import { parseLatestYml, renderLatestYml, mergeMacFeeds } from './releaseLib.mjs';

const [a, b, out] = process.argv.slice(2);
if (!a || !b || !out) {
  console.error('usage: merge-mac-feed <arm64 latest-mac.yml> <x64 latest-mac.yml> <out>');
  process.exit(2);
}
const merged = mergeMacFeeds(parseLatestYml(fs.readFileSync(a, 'utf8')), parseLatestYml(fs.readFileSync(b, 'utf8')));
for (const want of ['-mac-arm64.zip', '-mac-x64.zip']) {
  if (!merged.files.some((f) => f.url.endsWith(want))) {
    console.error(`merge-mac-feed: merged feed has no *${want}`);
    process.exit(1);
  }
}
fs.writeFileSync(out, renderLatestYml(merged));
console.log(`merge-mac-feed: ${merged.files.length} files, version ${merged.version} -> ${out}`);
