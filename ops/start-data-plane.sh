#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${1:-$ROOT/api/.data_store/ag-config/config.yaml}"
BIN="${AG_BINARY:-agentgateway}"
PY="$ROOT/api/.venv/bin/python"
[ -x "$PY" ] || PY="python3"

if [[ ! -f "$CONFIG" ]]; then
  echo "AG config not found: $CONFIG (apply a configuration from the admin console first)" >&2
  exit 1
fi

CERT="$("$PY" -c 'import certifi; print(certifi.where())')"
export SSL_CERT_FILE="$CERT"
cd "$(dirname "$CONFIG")"
exec "$BIN" -f "$(basename "$CONFIG")"
