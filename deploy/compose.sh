#!/bin/sh
# Picks whichever compose runtime is installed. Pass compose arguments through.
# OrbStack puts its CLI in ~/.orbstack/bin, which is not always on PATH.
PATH="$HOME/.orbstack/bin:$PATH"
if docker compose version >/dev/null 2>&1; then exec docker compose "$@"
elif command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then exec podman compose "$@"
elif command -v docker-compose >/dev/null 2>&1; then exec docker-compose "$@"
else
  echo "No container runtime found. On macOS, OrbStack is the lightest option: brew install --cask orbstack" >&2
  exit 1
fi
