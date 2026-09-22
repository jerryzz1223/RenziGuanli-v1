import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

SPEC = importlib.util.spec_from_file_location(
    "recovery", Path(__file__).resolve().parents[1] / "scripts/recover_docker_site.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def config():
    return {"db_name": MODULE.DB, "db_user": "hrms_recovery_123456abcdef",
            "db_password": "a" * 64, "db_host": "mariadb"}


class RecoveryTests(unittest.TestCase):
    def test_failed_backup_prevents_runtime_replacement_and_account_creation(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryFile() as lock:
            def fake_run(args, **kwargs):
                if args[-4:] == ["ps", "-a", "-q", "frappe"]:
                    return ("a" * 64).encode()
                if "inspect" in args:
                    return b'[{"Name":"docker_frappe-sites","Destination":"/home/frappe/frappe-sites"}]'
                if "/proc/1/cmdline" in " ".join(args):
                    return b"sleep infinity "
                if "mariadb-dump" in " ".join(args):
                    raise RuntimeError("Backup failed")
                return b""
            versions = "frappe\t17.x.x-develop (5003055)\nerpnext\t17.x.x-develop (4545dd9)\nhrms\t17.0.0-dev"
            with patch.object(sys, "argv", ["recover_docker_site.py", "--apply"]), \
                 patch.object(MODULE.os, "geteuid", return_value=0), \
                 patch.object(MODULE.os, "umask"), \
                 patch("builtins.open", return_value=lock), \
                 patch.object(MODULE.tempfile, "mkdtemp", return_value=directory), \
                 patch.object(MODULE, "sql", return_value=versions) as sql, \
                 patch.object(MODULE, "run", side_effect=fake_run) as run, \
                 patch("sys.stdout", io.StringIO()):
                with self.assertRaisesRegex(RuntimeError, "Backup failed"):
                    MODULE.main()
            sql.assert_called_once()
            self.assertNotIn("CREATE USER", sql.call_args.args[0])
            self.assertFalse(any("recover_runtime.sh" in " ".join(c.args[0]) for c in run.call_args_list))

    def test_default_mode_never_calls_docker(self):
        with patch.object(sys, "argv", ["recover_docker_site.py"]), patch.object(MODULE, "run") as run, patch("sys.stdout", io.StringIO()):
            MODULE.main()
        run.assert_not_called()

    def test_web_command_selects_site_and_supported_external_host(self):
        init = (Path(__file__).resolve().parents[1] / "docker/init.sh").read_text()
        function = init.split("configure_web_bind() {", 1)[1].split("\nconfigure_container_hosts()", 1)[0]
        with tempfile.TemporaryDirectory() as directory:
            procfile = Path(directory) / "Procfile"
            procfile.write_text("web: bench serve --port 8000\nworker: bench worker\n")
            script = "bench() { printf '%s\\n' '  --host TEXT'; }\nconfigure_web_bind() {" + function + "\nconfigure_web_bind"
            result = subprocess.run(["bash", "-c", script], cwd=directory,
                                    env={**os.environ, "HRMS_SITE": "hrms.localhost"},
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(procfile.read_text(), "web: bench --site hrms.localhost serve --host 0.0.0.0 --port 8000 --noreload\nworker: bench worker\n")
            before = procfile.read_bytes()
            result = subprocess.run(["bash", "-c", script], cwd=directory,
                                    env={**os.environ, "HRMS_SITE": "bad; command"},
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(procfile.read_bytes(), before)

    def test_rejects_unexpected_database_version(self):
        with self.assertRaisesRegex(ValueError, "frappe"):
            MODULE.verify_versions("frappe\t17.x.x-develop (8520ab9)\nerpnext\t17.x.x-develop (4545dd9)\nhrms\t17.0.0-dev")

    def test_accepts_verified_versions(self):
        MODULE.verify_versions("frappe\t17.x.x-develop (5003055)\nerpnext\t17.x.x-develop (4545dd9)\nhrms\t17.0.0-dev")

    def test_extra_database_app_stops_recovery(self):
        with self.assertRaisesRegex(ValueError, "application list"):
            MODULE.verify_versions("frappe\t17.x.x-develop (5003055)\nerpnext\t17.x.x-develop (4545dd9)\nhrms\t17.0.0-dev\ncustom\t1")

    def test_recovery_user_is_scoped_to_original_database(self):
        statement = MODULE.account_sql(config())
        self.assertIn(MODULE.DB, statement)
        for forbidden in ("ALTER USER", "DROP", "CREATE DATABASE", "*.*", "root"):
            self.assertNotIn(forbidden, statement)
        self.assertIn("CREATE USER IF NOT EXISTS", statement)

    def test_rejects_sql_injection_and_wrong_database(self):
        for key, value in (("db_name", "other"), ("db_user", "root"), ("db_password", "'; DROP DATABASE x;")):
            with self.assertRaises(ValueError):
                MODULE.account_sql({**config(), key: value})

    def test_site_configuration_is_exclusive_and_preserves_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            sites = Path(directory)
            (sites / "common_site_config.json").write_text('{"socketio_port": 9000}')
            source = MODULE.SITE_WRITER.replace("Path('/home/frappe/frappe-sites')", "Path(" + repr(directory) + ")")
            connection = MagicMock()
            connection.cursor.return_value.__enter__.return_value.fetchone.return_value = (37,)
            driver = types.SimpleNamespace(connect=MagicMock(return_value=connection))
            def execute(candidate):
                with patch.dict(sys.modules, {"pymysql": driver}), patch("sys.stdin", io.StringIO(json.dumps(candidate))), patch("sys.stdout", io.StringIO()):
                    exec(compile(source, "site-writer", "exec"), {})
            execute(config())
            target = sites / "hrms.localhost/site_config.json"
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertNotIn("encryption_key", json.loads(target.read_text()))
            self.assertEqual((sites / "apps.txt").read_text().splitlines(), ["frappe", "erpnext", "hrms"])
            preserved = {**config(), "encryption_key": "previous-key"}
            target.write_text(json.dumps(preserved))
            execute(config())
            self.assertEqual(json.loads(target.read_text()), preserved)
            before = target.read_bytes()
            with self.assertRaisesRegex(RuntimeError, "refusing overwrite"):
                execute({**config(), "db_user": "other"})
            self.assertEqual(target.read_bytes(), before)
            common = json.loads((sites / "common_site_config.json").read_text())
            self.assertEqual(common["socketio_port"], 9000)

    def test_database_failure_does_not_create_site_config(self):
        with tempfile.TemporaryDirectory() as directory:
            source = MODULE.SITE_WRITER.replace("Path('/home/frappe/frappe-sites')", "Path(" + repr(directory) + ")")
            driver = types.SimpleNamespace(connect=MagicMock(side_effect=RuntimeError("connection failed")))
            with patch.dict(sys.modules, {"pymysql": driver}), patch("sys.stdin", io.StringIO(json.dumps(config()))):
                with self.assertRaisesRegex(RuntimeError, "connection failed"):
                    exec(compile(source, "site-writer", "exec"), {})
            self.assertFalse((Path(directory) / "hrms.localhost/site_config.json").exists())


if __name__ == "__main__":
    unittest.main()
