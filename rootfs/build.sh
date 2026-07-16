#!/usr/bin/env bash
# Build the sandbox rootfs images: base + the image-processing / data flavours.
#
# The flavours are `FROM kg-sandbox:base`, so base is built first. See
# docs/sandbox-flavours.md. Runs from anywhere (cd's to its own dir for context).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> kg-sandbox:base"
docker build -f Dockerfile -t kg-sandbox:base .

echo "==> kg-sandbox:image-processing"
docker build -f Dockerfile.image-processing -t kg-sandbox:image-processing .

echo "==> kg-sandbox:data"
docker build -f Dockerfile.data -t kg-sandbox:data .

echo "==> built:"
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep '^kg-sandbox:'
