#!/usr/bin/env python3
import datetime, json, os, sys
from pathlib import Path
root = Path(os.environ.get('CLOUD_PM_OPS_DIR', '/var/lib/cloud-pm-ops'))
root.mkdir(parents=True, exist_ok=True)
os.chmod(root, 0o755)
now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
kind = sys.argv[1]
if kind == 'health':
    value = {'checkedAt': now, 'diskUsedPercent': int(sys.argv[2]), 'app': sys.argv[3] == 'true', 'worker': sys.argv[4] == 'true', 'database': sys.argv[5] == 'true'}
elif kind == 'backup':
    path = root / 'backup.json'
    try:
        previous = json.loads(path.read_text())
    except (FileNotFoundError, ValueError):
        previous = {}
    ok = sys.argv[2] == 'success'
    value = {'checkedAt': now, 'lastSuccessAt': now if ok else previous.get('lastSuccessAt'), 'ok': ok, 'verified': ok, 'offsite': ok and sys.argv[4] == 'true', 'bytes': int(sys.argv[3]) if ok else 0}
else:
    raise SystemExit('unsupported status')
temporary = root / (kind + '.next')
temporary.write_text(json.dumps(value))
os.chmod(temporary, 0o644)
os.replace(temporary, root / (kind + '.json'))
