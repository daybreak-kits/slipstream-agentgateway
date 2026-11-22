#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${1:-$ROOT/api/.data_store/ag-config/config.yaml}"
BIN="${AG_BINARY:-agentgateway}"

if [[ ! -f "$CONFIG" ]]; then
  echo "AG config not found: $CONFIG (apply a configuration from the admin console first)" >&2
  exit 1
fi

cd "$(dirname "$CONFIG")"
exec "$BIN" -f "$(basename "$CONFIG")"
