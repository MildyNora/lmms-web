#!/usr/bin/env bash
# Get LMMS's source at the tag this build is for, with its submodules, and apply the
# web build's patches (patches/*.patch, in order).
#
#   scripts/fetch-lmms.sh <directory>        (LMMS_TAG overrides the tag)
set -euo pipefail

HERE=$(cd "$(dirname "$0")/.." && pwd)
DEST=${1:?usage: fetch-lmms.sh <directory>}
TAG=${LMMS_TAG:-v1.3.0-alpha.2}

if [ ! -d "$DEST/.git" ]; then
	git clone --quiet --depth 1 --branch "$TAG" https://github.com/LMMS/lmms.git "$DEST"
	# All of them (LMMS's configure checks them all, the wiki included)
	git -C "$DEST" -c advice.detachedHead=false submodule update --init --recursive --depth 1 --jobs 8
fi

echo "LMMS $(git -C "$DEST" describe --tags --always) at $(git -C "$DEST" rev-parse HEAD)"
for patch in "$HERE"/patches/*.patch; do
	echo "Applying ${patch##*/}"
	git -C "$DEST" apply --whitespace=nowarn "$patch"
done
