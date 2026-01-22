#!/bin/sh
# Docker entrypoint script for AGNT
# Ensures proper permissions on mounted volumes before starting the app

# Fix ownership of mounted volumes (they may be created as root by Docker)
# Only fix if running as root (which we do initially)
if [ "$(id -u)" = "0" ]; then
    echo "Fixing permissions on mounted volumes..."
    
    # Fix /app/data directory (database and logs)
    if [ -d "/app/data" ]; then
        chown -R node:node /app/data 2>/dev/null || true
    fi
    
    # Fix /app/logs directory
    if [ -d "/app/logs" ]; then
        chown -R node:node /app/logs 2>/dev/null || true
    fi
    
    # Fix plugin directories
    if [ -d "/app/backend/plugins/installed" ]; then
        chown -R node:node /app/backend/plugins/installed 2>/dev/null || true
    fi
    if [ -d "/app/backend/plugins/plugin-builds" ]; then
        chown -R node:node /app/backend/plugins/plugin-builds 2>/dev/null || true
    fi
    
    # Create _logs subdirectory if it doesn't exist
    mkdir -p /app/data/_logs 2>/dev/null || true
    chown -R node:node /app/data/_logs 2>/dev/null || true
    
    echo "Permissions fixed. Starting as node user..."
    
    # Switch to node user and execute the command
    exec su-exec node "$@"
else
    # Already running as non-root, just execute
    exec "$@"
fi
