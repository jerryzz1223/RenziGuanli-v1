"""Prepare relative runtime paths when the physical sites CWD is external."""

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
    # The asset builder also uses ../apps, and commands may use ../env/config.
    # Only link existing bench directories, and reject conflicting destinations.
    physical_parent = sites.resolve().parent
    if physical_parent != bench:
        for name in ("apps", "env", "config"):
            target = bench / name
            if not target.is_dir():
                continue
            alias = physical_parent / name
            if not alias.exists() and not alias.is_symlink():
                alias.symlink_to(target, target_is_directory=True)
            if alias.resolve() != target.resolve():
                raise ValueError(f"Conflicting runtime path; refusing overwrite: {alias}")
    return runtime_logs


if __name__ == "__main__":
    print(f"Frappe runtime log directory ready: {prepare_runtime_paths(Path.cwd())}")
