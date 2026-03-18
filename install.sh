#!/usr/bin/env bash

set -euo pipefail

DEFAULT_REPO_URL="https://github.com/webrpc/ridl-vscode.git"
REPO_URL="${RIDL_VSCODE_REPO:-$DEFAULT_REPO_URL}"
TMP_ROOT="${TMPDIR:-/tmp}"
TMP_DIR="$(mktemp -d "${TMP_ROOT%/}/ridl-vscode-install.XXXXXX")"
CLONE_DIR="$TMP_DIR/repo"
if [[ -t 1 ]]; then
  COLOR_RESET=$'\033[0m'
  COLOR_INFO=$'\033[1;34m'
  COLOR_STEP=$'\033[1;36m'
  COLOR_SUCCESS=$'\033[1;32m'
  COLOR_ERROR=$'\033[1;31m'
else
  COLOR_RESET=''
  COLOR_INFO=''
  COLOR_STEP=''
  COLOR_SUCCESS=''
  COLOR_ERROR=''
fi

cleanup() {
  rm -rf "$TMP_DIR"
}

log_info() {
  printf "%s==>%s %s\n" "$COLOR_INFO" "$COLOR_RESET" "$1"
}

log_step() {
  printf "%s  ->%s %s\n" "$COLOR_STEP" "$COLOR_RESET" "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "%serror:%s required command '%s' was not found in PATH\n" "$COLOR_ERROR" "$COLOR_RESET" "$1" >&2
    exit 1
  fi
}

trap cleanup EXIT

require_command git
require_command npm
require_command code

log_info "Cloning repository"
log_step "$REPO_URL -> $CLONE_DIR"
git clone --depth 1 "$REPO_URL" "$CLONE_DIR"

cd "$CLONE_DIR"

log_info "Installing dependencies"
npm ci

log_info "Building extension package"
npm run package

log_info "Installing extension into VS Code"
npm run install:local

printf "%ssuccess:%s RIDL extension installed successfully\n" "$COLOR_SUCCESS" "$COLOR_RESET"
