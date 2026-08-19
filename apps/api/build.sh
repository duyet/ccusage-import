#!/usr/bin/env bash
# Wrangler custom build. Keep env assignments here: wrangler splits
# `build.command` on spaces, so inline `RUSTFLAGS=…` in jsonc is not an env var.
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v worker-build >/dev/null 2>&1 || ! worker-build --version 2>/dev/null | grep -q '0.8.5'; then
  cargo install -q worker-build --version 0.8.5 --force
fi
export RUSTFLAGS="${RUSTFLAGS:-} -C target-feature=+reference-types"
# --force-enable-abort-handler (default) needs wasm EH + externref and fails
# wasm-bindgen 0.2.127 on current rustc. Panic recovery is optional for ingest.
exec worker-build --release --no-panic-recovery
