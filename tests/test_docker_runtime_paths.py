import importlib.util
import logging
import tempfile
import unittest
from logging.handlers import RotatingFileHandler
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "runtime_paths", Path(__file__).resolve().parents[1] / "docker/prepare_runtime_paths.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RuntimePathsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.bench = self.home / "frappe-bench"
        self.bench.mkdir()

    def test_external_sites_relative_log_path_can_be_opened(self):
        external = self.home / "frappe-sites"
        external.mkdir()
        (self.bench / "sites").symlink_to(external, target_is_directory=True)
        path = external / "../logs/database.log"
        with self.assertRaises(FileNotFoundError):
            RotatingFileHandler(path)
        MODULE.prepare_runtime_paths(self.bench)
        handler = RotatingFileHandler(path)
        try:
            handler.emit(logging.LogRecord("database", logging.INFO, "test", 1, "ready", (), None))
        finally:
            handler.close()
        self.assertIn("ready", (self.bench / "logs/database.log").read_text())
        MODULE.prepare_runtime_paths(self.bench)
        self.assertIn("ready", (self.bench / "logs/database.log").read_text())

    def test_normal_sites_needs_no_external_link(self):
        (self.bench / "sites").mkdir()
        MODULE.prepare_runtime_paths(self.bench)
        self.assertTrue((self.bench / "logs").is_dir())
        self.assertFalse((self.home / "logs").exists())

    def test_existing_external_logs_are_preserved(self):
        external = self.home / "frappe-sites"
        external.mkdir()
        (self.bench / "sites").symlink_to(external)
        logs = self.home / "logs"
        logs.mkdir()
        (logs / "database.log").write_text("existing history")
        MODULE.prepare_runtime_paths(self.bench)
        self.assertFalse(logs.is_symlink())
        self.assertEqual((logs / "database.log").read_text(), "existing history")

    def test_conflicting_file_is_not_overwritten(self):
        external = self.home / "frappe-sites"
        external.mkdir()
        (self.bench / "sites").symlink_to(external)
        (self.home / "logs").write_text("preserve")
        with self.assertRaises(ValueError):
            MODULE.prepare_runtime_paths(self.bench)
        self.assertEqual((self.home / "logs").read_text(), "preserve")


if __name__ == "__main__":
    unittest.main()
