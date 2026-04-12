#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KSY_DIR="$ROOT_DIR/satnogs_adapter/decoders/ksy"
OUT_DIR="$ROOT_DIR/satnogs_adapter/decoders/generated"

if ! command -v kaitai-struct-compiler >/dev/null 2>&1; then
  echo "kaitai-struct-compiler is required to regenerate satnogs_adapter/decoders/generated/*.py" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

find "$KSY_DIR" -type f -name '*.ksy' | sort | while IFS= read -r schema; do
  kaitai-struct-compiler \
    --target python \
    --python-package satnogs_adapter.decoders.generated \
    --outdir "$OUT_DIR" \
    "$schema"
done
