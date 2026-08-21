#!/usr/bin/env bash
# summa installer — download a prebuilt binary (no cargo build).
#
#   curl -fsSL https://raw.githubusercontent.com/duyet/summa/master/install.sh | bash
#   curl -fsSL https://summa.duyet.net/install.sh | bash
#
# Env (must be set on the bash side of the pipe, not on curl):
#   curl -fsSL ... | SUMMA_SETUP_CRON=1 bash
#
#   SUMMA_INSTALL_DIR   Install directory (default: ~/.local/bin)
#   SUMMA_VERSION       Tag: v0.1.1, 0.1.1, nightly (default: stable, then nightly)
#   SUMMA_REPO          owner/repo (default: duyet/summa)
#   SUMMA_DOWNLOAD_BASE Override GitHub download prefix (CI / mirrors)
#   SUMMA_DRY_RUN=1     Print actions only; do not download/install
#   SUMMA_PREFIX        Alias for SUMMA_INSTALL_DIR (compat)
#   SUMMA_SETUP_CRON=1  Run `summa cronjob install` after the binary lands
#   SUMMA_CRON_EVERY    Scheduler interval (default: 1h)
#   SUMMA_TELEMETRY_ENDPOINT / SUMMA_TELEMETRY_TOKEN
set -euo pipefail

REPO="${SUMMA_REPO:-duyet/summa}"
BIN_NAME="summa"
INSTALL_DIR="${SUMMA_INSTALL_DIR:-${SUMMA_PREFIX:-${HOME}/.local/bin}}"
VERSION="${SUMMA_VERSION:-}"
DRY_RUN="${SUMMA_DRY_RUN:-0}"
DOWNLOAD_BASE="${SUMMA_DOWNLOAD_BASE:-https://github.com/${REPO}/releases/download}"
USER_AGENT="${SUMMA_USER_AGENT:-summa-install}"
NIGHTLY_TAG="nightly"

info()  { printf '==> %s\n' "$*"; }
warn()  { printf 'warn: %s\n' "$*" >&2; }
die()   { printf 'error: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

curl_get() {
  curl -fsSL -A "${USER_AGENT}" "$@"
}

detect_target() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    linux)  os="unknown-linux-gnu" ;;
    darwin) os="apple-darwin" ;;
    *) die "unsupported OS: $(uname -s). Build from source: cargo install summa-import" ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="x86_64" ;;
    aarch64|arm64) arch="aarch64" ;;
    *) die "unsupported architecture: $arch" ;;
  esac

  echo "${arch}-${os}"
}

normalize_version() {
  local v="$1"
  case "$v" in
    ""|nightly|latest) echo "$v" ;;
    v*) echo "$v" ;;
    *) echo "v${v}" ;;
  esac
}

asset_url() {
  local version="$1" asset="$2"
  echo "${DOWNLOAD_BASE}/${version}/${asset}.tar.gz"
}

# HEAD the tarball. GitHub returns 200 or a redirect (3xx).
asset_exists() {
  local url="$1" code
  code="$(curl -sS -A "${USER_AGENT}" -o /dev/null -w '%{http_code}' -L --head "$url" || true)"
  case "$code" in
    200|301|302|303|307|308) return 0 ;;
    *) return 1 ;;
  esac
}

latest_stable_tag() {
  local tag
  tag="$(curl_get "https://api.github.com/repos/${REPO}/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
    | head -n1 || true)"
  if [ -n "$tag" ]; then
    echo "$tag"
    return
  fi
  tag="$(curl -sSIL -A "${USER_AGENT}" "https://github.com/${REPO}/releases/latest" \
    | tr -d '\r' \
    | sed -n 's|^[Ll]ocation: .*/tag/\([^/]*\)$|\1|p' \
    | tail -n1 || true)"
  if [ -n "$tag" ]; then
    echo "$tag"
    return
  fi
  return 1
}

resolve_version() {
  local asset="$1" url tag
  if [ -n "$VERSION" ]; then
    VERSION="$(normalize_version "$VERSION")"
    url="$(asset_url "$VERSION" "$asset")"
    if [ "$DRY_RUN" = "1" ] || [ "$DRY_RUN" = "true" ]; then
      echo "$VERSION"
      return
    fi
    if asset_exists "$url"; then
      echo "$VERSION"
      return
    fi
    die "no binary at ${url}"
  fi

  if tag="$(latest_stable_tag)"; then
    tag="$(normalize_version "$tag")"
    url="$(asset_url "$tag" "$asset")"
    if asset_exists "$url"; then
      echo "$tag"
      return
    fi
    warn "stable ${tag} has no ${asset}.tar.gz — trying ${NIGHTLY_TAG}"
  else
    warn "no GitHub stable release — trying ${NIGHTLY_TAG}"
  fi

  url="$(asset_url "$NIGHTLY_TAG" "$asset")"
  if [ "$DRY_RUN" = "1" ] || [ "$DRY_RUN" = "true" ] || asset_exists "$url"; then
    echo "$NIGHTLY_TAG"
    return
  fi
  die "no prebuilt ${asset} on stable or ${NIGHTLY_TAG}. Wait for CI, or: summa update"
}

