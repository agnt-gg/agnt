# AGNT's standard operator interface; npm scripts remain the implementation.
# Mapping and intentional omissions: docs/JUSTFILE.md.
set shell := ["sh", "-eu", "-c"]
set positional-arguments
set dotenv-load := false

# List available recipes (also the default command).
help:
    @just --list

alias dev := dev-frontend
alias build := build-frontend

# Report local tool versions; not an application health or validation gate.
doctor:
    @just --version
    @node --version
    @npm --version
    @git --version

# Read backend health and verified checkout/Electron ownership; no restart.
status *args:
    @npm --silent run app:status -- "$@"

# Restart the verified Electron-owned backend; requires existing AGNT_AUTH_TOKEN.
restart-backend *args:
    @npm --silent run restart:backend -- "$@"

# Launch Electron and its backend; do not start a second running instance.
start *args:
    npm start -- "$@"

# Start foreground Vite with HMR (Ctrl+C stops it); does not launch a backend.
dev-frontend *args:
    npm run dev:frontend -- "$@"

# Start a standalone backend, NOT supervised restart; port must be free.
dev-backend *args:
    npm run dev -- "$@"

# Build frontend assets; reload the app afterward. Does not restart anything.
build-frontend *args:
    npm run build:frontend -- "$@"

# Build the frontend, then package Electron using the existing build lifecycle.
package *args: build-frontend
    npm run build -- "$@"

# Fast checks: tracked-file line endings and working/staged diff whitespace.
check:
    npm run eol:check
    git diff --check
    git diff --cached --check

# Run the default backend and frontend suites once each.
test: test-backend test-frontend

# Run backend Vitest; optional arguments select the task scope.
test-backend *args:
    npm test -- "$@"

# Run frontend Vitest; optional arguments select the task scope.
test-frontend *args:
    npm --prefix frontend test -- "$@"

# Test recipe routing with recording stubs; never start services or build.
test-recipes:
    node --test tests/unit/justfile.test.js

# Build frontend once, then run the tagged Playwright browser gate.
test-browser *args: build-frontend
    npm run test:e2e -- --grep @ci "$@"

# Local equivalent of blocking CI dimensions, without repeated expensive work.
ci: check test test-recipes test-browser

# Forward explicitly to npm worktree tooling; mutating subcommands stay explicit.
wt *args:
    npm run wt -- "$@"
