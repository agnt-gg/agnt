#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEFAULT_RUNTIME_DIR="${HOME}/services/agnt-runtime"
RUNTIME_DIR="${1:-${AGNT_RUNTIME_DIR:-${DEFAULT_RUNTIME_DIR}}}"
DATA_DIR_SOURCE="${AGNT_DATA_DIR:-${ROOT_DIR}/data}"

log() {
  printf "\n[%s] %s\n" "deploy-runtime" "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

copy_dir() {
  local src="$1"
  local dest="$2"

  if [[ ! -d "$src" ]]; then
    return 0
  fi

  mkdir -p "$dest"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a "$src/" "$dest/"
  else
    # Fallback if rsync isn't available
    cp -a "$src/." "$dest/"
  fi
}

log "Repository root: $ROOT_DIR"
log "Runtime directory: $RUNTIME_DIR"
log "Shared data directory: $DATA_DIR_SOURCE"

require_cmd git
require_cmd npm
require_cmd node

log "Preparing runtime worktree"
if [[ -d "$RUNTIME_DIR" ]]; then
  # Remove the existing worktree if it is registered. Ignore errors so we can re-add cleanly.
  git -C "$ROOT_DIR" worktree remove --force "$RUNTIME_DIR" 2>/dev/null || true
  rm -rf "$RUNTIME_DIR"
fi

git -C "$ROOT_DIR" worktree add "$RUNTIME_DIR" HEAD

log "Linking shared data directory"
if [[ -d "$DATA_DIR_SOURCE" ]]; then
  rm -rf "$RUNTIME_DIR/data"
  ln -s "$DATA_DIR_SOURCE" "$RUNTIME_DIR/data"
fi

log "Syncing dependencies"
copy_dir "$ROOT_DIR/node_modules" "$RUNTIME_DIR/node_modules"
copy_dir "$ROOT_DIR/frontend/node_modules" "$RUNTIME_DIR/frontend/node_modules"

# If frontend node_modules wasn't present in the source tree, install it in runtime.
if [[ ! -d "$RUNTIME_DIR/frontend/node_modules" ]]; then
  log "Installing frontend dependencies in runtime"
  (cd "$RUNTIME_DIR/frontend" && npm install)
fi

if [[ -f "$ROOT_DIR/.env" ]]; then
  log "Copying .env"
  cp -f "$ROOT_DIR/.env" "$RUNTIME_DIR/.env"
fi

if command -v systemctl >/dev/null 2>&1; then
  log "Reloading and restarting user services"
  systemctl --user daemon-reload || true
  systemctl --user restart agnt-backend.service agnt-frontend.service
fi

log "Done"
log "Tip: check logs with 'journalctl --user -u agnt-backend -f'"
