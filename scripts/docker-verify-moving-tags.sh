#!/usr/bin/env bash
# Assert that every moving tag of the full image points at one release.
#
#   scripts/docker-verify-moving-tags.sh <image> <version>
#   e.g. scripts/docker-verify-moving-tags.sh ghcr.io/agnt-gg/agnt 0.6.6
#
# Why this exists: README, docker-compose.yml and the website all tell users
# to pull :latest. Deleting a package version on GHCR also deletes every tag
# on it, so a rollback that removes a release silently takes :latest with it
# and every documented install fails with "manifest unknown". Publishing is
# not proof; this reads the registry back and fails if any tag is missing or
# points anywhere other than <version>.
set -euo pipefail

IMG="${1:?usage: $0 <image> <version>}"
VERSION="${2:?usage: $0 <image> <version>}"
VERSION="${VERSION#v}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::version must be X.Y.Z, got '$VERSION'" >&2
  exit 2
fi
MAJMIN="${VERSION%.*}"

digest_of() {
  local output digest
  # The top-level "Digest:" line is the index digest. Read the plain output:
  # --format templates silently print nothing on some buildx builds.
  # Capture first, parse second: piping straight into an early-exiting awk
  # SIGPIPEs buildx and, under pipefail, fails at random.
  output="$(docker buildx imagetools inspect "$IMG:$1" 2>&1)" || return 1
  digest="$(awk '/^Digest:/ {print $2; exit}' <<<"$output")"
  [[ "$digest" == sha256:* ]] || return 1
  echo "$digest"
}

expected="$(digest_of "$VERSION")" || { echo "::error::$IMG:$VERSION does not exist" >&2; exit 1; }
echo "$IMG:$VERSION = $expected"

failed=0
for tag in latest full "$VERSION-full" "$MAJMIN" "$MAJMIN-full"; do
  actual="$(digest_of "$tag" || true)"
  if [[ "$actual" == "$expected" ]]; then
    echo "ok   $IMG:$tag"
  else
    echo "::error::$IMG:$tag is '${actual:-missing}', expected $expected" >&2
    failed=1
  fi
done
exit "$failed"
