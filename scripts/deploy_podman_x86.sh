#!/usr/bin/env bash
# Deploy the verified EL9 AMD64 rootless-Podman server after storage migration.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${PROJECT_ROOT}/docker/docker-compose.podman-x86.yml"
SITE_NAME=hrms.localhost
PULL_CODE=0
CREATE_CONTAINERS=0
INSTALL_DEPS=1

FRAPPE_CONTAINER=hrms_x86_frappe
MARIADB_CONTAINER=hrms_x86_mariadb
REDIS_CONTAINER=hrms_x86_redis
MARIADB_VOLUME=docker_mariadb-data
BENCH_VOLUME=hrms-x86-frappe-bench
SITES_VOLUME=hrms-x86-frappe-sites

usage() {
	cat <<'EOF'
Usage: bash scripts/deploy_podman_x86.sh [--create] [--pull] [--site SITE] [--skip-deps]

  --create     First start after migrate_podman_x86_storage.sh. Refuses if any
               target container already exists.
  --pull       Require a clean server checkout, then git pull --ff-only.
  --site       Frappe site name (default: hrms.localhost).
  --skip-deps  Skip Yarn installs when lockfiles did not change.

Normal deployments never call podman-compose up and never recreate containers.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--create) CREATE_CONTAINERS=1 ;;
		--pull) PULL_CODE=1 ;;
		--site) SITE_NAME="${2:?--site requires a site name}"; shift ;;
		--skip-deps) INSTALL_DEPS=0 ;;
		-h|--help) usage; exit 0 ;;
		*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
	esac
	shift
done

if [[ ${EUID} -eq 0 ]]; then
	echo "Run as the rootless Podman owner, not root." >&2
	exit 1
