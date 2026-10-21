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

# What goes live must be what is on GitHub, on every network (both sites show
# their commit): no changed or untracked file (Vite copies all of public/ into
# the build), and a commit that origin/main already contains. The same gate as
# mvxvest.io's (its third audit, O4 and O5, 14 Oct 2026).
[ -z "$(git status --porcelain --untracked-files=all -- .)" ] || { echo "REFUSING: uncommitted changes. Commit and push first."; git status --short -- .; exit 1; }
git fetch -q origin main
git merge-base --is-ancestor HEAD origin/main ||
  { echo "REFUSING: $(git rev-parse --short HEAD) is not on origin/main. Push it first."; exit 1; }
# Any older commit of main passed the check above, so a stale checkout rolled
# the site back. The tip of origin/main is what a deploy means; an older commit
# only on purpose (ops audit OPX-02, 21 Oct 2026).
[ "${OLD_COMMIT:-}" = 1 ] || [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] ||
  { echo "REFUSING: $(git rev-parse --short HEAD) is behind origin/main ($(git rev-parse --short origin/main)). Pull first, or OLD_COMMIT=1 to ship an older commit on purpose."; exit 1; }
# git status does not list what .gitignore hides, and Vite copies all of
# public/ as it is: a *.pem or a screenshot there shipped under a clean
# commit's name (OPX-01). Nothing may sit there that is not in the commit.
stray="$(git ls-files --others --ignored --exclude-standard -- public index.html)"
[ -z "$stray" ] || { echo "REFUSING: files git ignores would ship from public/:"; echo "$stray" | sed 's/^/  /'; exit 1; }
# Nor is git status told about a tracked file flagged skip-worktree or
# assume-unchanged, which then ships changed (OPX-07).
flagged="$(git ls-files -v | grep -E '^[a-zS] ' || true)"
[ -z "$flagged" ] || { echo "REFUSING: files hidden from git status (skip-worktree / assume-unchanged):"; echo "$flagged" | sed 's/^/  /'; exit 1; }

# Exactly the locked dependencies, and nothing ships that fails lint or its
# tests, run against the network's own config.
pnpm install --frozen-lockfile
# No high advisory with a fix in what ships; pnpm-workspace.yaml lists the
# ones without (OPX-05).
pnpm audit --prod --audit-level=high
pnpm -s "copy-$NETWORK-config"
npx eslint src --max-warnings 0
npx jest --silent

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
# Every file lands under a temporary name and all are switched in together at
# the end, the old ones deleted after: a plain --delete removed the old bundle
# while the old index.html still named it, a blank page for whoever loaded the
# site during the upload (OPX-03).
rsync -a --delete --delay-updates --delete-delay build/ "$REMOTE:$DIR/"

code=$(curl -s -o /dev/null -w '%{http_code}' "$URL")
echo "$URL -> HTTP $code"
[ "$code" = "200" ] || { echo "The site did not answer 200."; exit 1; }

# A 200 says nothing about WHICH build answered; the version file does.
live="$(curl -s "${URL}version.txt")"
[ "$live" = "$(cat build/version.txt)" ] ||
  { echo "The live site does not serve this build: version.txt says '$live'."; exit 1; }
echo "Live: ${COMMIT:0:7} on $NETWORK."

