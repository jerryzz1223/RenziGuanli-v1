# Existing Docker site recovery (2026-09-20)

## Confirmed incident evidence

- Commit `0e46a86` added a sites volume at `frappe-bench/sites`. Before that
  change, Compose persisted MariaDB but not the bench or site files.
- The server then reported a newly created `docker_frappe-sites` volume and a
  recreated Frappe container. Initialization failed because the mounted sites
  directory already made the bench directory exist.
- Commit `a1c4f7e` moved the mount outside the bench. Rebuilding subsequently
  encountered network and ownership errors.
- The existing-bench branch only checked `apps/frappe`, skipping the remaining
  applications and site initialization. Thus a framework-only server could run
  and return 404 while the expected site was absent.
- The reported database has 954 tables and a 193 MB SQL dump. This does not prove
  that the dump is restorable or that uploaded files and encryption keys survive.

## What this patch fixes

Daily deployment starts existing containers without recreating them, checks site
configuration and all three application imports, verifies database application
listing, then backs up the database and files before migration. The health check
uses the requested site Host header and verifies `pong`.

Startup no longer treats an application source directory as a complete site.
Site directory linking retains the original directory and refuses an automatic
merge into a nonempty destination. New bootstrap requires explicit opt-in and
reviewed framework/application refs. These guards do not recover missing data.

## Current server: collect evidence first

After copying/pushing the patch and pulling it on the server, run:

```bash
cd /home/jerry/Renzi/app
sudo bash scripts/diagnose_docker.sh
```

如果登录用户无权进入该目录，使用 root shell 将目录切换和脚本执行放在同一条命令中：

```bash
sudo bash -lc 'cd /home/jerry/Renzi/app && bash scripts/diagnose_docker.sh'
```

This reports container mounts, runtime revisions, application availability and
database version records without exposing passwords. It does not restart the
service, install packages, or migrate the database. Its version query targets
the database identified in this incident, `_0734c5df697fa9d2`.

Preserve the current container and the SQL backup. Do not run `new-site`,
`reinstall`, `down -v`, or `up --force-recreate` as a recovery shortcut.

## Recovery conditions before a normal deployment

The follow-up server report identified Frappe `5003055` and ERPNext `4545dd9`
in the existing database. Their full upstream revisions were verified as
`500305521544ed4e390535b84b142321c607d2db` and
`4545dd939a522175de1274a4502db0ea593999c9`. Both require Python 3.14.
The current container is missing ERPNext, HRMS and the site configuration.

For this specific server, the recovery runner is now available:

```bash
cd /home/jerry/Renzi/app
sudo python3 scripts/recover_docker_site.py --apply --migrate
```

Without `--apply` it only prints its plan. With `--apply` it pauses the existing
container in maintenance mode, backs up the database, sites and bench under a
root-only `/home/jerry/hrms-recovery-*` directory, then restores the pinned
runtime. It retains the original environment and application source directories.
It downloads the exact upstream dependency forks rather than replacing them with
different PyPI releases. Network/dependency failures stop recovery and leave the
maintenance marker in place. Use the exact `--resume` command printed by the
runner; do not start a second new recovery.

The runner creates a random dedicated database account restricted to the existing
database, verifies access before writing site configuration, and preserves the
old database account/password. It does not restore the missing encryption key or
old attachments. Its private `state.json` contains credentials and must not be
shared or committed. `--migrate` applies the current HRMS schema changes after
backup and runtime reconstruction; omit it to reconstruct without migration.

Success verifies host-local ping and the login route; browser login, old data,
attachments and integration credentials still require acceptance. No remote
server execution or end-to-end acceptance has been performed from the local
development workspace.

1. Confirm the old application's versions from database records or an original
   runtime backup, then restore/install matching runtime dependencies. This
   HRMS repository declares Frappe and ERPNext `>=17.0.0-dev,<18.0.0`; choosing
   version 15 simply because it is stable is not a compatible repair.
2. Restore the old site configuration into the actual persisted sites directory.
   If no original config exists, reconstruct a connection to the existing
   database only after verifying its credentials. Do not use the test config in
   `.github/helper`. Do not replace a missing encryption key with a random one
   and claim encrypted credentials have been recovered.
3. Verify original business records and recover site file bodies from backups
   where available. Restoring database File rows alone cannot restore attachments.
4. Confirm access under the intended hostname/IP using the actual runtime's
   routing configuration. The deploy health check validates the site hostname;
   a separate browser test must confirm direct IP access and login.
5. Only then run `sudo bash scripts/deploy_docker.sh --pull --site hrms.localhost`.

## Infrastructure changes

Normal deployment deliberately leaves existing container configuration intact.
Changing Compose, the image, architecture, or mounts requires a separate planned
operation: copy/export the original bench and sites, verify backups, arrange
persistence, use reviewed image and app revisions, then replace the container.
The bench still resides in the container writable layer in this Compose layout;
this patch prevents routine deployment from destroying it but does not silently
change mounts on an already damaged installation.