fi
if [[ ! "${SITE_NAME}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
	echo "Invalid site name: ${SITE_NAME}" >&2
	exit 2
fi
command -v podman >/dev/null || { echo "podman is required" >&2; exit 1; }
command -v podman-compose >/dev/null || { echo "podman-compose is required" >&2; exit 1; }
[[ -f "${COMPOSE_FILE}" ]] || { echo "Missing ${COMPOSE_FILE}" >&2; exit 1; }
[[ "$(podman info --format '{{.Host.Security.Rootless}}')" == true ]] || {
	echo "This deployment requires the verified rootless Podman context." >&2
	exit 1
}
[[ "$(podman info --format '{{.Host.Arch}}')" == amd64 ]] || {
	echo "This deployment is only for linux/amd64." >&2
	exit 1
}
for volume in "${MARIADB_VOLUME}" "${BENCH_VOLUME}" "${SITES_VOLUME}"; do
	podman volume inspect "${volume}" >/dev/null || {
		echo "Required external volume is missing: ${volume}" >&2
		exit 1
	}
done

if [[ ${PULL_CODE} -eq 1 ]]; then
	if [[ -n "$(git -C "${PROJECT_ROOT}" status --porcelain)" ]]; then
		echo "Server repository has uncommitted changes; refusing git pull." >&2
		exit 1
	fi
	git -C "${PROJECT_ROOT}" pull --ff-only
	args=(--site "${SITE_NAME}")
	[[ ${CREATE_CONTAINERS} -eq 1 ]] && args+=(--create)
	[[ ${INSTALL_DEPS} -eq 0 ]] && args+=(--skip-deps)
	exec bash "$0" "${args[@]}"
fi

if [[ ${CREATE_CONTAINERS} -eq 1 ]]; then
	for container in "${FRAPPE_CONTAINER}" "${MARIADB_CONTAINER}" "${REDIS_CONTAINER}"; do
		if podman container exists "${container}"; then
			echo "Target container already exists; refusing first-time creation: ${container}" >&2
			exit 1
		fi
	done
	for legacy in docker_frappe_1 docker_mariadb_1 docker_redis_1; do
		if podman container exists "${legacy}" && [[ "$(podman inspect "${legacy}" --format '{{.State.Running}}')" == true ]]; then
			echo "Legacy container must remain stopped during creation: ${legacy}" >&2
			exit 1
		fi
	done
	HRMS_SITE="${SITE_NAME}" podman-compose -p hrmsx86 -f "${COMPOSE_FILE}" up -d
else
	for container in "${FRAPPE_CONTAINER}" "${MARIADB_CONTAINER}" "${REDIS_CONTAINER}"; do
		podman container exists "${container}" || {
			echo "Missing ${container}; run once with --create after storage migration." >&2
			exit 1
		}
	done
	podman start "${MARIADB_CONTAINER}" "${REDIS_CONTAINER}" >/dev/null
	podman start "${FRAPPE_CONTAINER}" >/dev/null
fi

wait_for_bench() {
	local attempt
	for attempt in $(seq 1 90); do
		if [[ "$(podman inspect "${FRAPPE_CONTAINER}" --format '{{.State.Running}}')" != true ]]; then
			echo "Frappe stopped during startup. Recent logs:" >&2
			podman logs --tail 120 "${FRAPPE_CONTAINER}" >&2
			exit 1
		fi
		if podman exec "${FRAPPE_CONTAINER}" bash -lc '
			cd /home/frappe/frappe-bench
			test -x env/bin/python
			./env/bin/python -c "import frappe, erpnext, hrms"
		' >/dev/null 2>&1; then
			return 0
		fi
		sleep 2
	done
	echo "Frappe bench was not usable within 180 seconds." >&2
	podman logs --tail 120 "${FRAPPE_CONTAINER}" >&2
	exit 1
}

wait_for_bench

echo "Checking the preserved site and application runtime..."
podman exec "${FRAPPE_CONTAINER}" bash -lc '
set -euo pipefail
cd /home/frappe/frappe-bench
./env/bin/python /workspace/docker/prepare_runtime_paths.py
./env/bin/python /workspace/docker/check_site_ready.py "$1"
bench --site "$1" list-apps
' bash "${SITE_NAME}"

echo "Backing up the database and public/private files before migration..."
podman exec "${FRAPPE_CONTAINER}" bash -lc '
set -euo pipefail
cd /home/frappe/frappe-bench
bench --site "$1" backup --with-files
' bash "${SITE_NAME}"

echo "Preparing writable build directories..."
podman exec --user root "${FRAPPE_CONTAINER}" bash -lc '
set -euo pipefail
for directory in \
  /workspace/node_modules \
  /workspace/frontend/node_modules \
  /workspace/roster/node_modules \
  /workspace/hrms/public/dist \
  /workspace/hrms/public/frontend \
  /workspace/hrms/public/roster; do
  mkdir -p "$directory"
  chown -R frappe:frappe "$directory"
done
chown frappe:frappe /workspace/frontend /workspace/roster
'

if [[ ${INSTALL_DEPS} -eq 1 ]]; then
	echo "Installing locked frontend dependencies..."
	podman exec --user frappe "${FRAPPE_CONTAINER}" bash -lc '
	set -euo pipefail
	cd /workspace
	yarn install --frozen-lockfile --ignore-scripts
	cd frontend
	yarn install --frozen-lockfile --check-files --ignore-scripts
	cd ../roster
	yarn install --frozen-lockfile --check-files --ignore-scripts
	'
else
	echo "Skipping Yarn dependency installation (--skip-deps)."
fi

echo "Migrating ${SITE_NAME}, building assets, and clearing cache..."
podman exec --user frappe "${FRAPPE_CONTAINER}" bash -lc '
set -euo pipefail
cd /home/frappe/frappe-bench
bench --site "$1" migrate
bench build --app hrms
bench --site "$1" clear-cache
' bash "${SITE_NAME}"

podman restart "${FRAPPE_CONTAINER}" >/dev/null
wait_for_bench

echo "Waiting for the site health endpoint..."
for attempt in $(seq 1 30); do
	if podman exec "${FRAPPE_CONTAINER}" /home/frappe/frappe-bench/env/bin/python -c '
import json
import sys
import urllib.request
request = urllib.request.Request(
    "http://127.0.0.1:8000/api/method/ping",
    headers={"Host": sys.argv[1]},
)
with urllib.request.urlopen(request, timeout=2) as response:
    assert json.load(response).get("message") == "pong"
' "${SITE_NAME}" >/dev/null 2>&1; then
		echo "Deployment complete: ${SITE_NAME} is responding on the AMD64 Podman server."
		podman ps --filter "name=hrms_x86_" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
		exit 0
	fi
	sleep 2
done

echo "HTTP health verification failed. Legacy containers and private archives were preserved." >&2
podman logs --tail 120 "${FRAPPE_CONTAINER}" >&2
exit 1
