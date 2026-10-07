#!/usr/bin/env bash
# One-click publish: sync the local dev plugin into the npm package, bump the
# version, typecheck, and publish.
#
# Usage:
#   ./publish.sh                # bump patch (1.0.0 -> 1.0.1) and publish
#   ./publish.sh minor          # bump minor (1.0.0 -> 1.1.0)
#   ./publish.sh major          # bump major (1.0.0 -> 2.0.0)
#   ./publish.sh 1.2.3          # set exact version and publish
#   ./publish.sh --dry-run      # sync only, no version bump / publish
set -euo pipefail

LOCAL_DIR="$HOME/.config/opencode/plugins/volcengine-quota"
PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILES=(index.ts tui.ts usage.ts)

if [ "${1:-}" = "--dry-run" ]; then
  for f in "${FILES[@]}"; do
    cp "$LOCAL_DIR/$f" "$PKG_DIR/src/$f"
    echo "synced $f"
  done
  echo "dry-run: local -> $PKG_DIR/src (no version bump, no publish)"
  exit 0
fi

# 1. sync source from the live dev plugin
for f in "${FILES[@]}"; do
  cp "$LOCAL_DIR/$f" "$PKG_DIR/src/$f"
  echo "synced $f"
done

cd "$PKG_DIR"

# 2. bump version (patch default; pass minor/major/exact)
BUMP="${1:-patch}"
if [ -n "$BUMP" ] && [[ "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  npm version "$BUMP" --no-git-tag-version
else
  npm version "$BUMP" --no-git-tag-version --allow-same-version
fi
VERSION="$(node -p "require('./package.json').version")"
echo ">>> version -> $VERSION"

# 3. typecheck before publishing
npm run typecheck

# 4. publish
npm publish
echo ">>> published opencode-volcengine-quota@$VERSION"
