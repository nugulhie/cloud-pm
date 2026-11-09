#!/bin/sh
set -eu
umask 077
app_dir=${CLOUD_PM_APP_DIR:-/opt/cloud-pm-agent}
backup_root=${CLOUD_PM_BACKUP_DIR:-/var/backups/cloud-pm-agent/automatic}
if [ -f /etc/cloud-pm/operations.env ]; then
  set -a
  . /etc/cloud-pm/operations.env
  set +a
fi
cd "$app_dir"
mkdir -p "$backup_root"
exec 9>/var/lock/cloud-pm-backup.lock
flock -n 9 || exit 0
dc() { docker compose --env-file .env.production -f compose.ec2.yaml "$@"; }
restore_container=
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$backup_root/$backup_stamp"
mkdir -p "$backup_dir"
touch "$backup_dir/.cloud-pm-automatic"
on_exit() {
  result=$?
  trap - EXIT
  if [ -n "$restore_container" ]; then docker rm -fv "$restore_container" >/dev/null 2>&1 || true; fi
  if [ "$result" -ne 0 ]; then python3 deploy/ops-status.py backup failed 0 false; fi
  exit "$result"
}
trap on_exit EXIT
dc exec -T db pg_dump -U cloudpm -d cloud_pm -Fc > "$backup_dir/database.dump"
test -s "$backup_dir/database.dump"
dc exec -T db pg_restore --list < "$backup_dir/database.dump" > /dev/null
cp .env.production "$backup_dir/.env.production"
cp compose.ec2.yaml "$backup_dir/compose.ec2.yaml"
db_container=$(dc ps -q db)
db_image=$(docker inspect "$db_container" --format '{{.Image}}')
restore_password=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
restore_container=$(docker run --rm -d --network none --memory 192m --shm-size 64m -e POSTGRES_USER=cloudpm -e POSTGRES_DB=restore_check -e "POSTGRES_PASSWORD=$restore_password" "$db_image" postgres -c shared_buffers=16MB -c max_connections=10 -c work_mem=2MB)
attempt=0
until docker exec "$restore_container" pg_isready -U cloudpm -d restore_check >/dev/null 2>&1; do
  attempt=$((attempt+1))
  if [ "$attempt" -gt 60 ]; then exit 1; fi
  sleep 1
done
docker exec -i "$restore_container" pg_restore -U cloudpm -d restore_check --exit-on-error --no-owner --no-privileges < "$backup_dir/database.dump"
docker exec "$restore_container" psql -U cloudpm -d restore_check -Atc "SELECT json_build_object('accounts',(SELECT count(*) FROM app_users),'workspaces',(SELECT count(*) FROM workspace_settings),'records',(SELECT count(*) FROM records),'history',(SELECT count(*) FROM events));" > "$backup_dir/verified-counts.json"
(cd "$backup_dir" && sha256sum database.dump) > "$backup_dir/database.sha256"
offsite=false
if [ -n "${CLOUD_PM_BACKUP_S3_URI:-}" ]; then
  aws s3 cp "$backup_dir/database.dump" "${CLOUD_PM_BACKUP_S3_URI%/}/$backup_stamp/database.dump" --sse AES256 --only-show-errors
  aws s3 cp "$backup_dir/database.sha256" "${CLOUD_PM_BACKUP_S3_URI%/}/$backup_stamp/database.sha256" --sse AES256 --only-show-errors
  offsite=true
fi
bytes=$(wc -c < "$backup_dir/database.dump" | tr -d ' ')
python3 deploy/ops-status.py backup success "$bytes" "$offsite"
# Only automatic backups older than seven days are removed. Manual release backups are retained.
find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z' -mtime +7 -exec sh -c 'for backup_entry do if [ -f "$backup_entry/.cloud-pm-automatic" ]; then rm -rf -- "$backup_entry"; fi; done' sh {} +
printf 'Cloud PM backup and isolated restore verification completed: %s bytes\n' "$bytes"
