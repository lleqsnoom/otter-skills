#!/usr/bin/env bash
# x-walkthrough template — the library above the STAGES marker is identical in
# every generated walkthrough; never hand-edit it. Author stages below the
# marker only, then `bash -n` the result.
set -euo pipefail

TOTAL_STAGES=0
CURRENT=0

say()  { printf '%s\n' "$*"; }
step() { printf '\n  \033[2m(step %d/%d)\033[0m %s\n' "$CURRENT" "$TOTAL_STAGES" "$*"; }

stage() {
  CURRENT=$((CURRENT + 1))
  CURRENT_STAGE="$1"
  clear
  say "── [$CURRENT/$TOTAL_STAGES] $1 ──────────────────────────"
}

open_url() {
  local url="$1"
  say "  Open: $url"
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$url" >/dev/null 2>&1 || true
  elif command -v start >/dev/null 2>&1; then start "$url" >/dev/null 2>&1 || true
  else say "  (open the URL above manually)"; fi
}

ask() {
  local prompt="$1" var="$2"
  read -r -p "  $prompt: " "$var"
}

ask_secret() {
  local prompt="$1" var="$2"
  read -r -s -p "  $prompt (hidden): " "$var"; say ""
}

write_env() {
  local file="$1" key="$2" value="$3"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "$file.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

set_secret() { write_env "$1" "$2" "$3"; }   # for CI-secret flows, override per target
set_var()    { write_env "$1" "$2" "$3"; }

pause() { read -r -p "  Press Enter when done..." _; }

confirm() {
  read -r -p "  $1 [y/N] " _reply
  [[ "$_reply" == "y" || "$_reply" == "Y" ]]
}

summary() {
  say ""
  say "── Done ─────────────────────────────"
  say "  Captured: $1"
}

# ── STAGES ──────────────────────────────────────────────────────────────────
# Author below this marker. One `stage "name"` per focused human task; open
# the URL before asking for its value; ask_secret for anything secret;
# confirm before any irreversible action.

TOTAL_STAGES=1

stage "Example — capture an API key"
open_url "https://example.com/settings/api-keys"
step "create a key named for this project"
ask_secret "paste the API key" KEY
write_env ".env" EXAMPLE_API_KEY "$KEY"
summary "EXAMPLE_API_KEY in .env"
