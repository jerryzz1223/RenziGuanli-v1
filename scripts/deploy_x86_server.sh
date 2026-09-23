#!/usr/bin/env bash

# One-command local-to-x86 rootless-Podman deployment.
# Usage: ./scripts/deploy_x86_server.sh "feat: describe this update" [--skip-deps]

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
	cat >&2 <<'EOF'
Usage: ./scripts/deploy_x86_server.sh "commit message" [--skip-deps]

This command stages and commits every current local change, pushes main, then
deploys the existing rootless-Podman containers on the x86 server.

Use --skip-deps only when package.json, yarn.lock and pyproject.toml did not change.
EOF
	exit 2
fi

COMMIT_MESSAGE="$1"
INSTALL_DEPS=1
if [[ "${2:-}" == "--skip-deps" ]]; then
	INSTALL_DEPS=0
elif [[ $# -eq 2 ]]; then
	echo "Unknown option: $2" >&2
	exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REMOTE="${HRMS_X86_DEPLOY_REMOTE:-andrew@192.168.1.209}"
REMOTE_ROOT="${HRMS_X86_DEPLOY_ROOT:-/home/andrew/Renzi/RenziGuanli-v1}"
SITE_NAME="${HRMS_X86_DEPLOY_SITE:-hrms.localhost}"

cd "${PROJECT_ROOT}"

current_branch="$(git branch --show-current)"
if [[ "${current_branch}" != "main" ]]; then
	echo "Refusing deployment from branch ${current_branch:-detached HEAD}; switch to main first." >&2
	exit 1
fi

echo "Checking and publishing the local main branch..."
git diff --check
git pull --rebase --autostash origin main
git add -A
git diff --cached --check

if ! git diff --cached --quiet; then
	git commit -m "${COMMIT_MESSAGE}"
else
	echo "No new local changes to commit. Existing local commits will still be pushed."
fi
git push origin main

printf -v remote_root_q '%q' "${REMOTE_ROOT}"
printf -v site_name_q '%q' "${SITE_NAME}"

remote_command="set -euo pipefail; cd ${remote_root_q}; "
remote_command+='actual_arch=$(uname -m); case "$actual_arch" in x86_64|amd64) ;; *) echo "Architecture mismatch: expected x86_64/amd64, got $actual_arch" >&2; exit 21 ;; esac; '
remote_command+='if [[ "$(loginctl show-user "$USER" -p Linger --value)" != yes ]]; then echo "Rootless Podman linger is disabled. Run: sudo loginctl enable-linger $USER" >&2; exit 22; fi; '
remote_command+='if ! systemctl --user is-enabled podman-restart.service >/dev/null 2>&1; then echo "podman-restart.service is not enabled. Run: systemctl --user enable podman-restart.service" >&2; exit 23; fi; '
remote_command+="bash scripts/deploy_podman_x86.sh --pull --site ${site_name_q}"
if [[ ${INSTALL_DEPS} -eq 0 ]]; then
	remote_command+=" --skip-deps"
fi

echo "Deploying to ${REMOTE}:${REMOTE_ROOT}..."
ssh -tt "${REMOTE}" "bash -lc $(printf '%q' "${remote_command}")"
