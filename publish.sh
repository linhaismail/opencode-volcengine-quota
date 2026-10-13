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
#   ./publish.sh pull           # git pull, then sync src/ -> live plugin dir
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

# Pull latest from git and sync the new source INTO the live plugin dir
# (reverse of the publish direction). Local-only changes in the plugin dir
# are backed up first so a pull never silently overwrites your edits.
if [ "${1:-}" = "pull" ]; then
  BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/quota-pull.XXXXXX")"
  DIRTY=0
  for f in "${FILES[@]}"; do
    if ! diff -q "$LOCAL_DIR/$f" "$PKG_DIR/src/$f" >/dev/null 2>&1; then
      cp "$LOCAL_DIR/$f" "$BACKUP_DIR/$f"
      echo "backed up local-only $f -> $BACKUP_DIR/$f"
      DIRTY=1
    fi
  done

  echo ">>> git pull"
  ( cd "$PKG_DIR" && git pull )

  for f in "${FILES[@]}"; do
    cp "$PKG_DIR/src/$f" "$LOCAL_DIR/$f"
    echo "synced src/$f -> live plugin dir"
  done

  ( cd "$PKG_DIR" && npm run typecheck )

  echo ">>> live plugin dir updated to $(git -C "$PKG_DIR" rev-parse --short HEAD)"
  if [ "$DIRTY" = "1" ]; then
    echo "NOTE: local-only plugin changes backed up to $BACKUP_DIR"
    echo "      restore with: cp $BACKUP_DIR/<file> $LOCAL_DIR/<file>"
  fi
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
