#!/usr/bin/env bash
set -euo pipefail

env_file="${1:-.env.local}"

if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file. Save your populated secrets file there, then rerun npm run secrets:fill." >&2
  exit 1
fi

replace_empty() {
  local name="$1"
  local bytes="$2"
  local value
  value="$(openssl rand -base64 "$bytes" | tr -d '\n')"

  if grep -q "^${name}=$" "$env_file"; then
    NAME="$name" VALUE="$value" perl -0pi -e 's/^\Q$ENV{NAME}\E=$/$ENV{NAME}=$ENV{VALUE}/m' "$env_file"
  elif ! grep -q "^${name}=" "$env_file"; then
    printf '\n%s=%s\n' "$name" "$value" >> "$env_file"
  fi
}

replace_empty APP_ENCRYPTION_KEY 32
replace_empty PII_HMAC_KEY 32
replace_empty INTERNAL_TOKEN_SIGNING_KEY 48
replace_empty CRON_SECRET 32

chmod 600 "$env_file"
echo "Security secrets initialized in $env_file without displaying their values."
