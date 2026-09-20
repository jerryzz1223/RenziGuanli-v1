"""Prepare logging paths for Frappe versions using ../logs from the sites CWD."""

from pathlib import Path


def prepare_runtime_paths(bench):
    bench = bench.resolve()
    sites = bench / "sites"
    if not sites.is_dir():
        raise ValueError("Sites directory must exist before preparing runtime paths")
    bench_logs = bench / "logs"
    bench_logs.mkdir(exist_ok=True)
    # chdir through a sites symlink changes the kernel's physical cwd. Frappe's
    # ../logs consequently resolves beside the volume, not beside bench/sites.
    runtime_logs = sites.resolve().parent / "logs"
    if runtime_logs != bench_logs:
        if not runtime_logs.exists() and not runtime_logs.is_symlink():
            runtime_logs.symlink_to(bench_logs, target_is_directory=True)
        if not runtime_logs.is_dir():
            raise ValueError(f"Existing log path is not a usable directory: {runtime_logs}")
    # Preserve existing directories/symlinks; do not overwrite log files or
    # recursively change ownership. Let normal permission errors remain visible.
    return runtime_logs


if __name__ == "__main__":
    print(f"Frappe runtime log directory ready: {prepare_runtime_paths(Path.cwd())}")
