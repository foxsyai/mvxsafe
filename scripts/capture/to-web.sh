#!/usr/bin/env bash
# Turns the captured PNGs into the JPEGs the guide actually loads.
#
#   ./scripts/capture/to-web.sh
#
# The captures are 2732 wide because the browser runs at twice the scale, which
# is right for a retina screen and far too heavy for a page with nine pictures.
# Each one is halved and written as a JPEG; the PNG is kept out of the build by
# living in docs/shots-raw, so a picture can be re-cropped without a new capture.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHOTS="$HERE/public/shots"
RAW="$HERE/docs/shots-raw"
mkdir -p "$RAW"

shopt -s nullglob
for png in "$SHOTS"/*.png; do
  name="$(basename "$png" .png)"
  convert "$png" -resize 1366x -quality 82 -strip "$SHOTS/$name.jpg"
  mv "$png" "$RAW/$name.png"
  printf '%-26s %6s KB\n' "$name.jpg" "$(( $(stat -c %s "$SHOTS/$name.jpg") / 1024 ))"
done
