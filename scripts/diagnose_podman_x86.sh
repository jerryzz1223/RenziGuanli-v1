#!/usr/bin/env bash
# Read-only report for the verified EL9 AMD64 rootless-Podman server.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ ${EUID} -eq 0 ]]; then
	echo "Run as the rootless Podman owner, not root." >&2
	exit 1
fi

echo "Host: $(hostname)"
echo "Machine: $(uname -m)"
podman info --format 'Rootless={{.Host.Security.Rootless}} Arch={{.Host.Arch}} GraphRoot={{.Store.GraphRoot}}' 2>&1
git -C "${PROJECT_ROOT}" status --short --branch 2>&1
git -C "${PROJECT_ROOT}" log -1 --oneline 2>&1

echo "Containers:"
podman ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>&1
echo "Pods:"
podman pod ps 2>&1
echo "Volumes:"
podman volume ls 2>&1

for container in \
	docker_mariadb_1 docker_redis_1 docker_frappe_1 \
	hrms_x86_mariadb hrms_x86_redis hrms_x86_frappe; do
	if podman container exists "${container}"; then
		podman inspect "${container}" --format \
			'name={{.Name}} image={{.Config.Image}} state={{.State.Status}} exit={{.State.ExitCode}}' 2>&1
		podman inspect "${container}" --format \
			'{{range .Mounts}}{{.Type}}|{{.Name}}|{{.Source}}|{{.Destination}}{{"\n"}}{{end}}' 2>&1
	fi
done

for volume in docker_mariadb-data hrms-x86-frappe-bench hrms-x86-frappe-sites; do
	if podman volume exists "${volume}"; then
		podman volume inspect "${volume}" --format \
			'name={{.Name}} driver={{.Driver}} mountpoint={{.Mountpoint}}' 2>&1
	else
		echo "volume_missing=${volume}"
	fi
done

if command -v ss >/dev/null 2>&1; then
	ss -ltn 2>/dev/null | awk 'NR == 1 || $4 ~ /:(8000|9000)$/'
fi
