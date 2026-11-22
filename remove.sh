#!/usr/bin/env bash
# Stop the Claude Studio (agy-claude-studio) watcher and restore Antigravity UI.
cd "$(dirname "$0")"
echo "Removing Claude Studio (agy-claude-studio)..."
node remove.js
