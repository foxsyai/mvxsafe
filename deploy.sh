#!/usr/bin/env bash
# Builds and ships mvxsafe.io to the websites droplet.
#
#   ./deploy.sh            # mainnet build, the live site
#   ./deploy.sh devnet     # devnet build, for testing against a throwaway safe
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

if [ "$NETWORK" != "mainnet" ]; then
  echo
  echo "Refusing to publish a $NETWORK build to the live site."
  echo "The build is in ./build if you want to serve it somewhere else."
  exit 0
fi

echo "Shipping to $REMOTE:$REMOTE_DIR ..."
rsync -a --delete build/ "$REMOTE:$REMOTE_DIR/"

code=$(curl -s -o /dev/null -w '%{http_code}' https://mvxsafe.io/)
echo "https://mvxsafe.io/ -> HTTP $code"
[ "$code" = "200" ] || { echo "The site did not answer 200."; exit 1; }
