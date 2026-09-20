"""Exercise deployment ordering with a fake Docker CLI; no real containers used."""

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class DeploymentSafetyTests(unittest.TestCase):
    def run_deploy(self, scenario):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            (root / "docker").mkdir()
            (root / "bin").mkdir()
            (root / "docker/docker-compose.yml").touch()
            source = (Path(__file__).resolve().parents[1] / "scripts/deploy_docker.sh").read_text()
            # Only omit privilege escalation in this hermetic test copy.
            source, count = re.subn(
                r'if \[\[ \$\{EUID\} -ne 0 \]\]; then\n.*?\nfi',
                ': # privilege escalation omitted for fake Docker', source, count=1, flags=re.S,
            )
            self.assertEqual(count, 1)
            script = root / "scripts/deploy_docker.sh"
            script.write_text(source)
            fake = root / "bin/docker"
            fake.write_text(f"#!{sys.executable}\n" + '''
import json, os, sys
args = sys.argv[1:]
with open(os.environ["DOCKER_CALL_LOG"], "a") as output:
    output.write(json.dumps(args) + "\\n")
if args[0] == "inspect":
    print("true")
if args[0] == "compose" and args[3:7] == ["ps", "-a", "-q", "frappe"]:
    print("test-frappe-container")
command = " ".join(args)
scenario = os.environ["DEPLOY_TEST_SCENARIO"]
if scenario == "missing_site" and "check_site_ready.py" in command:
    sys.exit(1)
if scenario == "backup_failed" and "backup --with-files" in command:
    sys.exit(1)
''')
            fake.chmod(0o755)
            log = root / "calls.jsonl"
            result = subprocess.run(
                ["bash", str(script), "--site", "hrms.localhost", "--skip-deps"],
                env={**os.environ, "PATH": f"{root / 'bin'}:{os.environ['PATH']}",
                     "DOCKER_CALL_LOG": str(log), "DEPLOY_TEST_SCENARIO": scenario},
                capture_output=True, text=True, timeout=10,
            )
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            return result, calls

    def test_missing_site_stops_before_backup_or_migration(self):
        result, calls = self.run_deploy("missing_site")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("backup --with-files" in " ".join(c) for c in calls))
        self.assertFalse(any("migrate" in " ".join(c) for c in calls))

    def test_backup_failure_stops_migration(self):
        result, calls = self.run_deploy("backup_failed")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("migrate" in " ".join(c) for c in calls))

    def test_success_preserves_container_and_checks_requested_site(self):
        result, calls = self.run_deploy("success")
        self.assertEqual(result.returncode, 0, result.stderr)
        operations = [c[3] for c in calls if c[0] == "compose"]
        self.assertIn("start", operations)
        self.assertNotIn("up", operations)
        self.assertNotIn("run", operations)
        backup = next(i for i, c in enumerate(calls) if "backup --with-files" in " ".join(c))
        migrate = next(i for i, c in enumerate(calls) if "migrate" in " ".join(c))
        self.assertLess(backup, migrate)
        health = next(c for c in calls if "urllib.request.Request" in " ".join(c))
        self.assertIn('"Host": sys.argv[1]', " ".join(health))
        self.assertEqual(health[-1], "hrms.localhost")


if __name__ == "__main__":
    unittest.main()