place_binary() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if command -v install >/dev/null 2>&1; then
    install -m 755 "$src" "$dest"
  else
    cp "$src" "$dest"
    chmod 755 "$dest"
  fi
}

main() {
  need_cmd uname
  need_cmd mkdir
  need_cmd tar
  need_cmd curl

  local target asset url tmp found
  target="$(detect_target)"
  asset="summa-${target}"
  VERSION="$(resolve_version "$asset")"
  url="$(asset_url "$VERSION" "$asset")"

  info "summa installer"
  info "  version : ${VERSION}"
  info "  target  : ${target}"
  info "  install : ${INSTALL_DIR}/${BIN_NAME}"
  info "  url     : ${url}"

  if [ "$DRY_RUN" = "1" ] || [ "$DRY_RUN" = "true" ]; then
    info "dry-run: would download and install ${BIN_NAME} → ${INSTALL_DIR}"
    mkdir -p "${INSTALL_DIR}"
    info "dry-run: install dir ready (${INSTALL_DIR})"
    exit 0
  fi

  tmp="$(mktemp -d "${TMPDIR:-/tmp}/summa-install.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf '${tmp}'" EXIT

  info "downloading…"
  if ! curl_get "$url" -o "${tmp}/summa.tar.gz"; then
    warn "release asset not found at ${url}"
    warn "No prebuilt binary for this platform/tag yet."
    warn "Options:"
    warn "  1) summa update          # newest CI artifact (needs gh auth or GITHUB_TOKEN)"
    warn "  2) Wait for the GitHub Release / nightly assets after CI"
    warn "Do not cargo build --release on this machine."
    exit 1
  fi

  tar -xzf "${tmp}/summa.tar.gz" -C "${tmp}"
  found="$(find "${tmp}" -type f -name "${BIN_NAME}" -print)"
  [ -n "$found" ] || die "archive did not contain ${BIN_NAME}"
  found="$(printf '%s\n' "$found" | awk 'NR==1 { print }')"

  place_binary "$found" "${INSTALL_DIR}/${BIN_NAME}"

  info "installed ${INSTALL_DIR}/${BIN_NAME}"
  if ! echo ":$PATH:" | grep -q ":${INSTALL_DIR}:"; then
    warn "${INSTALL_DIR} is not on PATH. Add:"
    warn "  export PATH=\"${INSTALL_DIR}:\$PATH\""
  fi

  if "${INSTALL_DIR}/${BIN_NAME}" --version >/dev/null 2>&1; then
    info "ok: $("${INSTALL_DIR}/${BIN_NAME}" --version 2>/dev/null || true)"
  fi

  local cfg_dir="${HOME}/.config/summa"
  mkdir -p "${cfg_dir}"
  if [ -n "${SUMMA_TELEMETRY_ENDPOINT:-}${SUMMA_TELEMETRY_TOKEN:-}" ]; then
    if ! grep -q '^\[telemetry\]' "${cfg_dir}/config.toml" 2>/dev/null; then
      {
        echo ""
        echo "[telemetry]"
        echo "endpoint = \"${SUMMA_TELEMETRY_ENDPOINT:-https://summa.duyet.net}\""
      } >> "${cfg_dir}/config.toml"
      info "telemetry endpoint written to ${cfg_dir}/config.toml"
    fi
    if [ -n "${SUMMA_TELEMETRY_TOKEN:-}" ]; then
      if ! grep -q '^telemetry_token' "${cfg_dir}/credentials.toml" 2>/dev/null; then
        printf 'telemetry_token = "%s"\n' "${SUMMA_TELEMETRY_TOKEN}" >> "${cfg_dir}/credentials.toml"
        chmod 600 "${cfg_dir}/credentials.toml" 2>/dev/null || true
        info "telemetry_token written to ${cfg_dir}/credentials.toml"
      fi
    fi
  fi

  if [ "${SUMMA_SETUP_CRON:-0}" = "1" ] || [ "${SUMMA_SETUP_CRON:-}" = "true" ]; then
    local every="${SUMMA_CRON_EVERY:-1h}"
    info "registering import scheduler (summa cronjob install --every ${every})"
    if "${INSTALL_DIR}/${BIN_NAME}" cronjob install --every "${every}"; then
      info "cron: $("${INSTALL_DIR}/${BIN_NAME}" cronjob status 2>/dev/null || true)"
    else
      warn "cronjob install failed; run later: summa cronjob install --every ${every}"
    fi
  else
    info "scheduler: summa cronjob install --every 1h"
  fi

  info "run: ${BIN_NAME} import --help"
}

main "$@"
