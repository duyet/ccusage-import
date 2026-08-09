#!/usr/bin/env bash
# summa installer — install the prebuilt binary from GitHub Releases.
#
#   curl -fsSL https://raw.githubusercontent.com/duyet/summa/master/install.sh | bash
#
# Options (env):
#   SUMMA_INSTALL_DIR   Install directory (default: ~/.local/bin)
#   SUMMA_VERSION       Tag to install (default: latest release)
#   SUMMA_REPO          owner/repo (default: duyet/summa)
#   SUMMA_DRY_RUN=1     Print actions only; do not download/install
#   SUMMA_PREFIX        Alias for SUMMA_INSTALL_DIR (compat)
set -euo pipefail

REPO="${SUMMA_REPO:-duyet/summa}"
BIN_NAME="summa"
INSTALL_DIR="${SUMMA_INSTALL_DIR:-${SUMMA_PREFIX:-${HOME}/.local/bin}}"
VERSION="${SUMMA_VERSION:-}"
DRY_RUN="${SUMMA_DRY_RUN:-0}"

info()  { printf '==> %s\n' "$*"; }
warn()  { printf 'warn: %s\n' "$*" >&2; }
die()   { printf 'error: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
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

latest_tag() {
  # Prefer GitHub API; fall back to redirect of /releases/latest
  if command -v curl >/dev/null 2>&1; then
    local tag
    tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
      | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
      | head -n1)"
    if [ -n "$tag" ]; then
      echo "$tag"
      return
    fi
    tag="$(curl -fsSIL "https://github.com/${REPO}/releases/latest" 2>/dev/null \
      | tr -d '\r' \
      | sed -n 's|^[Ll]ocation: .*/tag/\([^/]*\)$|\1|p' \
      | tail -n1)"
    if [ -n "$tag" ]; then
      echo "$tag"
      return
    fi
  fi
  die "could not resolve latest release for ${REPO}"
}

main() {
  need_cmd uname
  need_cmd mkdir
  need_cmd tar
  need_cmd curl

  local target asset url tmp
  target="$(detect_target)"
  if [ -z "$VERSION" ]; then
    info "resolving latest release for ${REPO}"
    VERSION="$(latest_tag)"
  fi
  # Accept v0.1.0 or 0.1.0
  case "$VERSION" in
    v*) ;;
    *) VERSION="v${VERSION}" ;;
  esac

  asset="summa-${target}"
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}.tar.gz"

  info "summa installer"
  info "  version : ${VERSION}"
  info "  target  : ${target}"
  info "  install : ${INSTALL_DIR}/${BIN_NAME}"
  info "  url     : ${url}"

  if [ "$DRY_RUN" = "1" ] || [ "$DRY_RUN" = "true" ]; then
    info "dry-run: would download and install ${BIN_NAME} → ${INSTALL_DIR}"
    # Still verify script logic paths exist
    mkdir -p "${INSTALL_DIR}"
    info "dry-run: install dir ready (${INSTALL_DIR})"
    exit 0
  fi

  tmp="$(mktemp -d "${TMPDIR:-/tmp}/summa-install.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf '${tmp}'" EXIT

  info "downloading…"
  if ! curl -fsSL "$url" -o "${tmp}/summa.tar.gz"; then
    warn "release asset not found at ${url}"
    warn "No prebuilt binary for this platform/tag yet."
    warn "Options:"
    warn "  1) cargo install summa-import --locked"
    warn "  2) git clone https://github.com/${REPO}.git && cargo build --release"
    warn "  3) Wait for the first GitHub Release after merge of the release-please PR"
    exit 1
  fi

  tar -xzf "${tmp}/summa.tar.gz" -C "${tmp}"
  local found
  found="$(find "${tmp}" -type f -name "${BIN_NAME}" | head -n1)"
  [ -n "$found" ] || die "archive did not contain ${BIN_NAME}"

  mkdir -p "${INSTALL_DIR}"
  install -m 755 "$found" "${INSTALL_DIR}/${BIN_NAME}"

  info "installed ${INSTALL_DIR}/${BIN_NAME}"
  if ! echo ":$PATH:" | grep -q ":${INSTALL_DIR}:"; then
    warn "${INSTALL_DIR} is not on PATH. Add:"
    warn "  export PATH=\"${INSTALL_DIR}:\$PATH\""
  fi

  if "${INSTALL_DIR}/${BIN_NAME}" --version >/dev/null 2>&1; then
    info "ok: $("${INSTALL_DIR}/${BIN_NAME}" --version 2>/dev/null || true)"
  fi
  info "run: ${BIN_NAME} import --help"
}

main "$@"
