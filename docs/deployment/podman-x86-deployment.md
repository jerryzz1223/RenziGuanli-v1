# EL9 x86 rootless Podman deployment

This procedure is only for the verified server at
/home/andrew/Renzi/RenziGuanli-v1:

- EL9, x86_64 / linux/amd64;
- rootless Podman owned by andrew;
- legacy containers named docker_mariadb_1, docker_redis_1, and
  docker_frappe_1;
- database volume docker_mariadb-data;
- the original 1.8 GB bench and 40 MB sites directory stored only in the stopped
  legacy Frappe container;
- the server-only :Z workspace bind required by SELinux.

Do not apply this procedure to the ARM server. Do not run it with sudo, because
rootful Podman uses a different container store.

## Safety boundary

Do not run podman-compose up, podman-compose down, podman rm, podman volume rm,
or podman system reset against the legacy project. A recreated legacy Frappe
container would hide or discard the only original bench/site copy.

The migration script keeps all legacy containers stopped and creates:

- a private recovery image archive of the old Frappe container;
- an offline export of the stopped MariaDB volume;
- hrms-x86-frappe-bench and hrms-x86-frappe-sites external volumes.

Before these files are committed and pulled, copy only the migration script from
the Mac to the server home directory:

    scp scripts/migrate_podman_x86_storage.sh andrew@192.168.1.209:/home/andrew/

Run the plan first:

    cd /home/andrew/Renzi/RenziGuanli-v1
    bash /home/andrew/migrate_podman_x86_storage.sh --project-root "$PWD"

After reviewing the output:

    bash /home/andrew/migrate_podman_x86_storage.sh --project-root "$PWD" --apply

The private backup is created under
/home/andrew/Renzi/deployment-backups/x86-podman-<timestamp>/. Do not upload its
container inspection JSON, database archive, or recovery image to GitHub.

## Reconcile the one server-local Compose change

The verified server has exactly one tracked modification: ../:/workspace was
changed to ../:/workspace:Z. The dedicated Podman Compose file now owns that
setting, so preserve the old patch and restore only the old Compose file before
pulling. Use the backup path printed by the migration script:

    cd /home/andrew/Renzi/RenziGuanli-v1
    git diff -- docker/docker-compose.yml
    git restore docker/docker-compose.yml
    git pull --ff-only

Do this only after server-worktree.patch exists in the private migration backup.
Do not use git reset --hard or remove any untracked server files.

## First creation using preserved volumes

The new project has different container names, so the stopped legacy containers
remain available as recovery evidence:

    bash scripts/deploy_podman_x86.sh --create --site hrms.localhost

The first deployment uses the old database volume and copied bench/site volumes,
backs up the site through Bench, migrates the schema, builds HRMS assets,
restarts Frappe, and checks the site-aware ping endpoint.

## Normal update

After the first accepted deployment:

    bash scripts/deploy_podman_x86.sh --pull --site hrms.localhost

This requires a clean Git worktree, starts the existing containers without
recreating them, takes a site backup before migration, builds assets, and checks
HTTP health. Use --skip-deps only when all lockfiles are unchanged.

## Acceptance

Script success proves only server-local site-aware ping. Separately verify:

1. http://192.168.1.209:8000/login from another LAN machine;
2. authenticated login;
3. expected employee count and representative employee records;
4. old public/private attachments (the verified legacy directories currently
   contain zero files, so confirm whether this server ever stored attachments);
5. DingTalk and other encrypted credentials, which depend on the original site
   encryption key.
