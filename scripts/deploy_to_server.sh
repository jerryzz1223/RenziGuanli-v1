#!/usr/bin/env bash

# One-command local-to-ARM-server deployment.
# Usage: ./scripts/deploy_to_server.sh "feat: describe this update" [--skip-deps]

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
	cat >&2 <<'EOF'
Usage: ./scripts/deploy_to_server.sh "commit message" [--skip-deps]

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
REMOTE="${HRMS_DEPLOY_REMOTE:-jerry@192.168.1.253}"
REMOTE_ROOT="${HRMS_DEPLOY_ROOT:-/home/jerry/Renzi/app}"
SITE_NAME="${HRMS_DEPLOY_SITE:-hrms.localhost}"
EXPECTED_ARCH="${HRMS_EXPECTED_ARCH:-}"

cd "${PROJECT_ROOT}"

if grep -q -- '--host 0.0.0.0' docker/init.sh; then
	echo "docker/init.sh still contains unsupported --host; refusing to deploy." >&2
	exit 1
fi

echo "Checking local worktree..."
git diff --check
git pull --rebase --autostash origin main
git add -A
git diff --cached --check

if ! git diff --cached --quiet; then
	git commit -m "${COMMIT_MESSAGE}"
else
	echo "No new local changes to commit."
fi
git push origin main

echo "Deploying ${PROJECT_ROOT} to ${REMOTE}:${REMOTE_ROOT}..."
ssh -tt "${REMOTE}" bash -s -- "${REMOTE_ROOT}" "${SITE_NAME}" "${INSTALL_DEPS}" "${EXPECTED_ARCH}" <<'REMOTE_SCRIPT'
set -euo pipefail

REMOTE_ROOT="$1"
SITE_NAME="$2"
INSTALL_DEPS="$3"
EXPECTED_ARCH="$4"
cd "${REMOTE_ROOT}"

if [[ -n "${EXPECTED_ARCH}" ]]; then
	actual_arch="$(sudo docker info --format '{{.Architecture}}')"
	case "${EXPECTED_ARCH}:${actual_arch}" in
		arm64:arm64|arm64:aarch64|amd64:amd64|amd64:x86_64)
			;;
		*)
			echo "Architecture mismatch: expected ${EXPECTED_ARCH}, got ${actual_arch}" >&2
			exit 21
			;;
	esac
fi

status="$(git status --porcelain)"
if [[ -n "${status}" ]]; then
	if printf '%s\n' "${status}" | grep -q '^??'; then
		echo "Untracked server files found; refusing to deploy:" >&2
		echo "${status}" >&2
		exit 20
	fi
	bad_paths="$(printf '%s\n' "${status}" | awk 'substr($0, 4) != "yarn.lock" {print}')"
	if [[ -n "${bad_paths}" ]]; then
		echo "Server worktree has unapproved changes; refusing to deploy:" >&2
		echo "${status}" >&2
		exit 20
	fi
	echo "Stashing only the server-generated yarn.lock..."
	git stash push -m "server-generated yarn.lock before automated deploy $(date +%Y%m%d-%H%M%S)" -- yarn.lock
fi

if [[ "${INSTALL_DEPS}" == "0" ]]; then
	sudo bash scripts/deploy_docker.sh --pull --site "${SITE_NAME}" --skip-deps
else
	sudo bash scripts/deploy_docker.sh --pull --site "${SITE_NAME}"
fi

for service in mariadb redis frappe; do
	cid="$(sudo docker compose -f docker/docker-compose.yml ps -aq "${service}" | tail -1)"
	if [[ -n "${cid}" ]]; then
		sudo docker update --restart unless-stopped "${cid}" >/dev/null
	fi
done

curl -fsS -H "Host: ${SITE_NAME}" \
	http://127.0.0.1:8000/api/method/ping >/dev/null

echo "Deployment complete: ${SITE_NAME} is responding."
sudo docker compose -f docker/docker-compose.yml ps
REMOTE_SCRIPT
