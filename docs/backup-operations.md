# 백업·복구와 운영 상태

## 정기 실행

EC2 배포 구성은 `deploy/backup.sh`, `deploy/healthcheck.sh`와 systemd 서비스를 사용한다. `compose.ec2.yaml`은 `/var/lib/cloud-pm-ops`의 상태 파일을 웹·작업자에 읽기 전용으로 연결한다. 상태 파일에는 비밀키·백업 내용이 들어가지 않는다.

```sh
sudo install -d -m 700 /etc/cloud-pm
sudo install -d -m 755 /var/lib/cloud-pm-ops
sudo install -m 644 deploy/cloud-pm-{backup,health}.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cloud-pm-backup.timer cloud-pm-health.timer
sudo systemctl start cloud-pm-backup.service
```

`/etc/cloud-pm/operations.env`는 root 전용 `0600`으로 작성한다. 실제 인스턴스 역할에 해당 S3 prefix의 암호화 업로드와 `CloudPM` 지표 게시 권한을 부여한다. 공유 인스턴스 역할에는 백업 접근을 추가하지 않는다.

```dotenv
AWS_DEFAULT_REGION=ap-northeast-2
CLOUD_PM_INSTANCE_ID=<instance-id>
CLOUD_PM_BACKUP_S3_URI=s3://<private-backup-bucket>/production
```

백업은 한국 시간 03시 전후에 실행한다. `pg_dump -Fc` 결과를 **동일 DB 이미지의 별도 컨테이너**에 실제 복원하고 계정·워크스페이스·레코드 수를 확인한 후 S3에 업로드한다. 복원 컨테이너는 네트워크를 차단하고 종료 시 임시 볼륨까지 제거한다. 운영 DB에 덮어쓰지 않는다. 실패는 5분 간격 최대 3회 재시도한다.

## 보존과 암호화 키

로컬 자동 백업은 `/var/backups/cloud-pm-agent/automatic/<UTC시각>/`에 7일 보관하며, 전용 표식이 있는 자동 백업만 정리한다. 배포 직전 수동 백업은 별도로 유지한다. 로컬에는 dump·해시·검증 수치·환경·compose를 root 전용으로 보관한다.

S3에는 dump와 해시만 AES256 서버 암호화로 업로드한다. 버전 관리·공개 접근 차단·TLS 강제를 사용하고 `production/` 객체와 이전 버전은 30일 정책으로 만료한다. 만료 시점의 실제 삭제는 S3 수명 주기 처리에 따른다.

**`TOKEN_ENCRYPTION_KEY`와 GitHub App 비밀 설정은 DB와 별도로 안전하게 보관해야 한다.** S3 DB 백업만으로 암호화된 기존 토큰을 복호화할 수 없다. 암호화 키를 임의로 재발급하지 않는다.

## 수동 복원

실서비스 복원 전에 별도 DB에 dump를 복원하고 수치와 로그인·업무 조회를 검증한다. 실제 이관은 쓰기·작업자를 중지하고 기존 DB·환경 백업 후 [EC2 이전 절차](ec2-migration.md)에 따라 진행한다. 최신 데이터가 있는 운영 DB를 테스트 목적으로 초기화하지 않는다.

```sh
sha256sum -c database.sha256
pg_restore --list database.dump
# 별도 빈 DB를 명시해야 한다. 실서비스 주소를 사용하지 않는다.
pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname="$RESTORE_CHECK_DATABASE_URL" database.dump
```

## 점검과 경보

```sh
systemctl list-timers 'cloud-pm-*'
systemctl status cloud-pm-backup.service cloud-pm-health.service
journalctl -u cloud-pm-backup.service --since '2 days ago'
```

상태 점검은 1분마다 앱 HTTP·작업자·DB 실행 상태와 디스크 사용률을 기록한다. 작업 큐의 관리자 카드와 `/api/operations`에서 확인한다. 80% 이상 디스크, 서비스 중단, 오래된 점검·백업, 실패·장기 대기 동기화는 경고 대상이다. 앱이 중단되면 앱 내 알림도 볼 수 없으므로 CloudWatch 콘솔의 EC2 CPU·상태 검사와 `CloudPM` 지표 경보를 함께 확인한다. 외부 메시지 수신처는 설정하지 않았으며 필요하면 운영자가 별도 지정한다.
