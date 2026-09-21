#!/usr/bin/env bash
# One-time preservation of the existing rootless Podman Frappe container.
# The default mode is a read-only plan. Add --apply only after reviewing it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${HRMS_PROJECT_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
SITE_NAME=hrms.localhost
APPLY=0

OLD_FRAPPE=docker_frappe_1
OLD_MARIADB=docker_mariadb_1
OLD_REDIS=docker_redis_1
MARIADB_VOLUME=docker_mariadb-data
BENCH_VOLUME=hrms-x86-frappe-bench
SITES_VOLUME=hrms-x86-frappe-sites

usage() {
	cat <<'EOF'
Usage: bash migrate_podman_x86_storage.sh [--apply] [--site SITE]
                                               [--project-root PATH]

Without --apply this prints and validates the migration plan. The apply mode:
  1. snapshots the stopped legacy Frappe container as an image and archive;
  2. exports the stopped MariaDB volume;
  3. copies the preserved bench and sites into new external Podman volumes;
  4. leaves every legacy container in place and stopped.

It never pulls code, starts the service, removes a container, or removes a volume.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--apply) APPLY=1 ;;
		--site) SITE_NAME="${2:?--site requires a site name}"; shift ;;
		--project-root) PROJECT_ROOT="${2:?--project-root requires a path}"; shift ;;
		-h|--help) usage; exit 0 ;;
		*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
	esac
	shift
done

PROJECT_ROOT="$(cd "${PROJECT_ROOT}" && pwd)"
BACKUP_PARENT="${PROJECT_ROOT}/../deployment-backups"

if [[ ${EUID} -eq 0 ]]; then
	echo "Run as the rootless Podman owner, not root and not inside podman unshare." >&2
	exit 1
