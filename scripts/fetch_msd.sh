#!/usr/bin/env bash
# Medical Segmentation Decathlon Task01_BrainTumour (CC-BY-SA 4.0). Resumable.
set -euo pipefail
DEST="${1:-data}"
URL="https://msd-for-monai.s3-us-west-2.amazonaws.com/Task01_BrainTumour.tar"
mkdir -p "$DEST"
curl -fL -C - -o "$DEST/Task01_BrainTumour.tar" "$URL"
tar -xf "$DEST/Task01_BrainTumour.tar" -C "$DEST"
find "$DEST/Task01_BrainTumour" -name '._*' -delete      # macOS resource forks shipped in the tar
echo "imagesTr: $(ls "$DEST/Task01_BrainTumour/imagesTr" | wc -l | tr -d ' ') files"
