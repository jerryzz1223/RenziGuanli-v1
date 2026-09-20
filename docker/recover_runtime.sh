#!/usr/bin/env bash
# Called inside the existing maintenance container by recover_docker_site.py.
set -euo pipefail
stage="$1"
[[ "$stage" =~ ^/home/frappe/hrms-recovery-[a-f0-9]+$ ]] || exit 2
bench_dir=/home/frappe/frappe-bench
frappe_ref=500305521544ed4e390535b84b142321c607d2db
erpnext_ref=4545dd939a522175de1274a4502db0ea593999c9
mkdir -p "$stage"

fetch_app() {
    local app="$1" ref="$2" repo="$stage/$1"
    if [ ! -d "$repo/.git" ]; then git init "$repo"; fi
    if ! git -C "$repo" cat-file -e "$ref^{commit}" 2>/dev/null; then
        git -C "$repo" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 fetch --depth 1 \
            "https://gitee.com/mirrors/$app.git" "$ref" ||
        git -C "$repo" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 fetch --depth 1 \
            "https://github.com/frappe/$app.git" "$ref"
    fi
    git -C "$repo" checkout --detach "$ref"
    test "$(git -C "$repo" rev-parse HEAD)" = "$ref"
}

if [ ! -f "$stage/sources-ready" ]; then
    fetch_app frappe "$frappe_ref"
    fetch_app erpnext "$erpnext_ref"
    # Keep the exact upstream forks. Do not substitute different PyPI releases.
    for item in \
        pypika:2c50e6142b2d61d2d243e466fdd5dc03b3d918f2 \
        gunicorn:f189de0ec3143581d8826f707343fa36c3fb0184; do
        app="${item%%:*}"; ref="${item#*:}"
        mkdir -p "$stage/$app"
        curl -fL --retry 3 --connect-timeout 15 --max-time 300 \
            "https://codeload.github.com/frappe/$app/tar.gz/$ref" -o "$stage/$app.tar.gz"
        tar -xzf "$stage/$app.tar.gz" --strip-components=1 -C "$stage/$app"
    done
    touch "$stage/sources-ready"
fi

cd "$bench_dir"
for app in frappe erpnext; do
    if [ -d "$stage/$app" ]; then
        if [ -e "apps/$app" ]; then
            test ! -e "$stage/original-$app"
            mv "apps/$app" "$stage/original-$app"
        fi
        mv "$stage/$app" "apps/$app"
    fi
done
test "$(git -C apps/frappe rev-parse HEAD)" = "$frappe_ref"
test "$(git -C apps/erpnext rev-parse HEAD)" = "$erpnext_ref"
if [ ! -e apps/hrms ]; then ln -s /workspace apps/hrms; fi
test "$(readlink -f apps/hrms)" = /workspace

# Install the same fork sources locally, avoiding the failed GitHub git fetch.
python3 - "$stage" <<'PY'
import re, sys
from pathlib import Path
project = Path('apps/frappe/pyproject.toml')
text = project.read_text()
for package, repo in [('PyPika', 'pypika'), ('gunicorn', 'gunicorn')]:
    text = re.sub(
        rf'{package}\s*@\s*git\+https://github\.com/frappe/{repo}@[^\s"\x27]+',
        f'{package} @ {Path(sys.argv[1], repo).as_uri()}', text,
    )
project.write_text(text)
PY

if [ ! -d "$stage/original-env" ]; then
    test -d env
    mv env "$stage/original-env"
fi
if [ ! -x env/bin/python ]; then uv venv env --seed --python python3; fi
./env/bin/python -m pip install -e apps/frappe -e apps/erpnext -e apps/hrms
./env/bin/python -m pip check
./env/bin/python -c 'import frappe, erpnext, hrms'

if [ -n "${NVM_DIR:-}" ] && [ -n "${NODE_VERSION_DEVELOP:-}" ]; then
    export PATH="${NVM_DIR}/versions/node/v${NODE_VERSION_DEVELOP}/bin:${PATH}"
elif [ -n "${NVM_DIR:-}" ]; then
    node_bin="$(find "${NVM_DIR}/versions/node" -maxdepth 2 -type d -name bin | sort -V | tail -1)"
    export PATH="${node_bin}:${PATH}"
fi
for app in frappe erpnext; do
    (cd "apps/$app" && yarn install --frozen-lockfile)
done
cd /workspace
yarn install --frozen-lockfile --ignore-scripts
(cd frontend && yarn install --frozen-lockfile --ignore-scripts)
(cd roster && yarn install --frozen-lockfile --ignore-scripts)
echo "Pinned runtime installation complete."
