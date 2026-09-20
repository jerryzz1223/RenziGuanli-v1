import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "site_preflight", Path(__file__).resolve().parents[1] / "docker/check_site_ready.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SitePreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.bench = Path(self.temp.name)
        self.site = self.bench / "sites/hrms.localhost"
        self.site.mkdir(parents=True)

    def configure(self):
        (self.site / "site_config.json").write_text(json.dumps({
            "db_name": "existing_db", "db_password": "test-only", "encryption_key": "test-only"
        }))
        (self.bench / "sites/apps.txt").write_text("frappe\nerpnext\nhrms\n")
        for app in ("frappe", "erpnext", "hrms"):
            (self.bench / "apps" / app).mkdir(parents=True)

    def test_missing_site_never_creates_config(self):
        with self.assertRaisesRegex(ValueError, "Missing"):
            MODULE.check_site(self.bench, "hrms.localhost")
        self.assertFalse((self.site / "site_config.json").exists())

    def test_framework_only_runtime_is_rejected(self):
        self.configure()
        (self.bench / "sites/apps.txt").write_text("frappe\n")
        with self.assertRaisesRegex(ValueError, "erpnext"):
            MODULE.check_site(self.bench, "hrms.localhost", lambda app: None)

    def test_import_failure_does_not_expose_exception_secrets(self):
        self.configure()
        def failed_import(app):
            raise RuntimeError("secret-password")
        with self.assertRaises(ValueError) as caught:
            MODULE.check_site(self.bench, "hrms.localhost", failed_import)
        self.assertNotIn("secret-password", str(caught.exception))

    def test_valid_site_is_read_only(self):
        self.configure()
        before = (self.site / "site_config.json").read_bytes()
        MODULE.check_site(self.bench, "hrms.localhost", lambda app: None)
        self.assertEqual(before, (self.site / "site_config.json").read_bytes())

    def test_path_traversal_is_rejected(self):
        for site in ("..", ".", "../hrms.localhost"):
            with self.assertRaisesRegex(ValueError, "Invalid"):
                MODULE.check_site(self.bench, site)


if __name__ == "__main__":
    unittest.main()
