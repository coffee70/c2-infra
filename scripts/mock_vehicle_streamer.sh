#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$PROJECT_ROOT/.venv/bin/python"

cd "$PROJECT_ROOT"

if [[ -x "$VENV_PYTHON" ]]; then
  "$VENV_PYTHON" scripts/mock_vehicle_streamer.py "$@"
else
  echo "Virtual environment not found. Run: python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt"
  exit 1
fi
