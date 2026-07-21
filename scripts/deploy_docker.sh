#!/usr/bin/env bash

# Deploy this repository to the Docker-based local/server stack in docker/.
# Run on the server from the repository root:
#   sudo bash scripts/deploy_docker.sh --pull

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${PROJECT_ROOT}/docker/docker-compose.yml"
SITE_NAME="hrms.localhost"
PULL_CODE=0
ORIGINAL_ARGS=("$@")

usage() {
	cat <<'EOF'
Usage: sudo bash scripts/deploy_docker.sh [--pull] [--site SITE_NAME]

Options:
  --pull              Run a fast-forward-only git pull before deploying.
  --site SITE_NAME     Frappe site to migrate (default: hrms.localhost).
  -h, --help           Show this help.

Examples:
  # Deploy the code already present on the server.
  sudo bash scripts/deploy_docker.sh

  # Pull the current branch from GitHub, then deploy it.
  sudo bash scripts/deploy_docker.sh --pull
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--pull)
			PULL_CODE=1
			;;
		--site)
			SITE_NAME="${2:?--site requires a site name}"
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage >&2
			exit 2
			;;
	esac
	shift
done

if [[ ! "${SITE_NAME}" =~ ^[A-Za-z0-9._-]+$ ]]; then
	echo "Invalid site name: ${SITE_NAME}" >&2
	exit 2
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
	echo "Compose file not found: ${COMPOSE_FILE}" >&2
	exit 1
fi

if [[ ${EUID} -ne 0 ]]; then
	echo "Docker deployment needs elevated permissions; restarting with sudo..."
	exec sudo "$0" "${ORIGINAL_ARGS[@]}"
fi

compose() {
	docker compose -f "${COMPOSE_FILE}" "$@"
}

if ! command -v docker >/dev/null 2>&1; then
	echo "Docker is not installed." >&2
	exit 1
fi

if ! docker info >/dev/null 2>&1; then
	echo "Docker daemon is unavailable. Start Docker first." >&2
	exit 1
fi

pull_code() {
	if ! command -v git >/dev/null 2>&1; then
		echo "git is required when using --pull." >&2
		exit 1
	fi

	local git_cmd=(git -C "${PROJECT_ROOT}")
	if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
		git_cmd=(sudo -u "${SUDO_USER}" git -C "${PROJECT_ROOT}")
	fi

	if [[ -n "$("${git_cmd[@]}" status --porcelain)" ]]; then
		echo "Server repository has uncommitted changes; refusing to overwrite them." >&2
		echo "Commit/stash the server changes, or deploy without --pull." >&2
		exit 1
	fi

	echo "Pulling the current branch (fast-forward only)..."
	"${git_cmd[@]}" pull --ff-only
}

if [[ ${PULL_CODE} -eq 1 ]]; then
	pull_code
fi

echo "Ensuring Docker services are running..."
compose up -d

echo "Preparing generated asset and dependency directories..."
compose exec -T --user root frappe bash -lc '
set -euo pipefail
for directory in \
  /workspace/node_modules \
  /workspace/frontend/node_modules \
  /workspace/roster/node_modules \
  /workspace/hrms/public/dist; do
  mkdir -p "${directory}"
  chown -R frappe:frappe "${directory}"
done
'

echo "Installing locked frontend dependencies..."
compose exec -T frappe bash -lc '
set -euo pipefail
cd /workspace
yarn install --frozen-lockfile
'

echo "Migrating ${SITE_NAME}, building HRMS assets, and clearing cache..."
compose exec -T frappe bash -lc "
set -euo pipefail
cd /home/frappe/frappe-bench
bench --site '${SITE_NAME}' migrate
bench build --app hrms
bench --site '${SITE_NAME}' clear-cache
"

echo "Restarting Frappe..."
compose restart frappe

echo "Waiting for Frappe to accept requests..."
for attempt in $(seq 1 30); do
	if compose exec -T frappe bash -lc "python -c 'import urllib.request; urllib.request.urlopen(\"http://127.0.0.1:8000/api/method/ping\", timeout=2).read()'" >/dev/null 2>&1; then
		echo "Deployment complete: ${SITE_NAME} is responding."
		compose ps
		exit 0
	fi
	sleep 2
done

echo "Frappe did not become ready within 60 seconds. Recent logs:" >&2
compose logs --tail=100 frappe >&2
exit 1
