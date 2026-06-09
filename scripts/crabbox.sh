#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/crabbox.sh <command...>

Examples:
  scripts/crabbox.sh npm test
  scripts/crabbox.sh npm run test:e2e
  CRABBOX_SHELL=1 scripts/crabbox.sh "npm install && npm run test:e2e"

Environment:
  CRABBOX_BIN                 Crabbox binary path, default: crabbox
  CRABBOX_PROVIDER            Optional provider, for example aws or local-container
  CRABBOX_ID                  Optional lease id or slug to reuse
  CRABBOX_TTL                 Lease TTL, default: 120m
  CRABBOX_IDLE_TIMEOUT        Idle timeout, default: 60m
  CRABBOX_CLASS               Optional Crabbox class
  CRABBOX_FULL_RESYNC=1       Add --full-resync
  CRABBOX_NO_HYDRATE=1        Add --no-hydrate
  CRABBOX_PREFLIGHT=1         Add --preflight
  CRABBOX_DEBUG=1             Add --debug
  CRABBOX_KEEP_ON_FAILURE=1   Add --keep-on-failure
  CRABBOX_ALLOW_ENV=A,B       Forward allowlisted env vars
  CRABBOX_ENV_FROM_PROFILE    Forward env vars from a profile file
  CRABBOX_SHELL=1             Run command through Crabbox --shell
USAGE
}

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 64
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

crabbox_bin="${CRABBOX_BIN:-crabbox}"
args=(run --ttl "${CRABBOX_TTL:-120m}" --idle-timeout "${CRABBOX_IDLE_TIMEOUT:-60m}" --timing-json)

if [[ -n "${CRABBOX_PROVIDER:-}" ]]; then
  args+=(--provider "$CRABBOX_PROVIDER")
fi

if [[ -n "${CRABBOX_ID:-}" ]]; then
  args+=(--id "$CRABBOX_ID")
fi

if [[ -n "${CRABBOX_CLASS:-}" ]]; then
  args+=(--class "$CRABBOX_CLASS")
fi

if [[ "${CRABBOX_FULL_RESYNC:-}" == "1" ]]; then
  args+=(--full-resync)
fi

if [[ "${CRABBOX_NO_HYDRATE:-}" == "1" ]]; then
  args+=(--no-hydrate)
fi

if [[ "${CRABBOX_PREFLIGHT:-}" == "1" ]]; then
  args+=(--preflight)
fi

if [[ "${CRABBOX_DEBUG:-}" == "1" ]]; then
  args+=(--debug)
fi

if [[ "${CRABBOX_KEEP_ON_FAILURE:-}" == "1" ]]; then
  args+=(--keep-on-failure)
fi

if [[ -n "${CRABBOX_ENV_FROM_PROFILE:-}" ]]; then
  args+=(--env-from-profile "$CRABBOX_ENV_FROM_PROFILE")
fi

if [[ -n "${CRABBOX_ALLOW_ENV:-}" ]]; then
  IFS=',' read -r -a env_names <<< "$CRABBOX_ALLOW_ENV"
  for env_name in "${env_names[@]}"; do
    env_name="${env_name//[[:space:]]/}"
    if [[ -n "$env_name" ]]; then
      args+=(--allow-env "$env_name")
    fi
  done
fi

if [[ "${CRABBOX_SHELL:-}" == "1" ]]; then
  args+=(--shell -- "CI=${CI:-1} $*")
else
  args+=(-- env "CI=${CI:-1}" "$@")
fi

exec "$crabbox_bin" "${args[@]}"
