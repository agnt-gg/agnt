#!/bin/sh
# Docker entrypoint script for AGNT
# Ensures proper permissions on mounted volumes before starting the app

# Fix ownership of mounted volumes (they may be created as root by Docker)
# Only fix if running as root (which we do initially)
if [ "$(id -u)" = "0" ]; then
    echo "Fixing permissions on mounted volumes..."
    
    # Fix /app/data directory (USER_DATA_PATH - database, plugins, and registry)
    if [ -d "/app/data" ]; then
        chown -R node:node /app/data 2>/dev/null || true
    fi
    
    # Fix /app/logs directory
    if [ -d "/app/logs" ]; then
        chown -R node:node /app/logs 2>/dev/null || true
    fi
    
    # Create required subdirectories in /app/data (USER_DATA_PATH)
    # These are where PluginManager and PluginInstaller look for plugins
    mkdir -p /app/data/_logs 2>/dev/null || true
    mkdir -p /app/data/plugins/installed 2>/dev/null || true
    mkdir -p /app/data/plugins/.temp 2>/dev/null || true
    mkdir -p /app/data/Data 2>/dev/null || true
    chown -R node:node /app/data 2>/dev/null || true
    
    echo "Permissions fixed. Starting as node user..."
    
    # Switch to node user and execute the command
    exec su-exec node "$@"
else
    # Already running as non-root, just execute
    exec "$@"
fi
