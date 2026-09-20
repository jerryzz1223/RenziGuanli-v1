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
INSTALL_DEPS=1

# Re-exec before parsing arguments. With no arguments, Bash nounset mode can
# treat an empty array expansion as unset.
if [[ ${EUID} -ne 0 ]]; then
	echo "Docker deployment needs elevated permissions; restarting with sudo..."
	exec sudo bash "$0" "$@"
fi

usage() {
	cat <<'EOF'
Usage: sudo bash scripts/deploy_docker.sh [--pull] [--site SITE_NAME]

Options:
  --pull              Run a fast-forward-only git pull before deploying.
  --site SITE_NAME     Frappe site to migrate (default: hrms.localhost).
  --skip-deps          Skip Yarn dependency installation when lockfiles did not change.
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
		--skip-deps)
			INSTALL_DEPS=0
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

compose() {
	docker compose -f "${COMPOSE_FILE}" "$@"
}

wait_for_bench_runtime() {
	local attempt
	for attempt in $(seq 1 90); do
		if ! docker inspect -f '{{.State.Running}}' "${FRAPPE_CONTAINER}" 2>/dev/null | grep -q '^true$'; then
			echo "Frappe container stopped while bench was starting. Recent logs:" >&2
			compose logs --tail=100 frappe >&2
			exit 1
		fi
		if compose exec -T frappe bash -lc '
			set -e
			test -x /home/frappe/frappe-bench/env/bin/python
			cd /home/frappe/frappe-bench
			./env/bin/python -c "import frappe"
		' >/dev/null 2>&1; then
			return 0
		fi
		sleep 2
	done
	echo "Frappe bench did not become usable within 180 seconds. Recent logs:" >&2
	compose logs --tail=100 frappe >&2
	exit 1
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
	# Run the newly fetched script, not the old shell body already in memory.
	if [[ ${INSTALL_DEPS} -eq 0 ]]; then
		exec bash "$0" --site "${SITE_NAME}" --skip-deps
	fi
	exec bash "$0" --site "${SITE_NAME}"
fi

FRAPPE_CONTAINER="$(compose ps -a -q frappe)"
if [[ -z "${FRAPPE_CONTAINER}" ]]; then
	echo "No existing Frappe container. This command updates an existing installation only." >&2
	echo "Restore the runtime and site first; automatic container creation is disabled." >&2
	exit 1
fi
# Bench currently lives in the container writable layer. `up` can recreate it
# after a compose change, losing the only copy. `start` preserves the container.
echo "Starting existing services without recreating containers..."
compose start mariadb redis frappe
wait_for_bench_runtime

echo "Checking existing site and applications before deployment..."
compose exec -T frappe bash -lc '
set -euo pipefail
cd /home/frappe/frappe-bench
./env/bin/python /workspace/docker/check_site_ready.py "$1"
bench --site "$1" list-apps
' bash "${SITE_NAME}"

echo "Backing up the existing database and site files before migration..."
compose exec -T frappe bash -lc '
set -euo pipefail
cd /home/frappe/frappe-bench
bench --site "$1" backup --with-files
' bash "${SITE_NAME}"

echo "Preparing generated asset and dependency directories..."
compose exec -T --user root frappe bash -lc '
set -euo pipefail
for directory in \
  /workspace/node_modules \
  /workspace/frontend/node_modules \
  /workspace/roster/node_modules \
	  /workspace/hrms/public/dist \
	  /workspace/hrms/public/frontend \
	  /workspace/hrms/public/roster; do
	  mkdir -p "${directory}"
	  chown -R frappe:frappe "${directory}"
done
# Vite creates a short-lived config module next to vite.config.js, so the
# source directory itself (not only node_modules) must be writable by frappe.
chown frappe:frappe /workspace/frontend /workspace/roster
'

if [[ ${INSTALL_DEPS} -eq 1 ]]; then
	echo "Installing locked frontend dependencies..."
	compose exec -T frappe bash -lc '
	set -euo pipefail
	cd /workspace
	yarn install --frozen-lockfile --ignore-scripts
	cd frontend
	yarn install --frozen-lockfile --check-files --ignore-scripts
	cd ../roster
	yarn install --frozen-lockfile --check-files --ignore-scripts
	'
else
	echo "Skipping frontend dependency installation (--skip-deps)."
fi

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
	if compose exec -T frappe /home/frappe/frappe-bench/env/bin/python -c '
import json, sys, urllib.request
request = urllib.request.Request("http://127.0.0.1:8000/api/method/ping", headers={"Host": sys.argv[1]})
with urllib.request.urlopen(request, timeout=2) as response:
    assert json.load(response).get("message") == "pong"+' "${SITE_NAME}" >/dev/null 2>&1; then
		echo "Deployment complete: ${SITE_NAME} is responding."
		compose ps
		exit 0
	fi
	sleep 2
done

echo "Frappe did not become ready within 60 seconds. Recent logs:" >&2
compose logs --tail=100 frappe >&2
exit 1
