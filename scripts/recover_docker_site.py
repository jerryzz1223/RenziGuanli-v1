#!/usr/bin/env python3
"""Recover this incident's existing site, without new-site or account resets.

Run on the Linux server with --apply; --migrate additionally applies HRMS updates.
Secrets travel on stdin, never as command arguments or printed configuration.
"""

import argparse
import json
import os
import re
import secrets
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

DB = "_0734c5df697fa9d2"
SITE = "hrms.localhost"
EXPECTED = {"frappe": "5003055", "erpnext": "4545dd9"}
PROJECT = Path(__file__).resolve().parents[1]
COMPOSE = ["docker", "compose", "-f", str(PROJECT / "docker/docker-compose.yml")]


def run(args, *, data=None, capture=False, output=None, confidential=False):
    result = subprocess.run(args, input=data, stdout=output or (subprocess.PIPE if capture else None),
                            stderr=subprocess.PIPE if confidential else None)
    if result.returncode:
        # Do not include SQL or JSON input, or secret-bearing SQL error excerpts.
        raise RuntimeError(f"Command failed (exit {result.returncode}): {args[0]}")
    return result.stdout if capture else None


def sql(query):
    return run(COMPOSE + ["exec", "-T", "mariadb", "sh", "-c",
               'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mariadb -uroot --batch --skip-column-names'],
               data=query.encode(), capture=True, confidential=True).decode()


def account_sql(config):
    if config.get("db_name") != DB:
        raise ValueError("Recovery must target the previously verified database")
    user, password = config["db_user"], config["db_password"]
    if not re.fullmatch(r"hrms_recovery_[a-f0-9]{12}", user):
        raise ValueError("Invalid dedicated recovery account")
    if not re.fullmatch(r"[a-f0-9]{64}", password):
        raise ValueError("Invalid recovery credential format")
    grant_database = DB.replace("_", "\\_")
    return (f"CREATE USER IF NOT EXISTS '{user}'@'%' IDENTIFIED BY '{password}';\n"
            f"GRANT ALL PRIVILEGES ON `{grant_database}`.* TO '{user}'@'%';\n")


def verify_versions(rows):
    apps = dict(line.split("\t", 1) for line in rows.strip().splitlines() if line)
    if set(apps) != {"frappe", "erpnext", "hrms"}:
        raise ValueError("Database application list differs from this recovery plan")
    for app, ref in EXPECTED.items():
        if f"({ref})" not in apps[app]:
            raise ValueError(f"Database version of {app} differs from the verified incident")


