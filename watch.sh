#!/usr/bin/env bash
# Start the Claude Studio (agy-claude-studio) background watcher.
cd "$(dirname "$0")"
nohup node "$PWD/inject.js" --watch --replace >/dev/null 2>>watch.log </dev/null &
echo "Claude Studio (agy-claude-studio) watcher started (PID $!)"
