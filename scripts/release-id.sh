#!/usr/bin/env bash
# Prints the id of the GitHub release carrying $TAG, or nothing when there is none.
#
# Exists because a tag carrying two release objects is the failure mode that cost
# the 0.21.1 recut: the release/publish jobs split their uploads across the two,
# and a published release is immutable, so the split cannot be repaired. Both the
# job that creates the draft and the job that publishes it check through here.
#
# Usage: release-id.sh <repo> <tag> [--require]
#   --require  also fail when there is no release at all.
#
# Always fails when more than one release exists for the tag.
set -euo pipefail

repo="$1"
tag="$2"
require="${3:-}"

ids=$(gh api "repos/$repo/releases" --paginate \
  --jq ".[] | select(.tag_name == \"$tag\") | .id")
count=$(printf '%s' "$ids" | grep -c . || true)

if [ "$count" -gt 1 ]; then
  echo "::error::$count release objects exist for $tag: $(echo "$ids" | tr '\n' ' ')." >&2
  echo "::error::Delete the extra one before re-running, or its assets will never reach the published release." >&2
  exit 1
fi

if [ "$count" -eq 0 ] && [ "$require" = "--require" ]; then
  echo "::error::No release found for $tag." >&2
  exit 1
fi

printf '%s' "$ids"
