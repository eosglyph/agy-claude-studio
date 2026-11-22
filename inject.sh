#!/usr/bin/env bash
# Inject Claude Studio (agy-claude-studio) into Antigravity windows once.
cd "$(dirname "$0")"
echo "Injecting Claude Studio (agy-claude-studio)..."
node inject.js
