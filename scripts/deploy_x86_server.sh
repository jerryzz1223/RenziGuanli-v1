#!/usr/bin/env bash

# Publish the current main branch and deploy it to the x86 rootless-Podman server.
# Usage: ./scripts/deploy_x86_server.sh ["feat: describe staged update"] [--skip-deps]

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: ./scripts/deploy_x86_server.sh ["commit message"] [--skip-deps]

With a commit message, this command commits only files that you explicitly
staged with git add. Without a commit message, it deploys the current committed
main branch. It never stages working-tree files automatically.

Use --skip-deps only when package.json, yarn.lock and pyproject.toml did not change.
EOF
}

COMMIT_MESSAGE=""
INSTALL_DEPS=1
while [[ $# -gt 0 ]]; do
	case "$1" in
		--skip-deps) INSTALL_DEPS=0 ;;
		-h|--help) usage; exit 0 ;;
		--*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
		*)
			if [[ -n "${COMMIT_MESSAGE}" ]]; then
				echo "Only one commit message may be provided." >&2
				usage >&2
				exit 2
			fi
			COMMIT_MESSAGE="$1"
			;;
	esac
	shift
done

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

echo "Checking the local main branch..."
git diff --check
git diff --cached --check

echo "Refreshing origin/main without changing local files..."
git fetch origin main
if ! git merge-base --is-ancestor origin/main HEAD; then
	echo "Local main is behind or diverged from origin/main." >&2
	echo "Resolve it with git pull --rebase before deploying; local files were not changed." >&2
	exit 1
fi

if [[ -n "${COMMIT_MESSAGE}" ]]; then
	if git diff --cached --quiet; then
		echo "No staged changes to commit." >&2
		echo "Stage only the intended files with git add, or omit the commit message to deploy existing commits." >&2
		exit 1
	fi
	echo "Files selected for this deployment commit:"
	git diff --cached --name-only
	git commit -m "${COMMIT_MESSAGE}"
elif ! git diff --cached --quiet; then
	echo "Staged changes exist but no commit message was provided." >&2
	echo "Provide a commit message, or unstage them before deploying existing commits." >&2
	exit 1
fi

echo "Publishing main..."
git push origin main
PUBLISHED_COMMIT="$(git rev-parse HEAD)"
PUBLISHED_COMMIT_SHORT="$(git rev-parse --short HEAD)"
printf -v published_commit_q '%q' "${PUBLISHED_COMMIT}"

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
remote_command+='; deployed_commit=$(git rev-parse HEAD); '
remote_command+="if [[ \"\${deployed_commit}\" != ${published_commit_q} ]]; then echo \"Deployed commit mismatch: expected ${PUBLISHED_COMMIT_SHORT}, got \${deployed_commit:0:7}\" >&2; exit 24; fi; "
remote_command+="echo \"Verified deployed commit: ${PUBLISHED_COMMIT_SHORT}\""

echo "Deploying commit ${PUBLISHED_COMMIT_SHORT} to ${REMOTE}:${REMOTE_ROOT}..."
ssh -tt "${REMOTE}" "bash -lc $(printf '%q' "${remote_command}")"

echo "x86 deployment succeeded: ${PUBLISHED_COMMIT_SHORT}"
echo "Open: http://192.168.1.209:8000"
