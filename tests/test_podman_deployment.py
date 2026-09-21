import subprocess
import os
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PodmanDeploymentContracts(unittest.TestCase):
    def test_shell_scripts_parse(self):
        for relative in (
            "docker/init_podman_x86.sh",
            "scripts/diagnose_podman_x86.sh",
            "scripts/migrate_podman_x86_storage.sh",
            "scripts/deploy_podman_x86.sh",
        ):
            result = subprocess.run(
                ["bash", "-n", str(ROOT / relative)], capture_output=True, text=True
            )
            self.assertEqual(result.returncode, 0, f"{relative}: {result.stderr}")

    def test_compose_uses_external_preserved_volumes_and_selinux_bind(self):
        compose = (ROOT / "docker/docker-compose.podman-x86.yml").read_text()
        self.assertIn("platform: linux/amd64", compose)
        self.assertIn("- ..:/workspace:Z", compose)
        self.assertIn("name: docker_mariadb-data", compose)
        self.assertIn("name: hrms-x86-frappe-bench", compose)
        self.assertIn("name: hrms-x86-frappe-sites", compose)
        self.assertEqual(compose.count("external: true"), 3)

    def test_migration_is_dry_run_by_default_and_preserves_legacy_objects(self):
        script = (ROOT / "scripts/migrate_podman_x86_storage.sh").read_text()
        self.assertIn("APPLY=0", script)
        self.assertIn("podman commit", script)
        self.assertIn("podman save", script)
        self.assertIn("podman volume export", script)
        self.assertIn("server-worktree.patch", script)
        for forbidden in (
            "podman rm",
            "podman volume rm",
            "podman-compose up",
            "git pull",
        ):
            self.assertNotIn(forbidden, script)

    def test_migration_plan_only_uses_read_only_podman_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            project = temporary / "project"
            bin_dir = temporary / "bin"
            project.mkdir()
            bin_dir.mkdir()
            call_log = temporary / "podman-calls.txt"
            fake_podman = bin_dir / "podman"
            fake_podman.write_text(
                "#!/usr/bin/env bash\n"
                "printf '%s\\n' \"$*\" >> \"$PODMAN_CALL_LOG\"\n"
                "if [[ \"$1 $2\" == 'info --format' ]]; then\n"
                "  [[ \"$3\" == *Rootless* ]] && echo true || echo amd64\n"
                "elif [[ \"$1 $2\" == 'container exists' ]]; then\n"
                "  exit 0\n"
                "elif [[ \"$1\" == inspect && \"$*\" == *State.Running* ]]; then\n"
                "  echo false\n"
                "elif [[ \"$1\" == inspect && \"$*\" == *var/lib/mysql* ]]; then\n"
                "  echo docker_mariadb-data\n"
                "elif [[ \"$1 $2\" == 'volume inspect' ]]; then\n"
                "  echo present\n"
                "elif [[ \"$1 $2\" == 'volume exists' ]]; then\n"
                "  exit 1\n"
                "fi\n"
            )
            fake_podman.chmod(0o755)
            result = subprocess.run(
                [
                    "bash",
                    str(ROOT / "scripts/migrate_podman_x86_storage.sh"),
                    "--project-root",
                    str(project),
                ],
                env={
                    **os.environ,
                    "PATH": f"{bin_dir}:{os.environ['PATH']}",
                    "PODMAN_CALL_LOG": str(call_log),
                },
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = call_log.read_text()
            for mutation in ("commit ", "save ", "volume create", "volume export", "run "):
                self.assertNotIn(mutation, calls)
            self.assertFalse((temporary / "deployment-backups").exists())

    def test_daily_deploy_starts_existing_and_backs_up_before_migrate(self):
        script = (ROOT / "scripts/deploy_podman_x86.sh").read_text()
        self.assertIn('podman start "${MARIADB_CONTAINER}"', script)
        self.assertIn("backup --with-files", script)
        self.assertLess(
            script.index("backup --with-files"),
            script.index('bench --site "$1" migrate'),
        )
        for forbidden in ("podman-compose down", "podman volume rm", "podman rm"):
            self.assertNotIn(forbidden, script)

    def test_podman_init_never_bootstraps_or_replaces_site(self):
        script = (ROOT / "docker/init_podman_x86.sh").read_text()
        self.assertIn("refusing to bootstrap or replace", script)
        self.assertIn("0.0.0.0", script)
        for forbidden in ("new-site", "reinstall", "bench init", "rm -rf"):
            self.assertNotIn(forbidden, script)


if __name__ == "__main__":
    unittest.main()