SITE_WRITER = r'''
import json, os, sys
from pathlib import Path
import pymysql
config = json.load(sys.stdin)
connection = pymysql.connect(host=config['db_host'], port=3306, user=config['db_user'],
                             password=config['db_password'], database=config['db_name'],
                             connect_timeout=10)
with connection.cursor() as cursor:
    cursor.execute('SELECT COUNT(*) FROM `tabEmployee`')
    print('Existing employee records:', cursor.fetchone()[0])
connection.close()
sites = Path('/home/frappe/frappe-sites')
site = sites / 'hrms.localhost'
site.mkdir(exist_ok=True)
target = site / 'site_config.json'
if target.exists():
    existing = json.loads(target.read_text())
    for key in ('db_name', 'db_user', 'db_password'):
        if existing.get(key) != config[key]:
            raise RuntimeError('Existing site configuration differs; refusing overwrite')
else:
    with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as file:
        json.dump(config, file, indent=2)
for relative in ('private/files', 'public/files', 'private/backups', 'locks', 'logs'):
    (site / relative).mkdir(parents=True, exist_ok=True)
(sites / 'apps.txt').write_text(chr(10).join(('frappe', 'erpnext', 'hrms', '')))
common_path = sites / 'common_site_config.json'
common = json.loads(common_path.read_text())
common.update(db_host='mariadb', redis_cache='redis://redis:6379',
              redis_queue='redis://redis:6379', redis_socketio='redis://redis:6379',
              default_site='hrms.localhost')
common_path.write_text(json.dumps(common, indent=2))
print('Original database connected. Original encryption key and historical file bodies are not restored.')
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--migrate", action="store_true")
    parser.add_argument("--resume", type=Path, help="Backup directory printed by a previous attempt")
    options = parser.parse_args()
    if not options.apply:
        print("Plan: back up database/sites/bench; pause web startup; restore pinned Frappe/ERPNext;")
        print("install local HRMS; create a dedicated account scoped to the EXISTING database;")
        print("reconstruct its site connection; build assets; restart and check the login route.")
        print("No new database, original-user password reset, or container recreation is performed.")
        print("Missing encryption key/files remain a separate recovery issue. Add --apply to execute.")
        return
    if os.geteuid() != 0:
        raise RuntimeError("Run this command with sudo on the Linux server")
    os.umask(0o077)
    import fcntl
    recovery_lock = open("/var/lock/hrms-site-recovery.lock", "a")
    try:
        fcntl.flock(recovery_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError("Another recovery process is already running") from None
    cid = run(COMPOSE + ["ps", "-a", "-q", "frappe"], capture=True).decode().strip()
    if not re.fullmatch(r"[a-f0-9]{12,64}", cid):
        raise RuntimeError("Exactly one existing Frappe container is required")
    mounts = json.loads(run(["docker", "inspect", cid, "--format", "{{json .Mounts}}"], capture=True))
    if not any(m.get("Name") == "docker_frappe-sites" and
               m["Destination"] == "/home/frappe/frappe-sites" for m in mounts):
        raise RuntimeError("Unexpected sites mount; this script is for the verified incident only")

    if options.resume:
        backup = options.resume.resolve()
        if backup.parent != Path("/home/jerry") or not backup.name.startswith("hrms-recovery-"):
            raise ValueError("Use the backup path printed by this script")
        stat = backup.stat()
        if stat.st_uid != 0 or stat.st_mode & 0o077:
            raise ValueError("Recovery directory must be root-owned with mode 0700")
        state = json.loads((backup / "state.json").read_text())
        if state["container"] != cid:
            raise ValueError("Container changed since recovery began; refusing to overwrite it")
    else:
        run(["docker", "exec", cid, "bash", "-lc",
             "test ! -e /home/frappe/frappe-sites/hrms.localhost/site_config.json && "
             "test ! -e /home/frappe/frappe-sites/.hrms-recovery-in-progress && "
             'test "$(readlink -f /home/frappe/frappe-bench/sites)" = /home/frappe/frappe-sites'])
        verify_versions(sql(f"SELECT app_name, app_version FROM `{DB}`.`tabInstalled Application`;"))
        backup = Path(tempfile.mkdtemp(prefix="hrms-recovery-", dir="/home/jerry"))
        token = secrets.token_hex(6)
        state = {"container": cid, "stage": f"/home/frappe/hrms-recovery-{token}", "config": {
            "db_name": DB, "db_user": f"hrms_recovery_{token}",
            "db_password": secrets.token_hex(32), "db_type": "mariadb", "db_host": "mariadb",
            "db_port": 3306, "host_name": "http://192.168.1.253:8000",
        }}
        (backup / "state.json").write_text(json.dumps(state, indent=2))
    print(f"Recovery backups and private resume state: {backup}", flush=True)
    resume = ["sudo", "python3", str(PROJECT / "scripts/recover_docker_site.py"), "--apply", "--resume", str(backup)]
    if options.migrate:
        resume.append("--migrate")
    print("If interrupted, resume with: " + shlex.join(resume), flush=True)

    def step(name, action):
        marker = backup / (name + ".done")
        if marker.exists():
            print(f"Already completed: {name}", flush=True)
            return
        print(f"Starting: {name}", flush=True)
        action()
        marker.touch()

    def snapshot():
        commands = {
            "database.sql": COMPOSE + ["exec", "-T", "mariadb", "sh", "-c",
                'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mariadb-dump -uroot '
                '--single-transaction --quick --routines --events --hex-blob --databases ' + DB],
            "sites.tar.gz": ["docker", "exec", "--user", "root", cid, "tar", "-czf", "-",
                              "-C", "/home/frappe/frappe-sites", "."],
            "bench.tar.gz": ["docker", "exec", "--user", "root", cid, "tar", "-czf", "-",
                              "-C", "/home/frappe", "frappe-bench"],
        }
        for filename, command in commands.items():
            with (backup / filename).open("wb") as file:
                run(command, output=file)
            if not (backup / filename).stat().st_size:
                raise RuntimeError(f"Empty backup: {filename}")
        for filename in ("sites.tar.gz", "bench.tar.gz"):
            run(["tar", "-tzf", str(backup / filename)], capture=True)

    # Also works when a previous attempt left the container stopped.
    marker_path = "/home/frappe/frappe-sites/.hrms-recovery-in-progress"
    (backup / "maintenance-marker").touch()
    run(["docker", "cp", str(backup / "maintenance-marker"), f"{cid}:{marker_path}"])
    run(["docker", "restart", cid])
    for _ in range(10):
        command = run(["docker", "exec", cid, "sh", "-c", "tr '\\000' ' ' </proc/1/cmdline"], capture=True).decode().strip()
        if command == "sleep infinity":
            break
        time.sleep(1)
    else:
        raise RuntimeError("Maintenance startup was not active; do not change a live runtime")
    # Pause web/watch before archiving so generated files stay unchanged.
    step("backup", snapshot)

    def runtime():
        run(["docker", "exec", "--user", "root", cid, "bash", "-lc", '''
