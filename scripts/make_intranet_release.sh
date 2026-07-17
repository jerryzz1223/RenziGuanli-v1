#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ "${HRMS_ALLOW_DIRTY:-0}" != "1" ]]; then
	if ! git diff --quiet --ignore-submodules -- || ! git diff --cached --quiet --ignore-submodules --; then
		echo "Refusing to build an intranet release from a dirty worktree." >&2
		echo "Commit/stash your changes first, or rerun with HRMS_ALLOW_DIRTY=1 if you intentionally want HEAD only." >&2
		exit 1
	fi
fi

commit="$(git rev-parse --short HEAD)"
output_dir="$repo_root/dist"
output_file="$output_dir/hrms-intranet-$commit.zip"

mkdir -p "$output_dir"
rm -f "$output_file"

git archive --worktree-attributes --format=zip --output="$output_file" --prefix="hrms/" HEAD

echo "$output_file"