fi
if [[ ! "${SITE_NAME}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
	echo "Invalid site name: ${SITE_NAME}" >&2
	exit 2
fi
command -v podman >/dev/null || { echo "podman is required" >&2; exit 1; }
[[ "$(podman info --format '{{.Host.Security.Rootless}}')" == true ]] || {
	echo "The verified server uses rootless Podman; refusing a different storage context." >&2
	exit 1
}
[[ "$(podman info --format '{{.Host.Arch}}')" == amd64 ]] || {
	echo "This migration is only for the verified AMD64 server." >&2
	exit 1
}

for container in "${OLD_FRAPPE}" "${OLD_MARIADB}" "${OLD_REDIS}"; do
	podman container exists "${container}" || {
		echo "Required legacy container is missing: ${container}" >&2
		exit 1
	}
	if [[ "$(podman inspect "${container}" --format '{{.State.Running}}')" == true ]]; then
		echo "Legacy container must be stopped before snapshot: ${container}" >&2
		exit 1
	fi
done

podman volume inspect "${MARIADB_VOLUME}" >/dev/null
DB_MOUNT="$(podman inspect "${OLD_MARIADB}" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Name}}{{end}}{{end}}')"
[[ "${DB_MOUNT}" == "${MARIADB_VOLUME}" ]] || {
	echo "Legacy MariaDB container does not use ${MARIADB_VOLUME}." >&2
	exit 1
}
for volume in "${BENCH_VOLUME}" "${SITES_VOLUME}"; do
	if podman volume exists "${volume}"; then
		echo "Target volume already exists; inspect it before resuming: ${volume}" >&2
		exit 1
	fi
done

AVAILABLE_KB="$(df -Pk "${PROJECT_ROOT}/.." | awk 'NR == 2 {print $4}')"
if [[ ! "${AVAILABLE_KB}" =~ ^[0-9]+$ || ${AVAILABLE_KB} -lt 6291456 ]]; then
	echo "At least 6 GiB free space is required for private recovery archives." >&2
	exit 1
fi

cat <<EOF
Verified migration plan:
  project:          ${PROJECT_ROOT}
  architecture:     linux/amd64 (rootless Podman)
  legacy Frappe:    ${OLD_FRAPPE} (kept stopped)
  legacy database:  ${MARIADB_VOLUME} (exported, then reused)
  new bench volume: ${BENCH_VOLUME}
  new sites volume: ${SITES_VOLUME}
  site:             ${SITE_NAME}
  backup parent:    ${BACKUP_PARENT}
EOF
if [[ ${APPLY} -ne 1 ]]; then
	echo "No changes made. Re-run with --apply after reviewing this plan."
	exit 0
fi

umask 077
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_PARENT}/x86-podman-${STAMP}"
RECOVERY_IMAGE="localhost/hrms-frappe-recovery:${STAMP}"
mkdir -p "${BACKUP_PARENT}"
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

git -C "${PROJECT_ROOT}" status --short --branch > "${BACKUP_DIR}/git-status.txt"
git -C "${PROJECT_ROOT}" diff --binary > "${BACKUP_DIR}/server-worktree.patch"
git -C "${PROJECT_ROOT}" rev-parse HEAD > "${BACKUP_DIR}/git-head.txt"
podman inspect "${OLD_FRAPPE}" > "${BACKUP_DIR}/legacy-frappe-inspect.json"
podman inspect "${OLD_MARIADB}" > "${BACKUP_DIR}/legacy-mariadb-inspect.json"
podman volume inspect "${MARIADB_VOLUME}" > "${BACKUP_DIR}/mariadb-volume-inspect.json"

echo "Creating a recovery image from the stopped legacy Frappe container..."
podman commit "${OLD_FRAPPE}" "${RECOVERY_IMAGE}" >/dev/null
podman save --output "${BACKUP_DIR}/frappe-recovery-image.tar" "${RECOVERY_IMAGE}"

echo "Exporting the stopped MariaDB volume..."
podman volume export --output "${BACKUP_DIR}/mariadb-volume.tar" "${MARIADB_VOLUME}"

echo "Creating empty external bench/sites volumes..."
podman volume create --label io.hrms.purpose=preserved-bench "${BENCH_VOLUME}" >/dev/null
podman volume create --label io.hrms.purpose=preserved-sites "${SITES_VOLUME}" >/dev/null

echo "Copying the preserved runtime and site without changing the legacy container..."
podman run --rm --user 0 --entrypoint /bin/bash \
	--env HRMS_SITE="${SITE_NAME}" \
	--volume "${BENCH_VOLUME}:/target/bench" \
	--volume "${SITES_VOLUME}:/target/sites" \
	"${RECOVERY_IMAGE}" -lc '
set -euo pipefail
test -x /home/frappe/frappe-bench/env/bin/python
test -d /home/frappe/frappe-bench/apps/frappe
test -d /home/frappe/frappe-bench/apps/erpnext
test -f "/home/frappe/frappe-bench/sites/${HRMS_SITE}/site_config.json"
tar -C /home/frappe/frappe-bench --exclude=./sites -cf - . | tar -C /target/bench -xf -
tar -C /home/frappe/frappe-bench/sites -cf - . | tar -C /target/sites -xf -
ln -s /home/frappe/frappe-sites /target/bench/sites
printf "%s\n" "${HRMS_SITE}" > /target/bench/.hrms-preserved-site
'

echo "Verifying copied volumes..."
podman run --rm --user 0 --entrypoint /bin/bash \
	--env HRMS_SITE="${SITE_NAME}" \
	--volume "${BENCH_VOLUME}:/target/bench" \
	--volume "${SITES_VOLUME}:/target/sites" \
	"${RECOVERY_IMAGE}" -lc '
set -euo pipefail
test -x /target/bench/env/bin/python
test -d /target/bench/apps/frappe
test -d /target/bench/apps/erpnext
test "$(readlink /target/bench/sites)" = /home/frappe/frappe-sites
test -f "/target/sites/${HRMS_SITE}/site_config.json"
'

sha256sum "${BACKUP_DIR}/frappe-recovery-image.tar" \
	"${BACKUP_DIR}/mariadb-volume.tar" > "${BACKUP_DIR}/SHA256SUMS"

cat <<EOF
Storage preservation complete.
Private backup directory: ${BACKUP_DIR}
Recovery image: ${RECOVERY_IMAGE}
Legacy containers remain stopped and were not removed.

Next: make the repository clean without losing server-worktree.patch, update the
code, then run: bash scripts/deploy_podman_x86.sh --create --site ${SITE_NAME}
EOF
