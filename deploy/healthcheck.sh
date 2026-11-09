#!/bin/sh
set -eu
if [ -f /etc/cloud-pm/operations.env ]; then
  set -a
  . /etc/cloud-pm/operations.env
  set +a
fi
app_dir=${CLOUD_PM_APP_DIR:-/opt/cloud-pm-agent}
cd "$app_dir"
dc() { docker compose --env-file .env.production -f compose.ec2.yaml "$@"; }
state() {
  container=$(dc ps -q "$1")
  if [ -z "$container" ]; then printf false; else docker inspect "$container" --format '{{.State.Running}}'; fi
}
app=$(state app)
worker=$(state worker)
database=$(state db)
if ! curl --fail --silent --max-time 10 http://127.0.0.1:3000/api/health >/dev/null; then app=false; fi
disk=$(df -P / | awk 'NR==2 {gsub(/%/, "", $5);print $5}')
python3 deploy/ops-status.py health "$disk" "$app" "$worker" "$database"
if [ -n "${CLOUD_PM_INSTANCE_ID:-}" ] && command -v aws >/dev/null 2>&1; then
  app_down=0; worker_down=0; database_down=0
  [ "$app" = true ] || app_down=1
  [ "$worker" = true ] || worker_down=1
  [ "$database" = true ] || database_down=1
  aws --cli-connect-timeout 3 --cli-read-timeout 5 cloudwatch put-metric-data --namespace CloudPM --metric-data "MetricName=DiskUsedPercent,Dimensions=[{Name=InstanceId,Value=$CLOUD_PM_INSTANCE_ID}],Value=$disk,Unit=Percent" "MetricName=AppDown,Dimensions=[{Name=InstanceId,Value=$CLOUD_PM_INSTANCE_ID}],Value=$app_down,Unit=Count" "MetricName=WorkerDown,Dimensions=[{Name=InstanceId,Value=$CLOUD_PM_INSTANCE_ID}],Value=$worker_down,Unit=Count" "MetricName=DatabaseDown,Dimensions=[{Name=InstanceId,Value=$CLOUD_PM_INSTANCE_ID}],Value=$database_down,Unit=Count" >/dev/null || true
fi