set -euo pipefail
for directory in /workspace/node_modules /workspace/frontend/node_modules /workspace/roster/node_modules /workspace/hrms/public/dist /workspace/hrms/public/frontend /workspace/hrms/public/roster; do
    mkdir -p "$directory"
    chown -R frappe:frappe "$directory"
done
chown frappe:frappe /workspace/frontend /workspace/roster
'''])
        run(["docker", "exec", "--user", "frappe", cid, "bash", "/workspace/docker/recover_runtime.sh", state["stage"]])
    step("runtime", runtime)
    # CREATE IF NOT EXISTS never changes an existing account's password. The
    # credential test below detects an unexpected account instead of resetting it.
    sql(account_sql(state["config"]))
    run(["docker", "exec", "-i", "--user", "frappe", cid,
         "/home/frappe/frappe-bench/env/bin/python", "-c", SITE_WRITER],
        data=json.dumps(state["config"]).encode(), confidential=True)

    def bench(command):
        run(["docker", "exec", "--user", "frappe", cid, "bash", "-lc",
             """set -euo pipefail
if [ -n "${NVM_DIR:-}" ] && [ -n "${NODE_VERSION_DEVELOP:-}" ]; then
    export PATH="${NVM_DIR}/versions/node/v${NODE_VERSION_DEVELOP}/bin:${PATH}"
elif [ -n "${NVM_DIR:-}" ]; then
    node_bin="$(find "${NVM_DIR}/versions/node" -maxdepth 2 -type d -name bin | sort -V | tail -1)"
    export PATH="${node_bin}:${PATH}"
fi
cd /home/frappe/frappe-bench
""" + command])

    bench("./env/bin/python /workspace/docker/prepare_runtime_paths.py; "
          "./env/bin/python /workspace/docker/check_site_ready.py hrms.localhost; "
          "bench --site hrms.localhost list-apps")
    # Default build probes a remote asset server without a request timeout.
    # Dependencies are already installed; build locally with visible progress.
    step("assets", lambda: bench("bench build --force --verbose"))
    if options.migrate:
        step("migration", lambda: bench("bench --site hrms.localhost migrate"))
    # Redis is provided by the existing service. Remove local Redis and watch
    # processes; init.sh supplies the explicit site's web command on restart.
    bench("bench setup procfile; sed -i '/^redis_/d; /^watch:/d' Procfile; "
          "bench --site hrms.localhost clear-cache")
    run(["docker", "exec", "--user", "root", cid, "rm", marker_path])
    run(["docker", "restart", cid])
    for _ in range(30):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8000/api/method/ping", timeout=2) as response:
                if json.load(response).get("message") != "pong":
                    raise ValueError("Unexpected ping response")
            with urllib.request.urlopen("http://127.0.0.1:8000/login", timeout=2) as response:
                if response.status != 200:
                    raise ValueError("Login route not ready")
            print("Server-local ping and login route passed. Verify original data and login from your browser.")
            print("Old encrypted integration credentials and missing attachments still require recovery.")
            return
        except Exception:
            time.sleep(2)
    raise RuntimeError("HTTP verification failed. Preserve this container and backups; inspect docker logs.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Recovery stopped: {error}", file=sys.stderr)
        sys.exit(1)
