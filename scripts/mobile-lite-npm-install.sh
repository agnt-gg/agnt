#!/usr/bin/env bash
# Install Capacitor deps for mobile-lite using public npm only.
# Strips any accidental JFrog/Artifactory URLs from package-lock.json first
# (those get written when a corporate mirror rewrites packument tarball hosts).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/mobile/mobile-lite"
cd "$DIR"

REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmjs.org/}"
export npm_config_registry="$REGISTRY"

if [[ -f package-lock.json ]] && grep -qE 'jfrog\.io|artifactory' package-lock.json; then
  echo "Sanitizing JFrog/Artifactory URLs out of package-lock.json → registry.npmjs.org"
  node <<'NODE'
const fs = require('fs');
const path = 'package-lock.json';
let s = fs.readFileSync(path, 'utf8');
s = s.replace(
  /https:\/\/[^"'\s]+jfrog\.io\/artifactory\/api\/npm\/npmjs\//g,
  'https://registry.npmjs.org/'
);
s = s.replace(
  /https:\/\/[^"'\s]+\/artifactory\/api\/npm\/[^/"'\s]+\//g,
  'https://registry.npmjs.org/'
);
fs.writeFileSync(path, s);
if (/jfrog\.io|artifactory/i.test(s)) {
  console.error('package-lock.json still references Artifactory after sanitize');
  process.exit(1);
}
NODE
fi

# Prefer lockfile install when present
if [[ -f package-lock.json ]]; then
  npm ci --registry="$REGISTRY" --no-fund --no-audit
else
  npm install --registry="$REGISTRY" --no-fund --no-audit
fi
