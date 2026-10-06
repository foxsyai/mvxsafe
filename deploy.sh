#!/usr/bin/env bash
# Builds and ships mvxsafe.io to the websites droplet.
#
#   ./deploy.sh            # mainnet build  -> https://mvxsafe.io
#   ./deploy.sh devnet     # devnet build   -> https://devnet.mvxsafe.io
#
# The droplet serves nine other sites from the same nginx. This script only
# writes /var/www/mvxsafe.io and never touches the nginx config; that file is
# /etc/nginx/sites-available/mvxsafe.io and a copy of the whole tree from before
# this site existed is at /root/nginx-backup-20261006.tgz.
set -euo pipefail

NETWORK="${1:-mainnet}"
REMOTE="web@134.209.228.52"
REMOTE_DIR="/var/www/mvxsafe.io"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$NETWORK" in
  mainnet|devnet|testnet) ;;
  *) echo "Unknown network: $NETWORK (use mainnet, devnet or testnet)"; exit 1 ;;
esac

cd "$HERE"
echo "Building for $NETWORK..."
pnpm "build-$NETWORK"

# devnet goes to its own host, which exists so the whole cycle can be tried with
# play money; testnet is built but not published anywhere.
case "$NETWORK" in
  mainnet) DIR="$REMOTE_DIR"; URL="https://mvxsafe.io/" ;;
  devnet)  DIR="/var/www/devnet.mvxsafe.io"; URL="https://devnet.mvxsafe.io/" ;;
  *)
    echo
    echo "Built for $NETWORK. There is no host for it: the build is in ./build."
    exit 0
    ;;
esac

echo "Shipping to $REMOTE:$DIR ..."
rsync -a --delete build/ "$REMOTE:$DIR/"

code=$(curl -s -o /dev/null -w '%{http_code}' "$URL")
echo "$URL -> HTTP $code"
[ "$code" = "200" ] || { echo "The site did not answer 200."; exit 1; }
