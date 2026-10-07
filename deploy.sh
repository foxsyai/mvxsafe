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

# What goes live on mainnet must be what is on GitHub: no uncommitted changes,
# and a commit that origin/main already contains.
if [ "$NETWORK" = mainnet ]; then
  git diff --quiet HEAD -- || { echo "REFUSING: uncommitted changes. Commit and push first."; exit 1; }
  git fetch -q origin main
  git merge-base --is-ancestor HEAD origin/main ||
    { echo "REFUSING: $(git rev-parse --short HEAD) is not on origin/main. Push it first."; exit 1; }
fi

echo "Building for $NETWORK..."
pnpm "build-$NETWORK"

# The bundle has to say, twice and independently, that it is what we are about
# to publish: the marker the build writes from its config, and the network that
# was actually compiled into the code. A "mainnet" build used to be able to
# carry devnet when its steps raced (ops audit OPS-01 and OPS-03, 7 Oct 2026).
COMMIT="$(git rev-parse HEAD)"
read -r built_commit built_network < build/version.txt || true
[ "${built_network:-}" = "$NETWORK" ] ||
  { echo "REFUSING: build/ says it is a '${built_network:-}' build, not $NETWORK."; exit 1; }
[ "${built_commit:-}" = "$COMMIT" ] ||
  { echo "REFUSING: build/ is commit '${built_commit:-}', not $COMMIT."; exit 1; }
compiled="$(grep -ohE 'environment=[A-Za-z0-9_$]+\.(mainnet|devnet|testnet)' build/assets/index-*.js | head -1)"
case "$compiled" in
  *".$NETWORK") echo "build/ is ${COMMIT:0:7}, compiled for $NETWORK." ;;
  *) echo "REFUSING: the code in build/ was compiled for '${compiled:-nothing recognisable}', not $NETWORK."; exit 1 ;;
esac

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

# A 200 says nothing about WHICH build answered; the version file does.
live="$(curl -s "${URL}version.txt")"
[ "$live" = "$(cat build/version.txt)" ] ||
  { echo "The live site does not serve this build: version.txt says '$live'."; exit 1; }
echo "Live: ${COMMIT:0:7} on $NETWORK."

