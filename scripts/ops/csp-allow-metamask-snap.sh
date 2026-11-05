#!/usr/bin/env bash
# Lets the MetaMask Snap's frame load on mvxsafe.io and devnet.mvxsafe.io: one
# origin added to frame-src in each site's own nginx file, nothing else.
#
#   sudo bash csp-allow-metamask-snap.sh            # on the droplet
#   sudo bash csp-allow-metamask-snap.sh --dry-run  # shows the change, writes nothing
#
# sdk-dapp opens the Snap in an iframe from the network's iframeWalletAddress:
# https://snap.multiversx.com for mainnet, https://devnet-snap.multiversx.com
# for devnet. Each site admits only its own. The frame's own requests fall
# under the frame's policy, not this one, so frame-src is the only directive
# that changes (checked in a browser on 5 Nov 2026, scripts/ops/snap-frame-check.mjs).
#
# Only these two files are read or written. `nginx -t` checks the whole config
# and a reload re-reads it, as any change here would; the other sites on this
# droplet keep their files as they are. Both files are backed up first, and
# put back if nginx refuses the result.
set -euo pipefail

SITES="${NGINX_SITES:-/etc/nginx/sites-available}"
BACKUP="${BACKUP_ROOT:-/root}/nginx-mvxsafe-$(date -u +%Y%m%dT%H%M%SZ)"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

WALLETCONNECT='frame-src https://verify.walletconnect.com https://verify.walletconnect.org'

# file, the site it must serve, the one origin it gets
CHANGES=(
  "mvxsafe.io mvxsafe.io https://snap.multiversx.com"
  "devnet.mvxsafe.io devnet.mvxsafe.io https://devnet-snap.multiversx.com"
)

fail() { echo "STOPPED: $*" >&2; exit 1; }

# Everything is checked before anything is written.
todo=0
for change in "${CHANGES[@]}"; do
  read -r file site origin <<<"$change"
  path="$SITES/$file"
  [ -f "$path" ] || fail "$path does not exist."
  grep -qE "^\s*server_name $site;" "$path" || fail "$path does not serve $site."
  [ "$(grep -c 'add_header Content-Security-Policy' "$path")" = 1 ] ||
    fail "$path has not exactly one Content-Security-Policy line."
  grep -qF "$WALLETCONNECT $origin;" "$path" && continue
  [ "$(grep -cF "$WALLETCONNECT;" "$path")" = 1 ] ||
    fail "$path does not have the frame-src this script expects: $WALLETCONNECT;"
  todo=1
done
[ "$todo" = 1 ] || { echo "Both sites already admit their Snap origin. Nothing to change."; exit 0; }

if [ "$DRY_RUN" = 0 ]; then
  mkdir -p "$BACKUP"
  for change in "${CHANGES[@]}"; do
    read -r file _ _ <<<"$change"
    cp -p "$SITES/$file" "$BACKUP/$file"
  done
  echo "Backed up to $BACKUP"
fi

for change in "${CHANGES[@]}"; do
  read -r file site origin <<<"$change"
  path="$SITES/$file"
  if grep -qF "$WALLETCONNECT $origin;" "$path"; then
    echo "$file already admits $origin."
    continue
  fi
  # An exact string swap, no pattern: the line is matched and rewritten as text.
  new="$(WC="$WALLETCONNECT;" NEW="$WALLETCONNECT $origin;" awk '
    { i = index($0, ENVIRON["WC"]) }
    i { $0 = substr($0, 1, i - 1) ENVIRON["NEW"] substr($0, i + length(ENVIRON["WC"])) }
    { print }' "$path")"
  diff -u --label "$file (now)" --label "$file (after)" "$path" <(printf '%s\n' "$new") || true
  if [ "$DRY_RUN" = 0 ]; then
    printf '%s\n' "$new" >"$path"
  fi
done

if [ "$DRY_RUN" = 1 ]; then
  echo "Dry run: nothing written."
  exit 0
fi
[ "${NO_RELOAD:-0}" = 1 ] && { echo "NO_RELOAD=1: files written, nginx not tested or reloaded."; exit 0; }

if ! nginx -t; then
  for change in "${CHANGES[@]}"; do
    read -r file _ _ <<<"$change"
    cp -p "$BACKUP/$file" "$SITES/$file"
  done
  fail "nginx -t refused the change. Both files are back as they were; nothing was reloaded."
fi
systemctl reload nginx
sleep 1

ok=1
for change in "${CHANGES[@]}"; do
  read -r _ site origin <<<"$change"
  live="$(curl -sI "https://$site/" | tr -d '\r' | grep -i '^content-security-policy:' | grep -oE 'frame-src [^;]*' || true)"
  echo "$site: $live"
  [ "$live" = "$WALLETCONNECT $origin" ] || ok=0
done
[ "$ok" = 1 ] || fail "a site does not serve the frame-src expected above. The backup is in $BACKUP."
echo "Done. To undo: cp -p $BACKUP/* $SITES/ && nginx -t && systemctl reload nginx"
