#!/usr/bin/env bash
# Makes git tags match npm before semantic-release runs, so a failed release can simply run again.
set -euo pipefail
name=$(node -p "require('./package.json').name")
# Is this version on npm? Fails the step on anything but a clear yes or not found.
published() {
  # The version endpoint is current right after a publish; the full package document can lag for minutes.
  local status
  status=$(curl -sS -o /dev/null -w '%{http_code}' "https://registry.npmjs.org/$name/$1") || status=error
  case "$status" in
    200) return 0 ;;
    404) return 1 ;;
    *) echo "Could not check npm for $name@$1 (HTTP $status)" >&2; exit 1 ;;
  esac
}
latest=$(git tag --list 'v*' --sort=-v:refname | grep -vx 'v0.0.0' | head -n 1 || true)
if [ -n "$latest" ] && ! published "${latest#v}"; then
  echo "$latest was tagged but never published; removing it so the release runs again."
  git push origin ":refs/tags/$latest"
  git tag -d "$latest"
fi
git fetch origin '+refs/notes/*:refs/notes/*' || true
for ref in $(git for-each-ref --format='%(refname)' 'refs/notes/semantic-release-v*'); do
  tag="${ref#refs/notes/semantic-release-}"
  if [ -z "$(git tag --list "$tag")" ]; then
    echo "Removing $ref, left behind by a tag that no longer exists."
    git push origin ":$ref"
    git update-ref -d "$ref"
  fi
done
if [ -z "$(git tag --list 'v*')" ]; then
  git tag v0.0.0 "$(git rev-list --max-parents=0 HEAD)"
  git push origin v0.0.0
fi
