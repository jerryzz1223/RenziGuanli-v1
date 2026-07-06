#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

commit="$(git rev-parse --short HEAD)"
output_dir="$repo_root/dist"
output_file="$output_dir/hrms-intranet-$commit.zip"

mkdir -p "$output_dir"
rm -f "$output_file"

git archive --worktree-attributes --format=zip --output="$output_file" --prefix="hrms/" HEAD

echo "$output_file"
