# 운영 시작·소유자 설정·조직 확장·환경 이전 튜토리얼

2026-11-05 구현 기준이다. **새 조직을 처음 시작하는 경우**와 **기존 데이터를 이전하는 경우**를 구분한다. 이전할 때는 빈 DB에서 가입부터 하지 말고, 기존 DB를 먼저 복원한다. 소유자·계정·PRD·태스크·GitHub 연결이 함께 이전된다.

현재 서비스의 도메인을 유지하고 새 EC2로 옮긴다면 [기존 ALB를 유지하는 EC2 이전 절차](ec2-migration.md)를 우선 따른다. 공용 대상 그룹을 보존하고 Cloud PM 경로만 새 서버로 전환한다.

## 1. 운영 방식을 선택한다

| 목적                                | 현재 지원하는 방식                                             |
| ----------------------------------- | -------------------------------------------------------------- |
| 같은 조직에서 팀·제품을 나누기      | 같은 서버에서 워크스페이스 생성. 생성자가 그 공간의 소유자     |
| 다른 GitHub 조직도 사용하기         | 조직별 서버 실행 구성·DB·GitHub App 분리                       |
| 현재 조직의 서버·DB 옮기기          | 전체 DB와 암호화 키·App 설정을 보존해 이전                     |
| 한 서비스에서 여러 GitHub 조직 연결 | 추가 개발 필요. 워크스페이스별 조직·설치 연결 화면은 아직 없음 |

서버 설정의 `GITHUB_ORG`와 `GITHUB_APP_INSTALLATION_ID`가 한 조직의 연결을 결정한다. 기존 서버의 이 값만 다른 조직으로 바꾸거나, 다른 조직에 기존 운영 DB를 복제하지 않는다. 서로 다른 조직의 사용자·저장소·업무 데이터가 섞일 수 있다.

아래 구성은 한 서버의 한 서비스에 해당한다. 물리 서버를 공유한다면 조직별 실행 구성·DB를 분리하고 기존 ALB·nginx에서 도메인별로 연결한다. 여러 Caddy가 같은 서버의 80·443 포트를 동시에 사용하도록 실행하지 않는다.

이 문서의 새 서버 명령은 저장소 루트에서 실행한다. 기존 EC2 명령은 `/opt/cloud-pm-agent`에서 실행한다. 명령을 복사하기 전에 대상 서버·DB를 확인한다.

## 2. 새 조직: GitHub App부터 준비한다

다른 조직에는 그 조직용 GitHub App을 별도로 등록한다. 기존 `soldoc-kr` App과 설치는 유지한다.

1. 새 조직의 **Settings → Developer settings → GitHub Apps → New GitHub App**으로 들어간다.
2. 서비스 도메인을 정하고 아래 URL을 등록한다.

   | 항목         | 예시                                                   |
   | ------------ | ------------------------------------------------------ |
   | Homepage URL | `https://cloudpm.example.com`                          |
   | Callback URL | `https://cloudpm.example.com/api/auth/github/callback` |
   | Webhook URL  | `https://cloudpm.example.com/api/webhooks/github`      |

3. Repository permissions는 **Metadata·Contents·Pull requests·Checks·Commit statuses: Read-only**, **Issues: Read and write**로 설정한다. Organization permissions의 **Members: Read-only**도 설정한다.
4. `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issues`, `issue_comment`, `push`, `check_run`, `check_suite`, `status`, `repository` 이벤트를 선택한다. Webhook을 활성화하고 별도의 secret을 설정한다.
5. App ID·Client ID·Client Secret·PEM 개인 키를 비밀 저장소에 보관한다. Client Secret은 사용자 OAuth용, PEM은 서버의 설치 인증용이다.
6. **Install App**에서 새 조직과 저장소를 선택한다. 설치 ID를 확인하고, 권한을 나중에 추가했다면 조직의 **Installed GitHub Apps → Configure**에서도 승인한다.

비공개 App은 소유한 계정에만 설치할 수 있다. 하나의 공개 App을 여러 조직에 설치하는 것은 GitHub가 지원하지만, 현재 서비스에는 설치별 연결·웹훅 분배가 구현되어 있지 않다. 공개 전환만으로 여러 조직 운영이 완성되지는 않는다. [공개 범위](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private) · [설치 권한 승인](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration#changing-the-permissions-of-a-github-app)

## 3. 새 환경: DB와 실행 구성을 준비한다

Docker Compose와 HTTPS 도메인이 필요하다. DB 방화벽은 앱·작업자와 관리용 복원 환경에서만 접근하도록 설정한다. 현재 운영 DB는 PostgreSQL 18이다. 첫 이전은 같은 주 버전으로 진행하고 버전 업그레이드는 별도로 검증한다.

### 외부 PostgreSQL을 사용하는 경우

```sh
cp deploy/external-db.env.example deploy/.env.external-db
chmod 600 deploy/.env.external-db
```

비밀 설정 파일을 편집해 아래 값을 채운다. 실제 비밀값을 채팅·명령 인자·Git에 넣지 않는다.

| 설정                            | 새 조직                       | 기존 환경 이전            |
| ------------------------------- | ----------------------------- | ------------------------- |
| `DOMAIN`                        | 새 서비스 도메인              | 유지하거나 새 도메인 지정 |
| `DATABASE_URL`                  | 새 조직의 빈 DB               | 기존 백업을 복원할 DB     |
| `TOKEN_ENCRYPTION_KEY`          | `openssl rand -hex 32`로 생성 | **기존 값 그대로**        |
| `GITHUB_ORG`                    | 새 조직 이름                  | `soldoc-kr` 유지          |
| App ID·Client ID·설치 ID·PEM    | 새 조직 App 값                | 기존 App 값 유지          |
| `GITHUB_OAUTH_CLIENT_ID/SECRET` | 새 App 값                     | 기존 값 유지              |
| App·기존 웹훅 secret            | 새로 생성                     | 기존 값 유지              |

`DATABASE_URL`은 `postgresql://사용자:비밀번호@호스트:5432/cloud_pm?sslmode=verify-full` 형태다. 사용자·비밀번호는 URL 인코딩하고, DB 제공자의 접속 주소·TLS·CA 설정을 따른다. 별도 CA가 필요하면 두 컨테이너에 인증서 파일을 읽기 전용으로 마운트하고 `NODE_EXTRA_CA_CERTS`를 지정한다. 인증서 검증을 끄는 설정으로 대체하지 않는다. [node-postgres TLS 설정](https://node-postgres.com/features/ssl)

```sh
docker compose -p cloud-pm-production --env-file deploy/.env.external-db -f compose.external-db.yaml config --quiet
docker compose -p cloud-pm-production --env-file deploy/.env.external-db -f compose.external-db.yaml build app worker
```

`compose.external-db.yaml`은 **독립 실행 구성**이며 DB 컨테이너를 만들지 않는다. 웹과 작업자 모두 지정한 외부 DB를 사용한다. 기존 `compose.production.yaml`·`compose.ec2.yaml`은 내부 `db:5432`를 사용하므로 해당 구성에서 `.env`에 `DATABASE_URL`만 추가해도 변경되지 않는다.

외부 DB용 CA 추가 예시다. `deploy/compose.db-ca.yaml`에 작성하고 이후 모든 Compose 명령에 `-f deploy/compose.db-ca.yaml`도 지정한다. 경로는 첫 Compose 파일이 있는 저장소 루트를 기준으로 한다.

```yaml
services:
  app:
    environment:
      NODE_EXTRA_CA_CERTS: /run/db-ca.pem
    volumes:
      - ./deploy/db-ca.pem:/run/db-ca.pem:ro
  worker:
    environment:
      NODE_EXTRA_CA_CERTS: /run/db-ca.pem
    volumes:
      - ./deploy/db-ca.pem:/run/db-ca.pem:ro
```

CA는 DB 제공자의 공식 배포본을 사용한다. 이미지 빌드는 기존처럼 개발·CI 환경에서 수행해 운영 서버로 전달할 수도 있다. CPU 아키텍처가 다르면 대상에 맞춰 빌드한다.

### 서버 안의 PostgreSQL을 사용하는 경우

[기존 배포 안내](deployment.md)의 `deploy/production.env.example`과 `compose.production.yaml`을 사용한다. 이후 예제의 외부 DB용 파일명을 이 구성으로 바꾸고, DB는 먼저 `up -d db`로 실행한다. 기존 EC2의 ALB·nginx를 유지한다면 `compose.ec2.yaml`을 사용하며 Caddy의 80·443을 중복으로 열지 않는다.

## 4. 완전히 새 DB: 첫 소유자를 만든다

**기존 DB 이전이라면 이 절을 건너뛰고 6절로 간다.**

1. 최초 가입 전에는 서비스 접근을 운영 담당자에게만 허용한다. 현재 최초 설정 마법사나 소유자 예약 환경변수는 없다. **첫 가입자가 기본 워크스페이스 소유자**가 되므로 공개한 채로 기다리지 않는다.
2. 웹과 프록시만 시작한다. 외부 DB가 준비되어 있어야 한다.

   ```sh
   docker compose -p cloud-pm-production --env-file deploy/.env.external-db -f compose.external-db.yaml up -d app proxy
   ```

3. 서비스에서 **회원가입**을 선택해 운영 책임자 개인의 서비스 아이디·표시 이름·10자 이상의 비밀번호를 등록한다. 공통 초기 비밀번호나 기본 `master` 계정은 없다. GitHub OAuth로 처음 가입해도 같은 소유자 규칙을 적용하지만, 서비스 계정부터 만들면 GitHub 설정과 소유자 생성을 따로 확인할 수 있다.
4. **왼쪽 아래 프로필 → 워크스페이스**에서 자신의 역할이 **소유자**인지 확인한다. 소유자는 워크스페이스 단위이며 모든 조직에 통하는 전역 마스터는 없다.
5. 기존 소유자 계정을 유지한 상태에서 **프로필 → GitHub 계정 연결**을 진행한다. 연결한 GitHub 계정은 해당 조직의 활성 구성원이어야 한다. 기존 계정과 별도로 OAuth 가입하면 같은 서비스 계정으로 자동 합쳐지지 않는다.
6. **워크스페이스 멤버·초대**에서 팀원을 참여시키고, 추가 운영 담당자는 **관리자 → 역할 저장**으로 지정한다. 관리자 지정은 소유자만 할 수 있다. 새 워크스페이스를 만들면 생성자가 그 공간의 소유자가 된다.
7. 가입 정책을 선택한다. GitHub 조직 구성원의 자동 참여가 필요하면 해당 옵션을 유지하고, 서비스 계정의 가입은 필요에 따라 **초대 링크로만 신규 가입 허용**을 설정한다. GitHub 계정 없는 PM은 서비스 계정·초대 링크로 참여한다.
8. GitHub App의 **Members: Read-only**와 **조직 설치 승인**을 확인하고 개발자 로그인을 시험한다. 앱 설정 저장만으로 기존 설치의 권한이 승인되지는 않는다.
9. 초기 설정을 마친 뒤 작업자를 시작하고 프로젝트를 등록한다. 프로젝트에 저장소와 5자 기능 식별자를 지정하고 **GitHub 동기화**로 최초 데이터를 수집한다. 이후 변경은 웹훅으로 반영한다.

   ```sh
   docker compose -p cloud-pm-production --env-file deploy/.env.external-db -f compose.external-db.yaml up -d worker
   ```

소유자 양도 화면·비밀번호 분실 복구는 아직 없다. 다른 사람에게 소유권을 넘겨야 한다면 백업 후 별도의 관리 절차가 필요하며, 멤버 역할 선택에서 소유자를 지정할 수는 없다.

### 한 PRD를 두 명이 작업하는 예시

PRD의 담당자 필드는 대표 담당자 한 명이다. 실행 담당자는 **PRD 관리 → 개발 태스크 추가 / 태스크 관리 → 프론트엔드·백엔드로 나누기**에서 태스크별로 지정한다.

| PRD      | 개발 태스크   | 담당자            | 저장소         |
| -------- | ------------- | ----------------- | -------------- |
| 회원가입 | 회원가입 화면 | 프론트엔드 개발자 | `org/frontend` |
| 회원가입 | 회원가입 API  | 백엔드 개발자     | `org/backend`  |

**2개 태스크 저장** 후 각 태스크에서 GitHub 이슈를 생성한다. 각 이슈는 해당 태스크에 연결되고 PRD에서 함께 조회된다. GitHub 아이디가 같은 서비스 계정은 자동 매칭하며, 가져온 실명은 **담당자 매칭**에서 계정에 연결한다. [상세 계약](prd-tasks.md)

## 5. 현재 운영에서 보존할 항목

2026-11-05 확인 기준으로 운영 도메인은 `cloud-pm.soldoc.co.kr`, 조직은 `soldoc-kr`, App ID는 `5589960`, 설치 ID는 `178059528`이다. 기본 공간 `main`의 소유자 서비스 아이디는 **`hyeokju98`**다. 기존 계정에 GitHub를 연결하면 소유자 권한을 유지한다. GitHub OAuth 가입 자체가 기존 공간의 소유자 권한을 부여하지는 않는다.

| 보존 항목                     | 보존 이유                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------- |
| PostgreSQL 전체 백업          | 계정·소유권·초대·세션·MCP 토큰 해시·PRD·태스크·정책·용어·매칭·계획·웹훅 큐 보존 |
| `TOKEN_ENCRYPTION_KEY`        | DB 안의 개인·공용 GitHub 토큰 복호화. 새로 만들면 기존 암호문을 읽을 수 없음    |
| App ID·Client ID·설치 ID·PEM  | 기존 조직 설치를 계속 사용하고 새 설치 토큰 발급                                |
| OAuth Client ID·Client Secret | 기존 GitHub 사용자 인증 유지                                                    |
| 웹훅 secret                   | 기존 GitHub 서명 검증                                                           |
| 코드 버전·Compose·이미지 참조 | 같은 버전으로 이전하고 문제 시 복구                                             |

DB 접속 비밀번호는 새 DB에 맞게 바꿔도 된다. **토큰 암호화 키와 DB 비밀번호는 다른 값**이다. PEM·OAuth Secret·암호화 키는 DB 백업에 포함되지 않으므로 별도로 안전하게 전달한다. 만료된 설치 토큰이나 사용자 OAuth 임시 토큰을 복사할 필요는 없다.

## 6. 기존 DB와 서버를 이전한다

이 절은 짧은 점검 시간을 두는 절차다. 무중단 이전·DB 복제 구성은 포함하지 않는다. 먼저 별도 테스트 DB에 백업 복원과 기존 계정 로그인을 연습하고, 실제 전환 시간에 최종 백업을 다시 만든다.

### 6-1. 새 환경을 미리 준비한다

1. 현재 운영과 같은 코드 버전·이미지를 준비한다. 첫 이전에서 기능 업데이트를 함께 하지 않는다.
2. **비어 있는 전용 목적지 DB**를 만들고 새 환경 파일에 기존 암호화 키와 App 설정을 넣는다. 앱·작업자는 복원이 끝날 때까지 실행하지 않는다. 자동으로 테이블을 만든 DB에 그대로 복원하면 충돌한다.
3. DB 방화벽·TLS·CA, 앱 도메인의 인증서·프록시를 준비한다. DB만 이전한다면 기존 웹 서버와 `APP_URL`·GitHub URL 설정은 유지한다.
4. 도메인을 바꾼다면 새 Callback URL을 기존 App에 **추가**한다. 검증 전에는 기존 Callback URL도 남겨 둔다. 서버의 `DOMAIN`으로부터 `APP_URL`과 OAuth 콜백을 만든다. [콜백 등록 규칙](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url)

### 6-2. 기존 환경의 쓰기를 멈추고 최종 백업한다

사용자와 MCP의 수정 요청, GitHub 웹훅이 기존 DB에 새로 기록되지 않도록 앞단에서 점검 응답으로 전환한다. GitHub의 이 기간 실패 delivery는 전환 후 확인·재전송한다.

기존 EC2에서 실행한다. DB 컨테이너와 볼륨은 유지한다.

```sh
cd /opt/cloud-pm-agent
set -eu
umask 077
mkdir -p migration-backup
chmod 700 migration-backup
docker compose --env-file .env.production -f compose.ec2.yaml stop -t 1800 worker
docker compose --env-file .env.production -f compose.ec2.yaml stop -t 120 app
docker compose --env-file .env.production -f compose.ec2.yaml exec -T db psql -U cloudpm -d cloud_pm -Atc "SELECT count(*) FROM sync_leases WHERE expires_at>now()"
```

마지막 조회의 임대 수가 **0**인 것을 확인한다. 0이 아니면 남아 있는 별도 작업자·CLI·stdio MCP 등 쓰기 프로세스도 확인하고, 종료·임대 만료 후 다시 조회한다. 운영 DB를 쓰는 다른 프로세스가 없어야 한다.

```sh
test ! -e migration-backup/cloud-pm.dump
docker compose --env-file .env.production -f compose.ec2.yaml exec -T db pg_dump -U cloudpm -d cloud_pm -Fc > migration-backup/cloud-pm.dump.partial
docker compose --env-file .env.production -f compose.ec2.yaml exec -T db pg_restore --list < migration-backup/cloud-pm.dump.partial > migration-backup/archive-list.txt
mv migration-backup/cloud-pm.dump.partial migration-backup/cloud-pm.dump
cp .env.production migration-backup/original.env
cp compose.ec2.yaml migration-backup/compose.ec2.yaml
chmod 600 migration-backup/*
sha256sum migration-backup/cloud-pm.dump > migration-backup/cloud-pm.dump.sha256
```

각 명령이 성공했는지 확인하고 오류가 있으면 다음 단계로 넘어가지 않는다. 백업·설정은 암호화된 전송 경로로 새 환경에 전달하고 해시를 비교한다. 기존 PostgreSQL 데이터 디렉터리를 새 DB 서버에 단순 복사하지 않는다. Custom 형식은 `pg_restore`로 복원한다. [PostgreSQL 백업](https://www.postgresql.org/docs/18/app-pgdump.html)

### 6-3. 목적지 빈 DB에 복원한다

관리용 환경에서 `deploy/.env.restore`를 권한 `600`으로 만들고 DB 제공자의 값을 넣는다. 이 파일은 앱의 URL 인코딩 비밀번호와 달리 libpq가 사용할 **원래 비밀번호**를 받는다.

```dotenv
PGHOST=db.example.com
PGPORT=5432
PGDATABASE=cloud_pm
PGUSER=cloudpm
PGPASSWORD=<목적지 DB 비밀번호>
PGSSLMODE=verify-full
```

DB 이름은 이 예제에서 `cloud_pm`이다. 다른 이름이라면 다음 `--dbname`도 바꾼다. 백업 파일을 `migration-backup/cloud-pm.dump`에 둔 상태에서 실행한다.

```sh
docker run --rm --env-file deploy/.env.restore -v "$PWD/migration-backup:/backup:ro" postgres:18-alpine pg_restore --dbname=cloud_pm --exit-on-error --single-transaction --no-owner --no-privileges /backup/cloud-pm.dump
```

별도 CA가 필요하면 위 Docker 명령에 인증서 파일 마운트를 추가하고 `PGSSLROOTCERT`에 **컨테이너 안의 경로**를 설정한다. 목적지 계정은 전용 DB의 테이블·인덱스를 생성할 수 있어야 한다. 복원은 빈 DB에서 한 번 실행하며 실패 시 오류를 해결한 뒤 별도의 빈 DB로 다시 연습한다. 기존 운영 DB에 `--clean`을 실행하거나 볼륨을 삭제하는 절차는 사용하지 않는다. [pg_restore 옵션](https://www.postgresql.org/docs/18/app-pgrestore.html)

복원 후 앱이 뜨기 전에 기존 소유자가 보존됐는지 조회한다.

```sh
docker run --rm --env-file deploy/.env.restore postgres:18-alpine psql -X -v ON_ERROR_STOP=1 -c "SELECT w.id AS workspace,u.login AS owner,m.role FROM workspace_settings w JOIN app_users u ON u.id=w.owner_id JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=u.id;"
```

현재 운영의 `main / hyeokju98 / owner`가 보여야 한다. 새 소유자를 다시 가입시키거나 기존 계정을 지울 필요가 없다. 인증서 마운트를 사용했다면 이 조회 명령에도 동일하게 적용한다.

### 6-4. 새 웹을 검증하고 주소를 전환한다

1. 새 웹과 프록시만 시작한다. 작업자는 아직 시작하지 않는다.
2. 운영자 접근만 허용한 상태에서 헬스·기존 소유자 로그인·프로젝트·PRD·정책·태스크·담당자·스프린트와 데이터 수를 확인한다.
3. **동일 도메인 유지:** DNS 또는 기존 ALB의 대상을 새 환경으로 바꾼다. App·설치·Callback/Webhook URL을 다시 등록할 필요는 없다. DB만 바꾼다면 앱과 작업자 모두의 접속 주소를 바꾼다.
4. **도메인 변경:** 새 DNS·인증서를 적용하고 App의 Homepage·Callback·Webhook URL을 새 주소로 맞춘다. Callback은 `/api/auth/github/callback`, Webhook은 `/api/webhooks/github`다. Claude의 MCP 주소와 공유·초대 링크도 새 주소로 안내한다.
5. 기존 OAuth 임시 state로 돌아가지 말고 새 주소에서 GitHub 로그인을 다시 시작한다. 새 도메인에는 기존 로그인 쿠키가 없으므로 다시 로그인한다.

```sh
curl --fail --silent --show-error https://cloudpm.example.com/api/health
curl --fail --silent --show-error https://cloudpm.example.com/api/auth/github/config
```

첫 응답은 `{"status":"ok"}`, 둘째는 `enabled: true`와 의도한 조직·콜백 주소여야 한다. GitHub App의 설치·권한은 유지하며 서버 이전만으로 App을 재설치하지 않는다.

### 6-5. 새 작업자와 웹훅을 재개한다

```sh
docker compose -p cloud-pm-production --env-file deploy/.env.external-db -f compose.external-db.yaml up -d worker
docker compose -p cloud-pm-production --env-file deploy/.env.external-db -f compose.external-db.yaml ps
```

1. 기존 작업자는 계속 중지한 상태로 둔다. 이전 서버의 자동 재기동·별도 스케줄러도 새 DB에 쓰지 않도록 한다.
2. GitHub App의 **Advanced → Recent deliveries**에서 새 서버 수신과 2xx 응답을 확인한다. 점검 중 실패 delivery는 확인 후 재전송하고 작업 큐의 완료 상태를 확인한다.
3. 누락 여부를 확인하고 필요한 범위만 수동 동기화한다. 전체 DB·색인을 복원했다면 매번 최초 전체 수집을 반복할 필요는 없다.
4. 기존 MCP 토큰은 DB 해시를 복원했으면 유효기간·권한 범위 내에서 계속 쓸 수 있다. 도메인을 바꿨다면 커넥터 주소를 바꾼다. 토큰을 재발급하면 이전 토큰이 무효화된다.
5. 팀에 사용 재개를 알리고 기존 DB·설정·이미지 백업을 검증 기간 동안 보존한다.

### 6-6. 문제가 생기면 복구한다

새 환경에서 아직 새 데이터가 기록되지 않았다면 새 웹·작업자를 멈추고 주소를 기존 환경으로 되돌린 뒤 기존 웹·작업자를 재개할 수 있다. 도메인을 바꿨다면 Webhook URL도 기존 값으로 복구한다.

**새 환경에서 수정·가입·이슈 발행을 이미 받았다면 DNS만 되돌리지 않는다.** 새 환경의 모든 쓰기를 먼저 멈추고 최종 DB를 백업한 뒤 기존 환경으로 역이관하거나, 새 환경에서 원인을 수정한다. 외부 GitHub에 생성된 이슈는 DB 복원만으로 취소되지 않는다. 사용자 데이터와 외부 발행 결과를 확인한 후 재개한다.

## 7. 사용 재개 전 확인

- 기존 소유자의 서비스 아이디·비밀번호 또는 연결된 GitHub 로그인으로 접근된다.
- 앱과 조직 설치 양쪽에서 `Members: Read-only`가 승인되어 있다.
- 프로젝트·PRD·태스크·정책·용어·하위 작업·스프린트·매칭표가 보존되어 있다.
- 가져온 담당자와 GitHub 계정이 매칭되고 작업별 일정·공수가 표시된다.
- 실제 운영에 영향을 주지 않는 테스트 항목으로 저장·수정·파일 미리보기를 확인한다.
- 웹훅 큐가 처리되고 기존·새 작업자가 서로 다른 DB에 동시에 기록하지 않는다.
- Claude에서 MCP 초기화·도구 조회와 조회 전용/수정 권한을 확인한다.
- 새 환경의 방화벽·프록시가 팀원, GitHub 웹훅, 필요한 Claude 원격 MCP 요청을 허용한다.
- DB 백업과 별도 암호화 키·App 비밀 설정을 복구 가능한 위치에 보관한다.

## 8. 이 문서에서 검증한 범위

격리된 PostgreSQL 18 두 개와 운영 버전의 웹 이미지로 외부 DB 기동, 최초 소유자·일반 멤버 생성, 관리자 승격, `pg_dump -Fc`·`pg_restore`를 확인했다. 복원 후 사용자 ID·비밀번호 로그인·권한·GitHub 계정 연결 정보·기존 세션을 보존했다. Compose의 DB 주소 일치·로컬 DB 서비스 부재·OAuth Secret의 앱 전용 전달도 확인했다. 실제 이전 대상의 TLS·방화벽·DNS·GitHub OAuth·Claude 연결은 목적지가 정해진 뒤 별도로 검증한다. 이번 작업에서 운영 DB·소유권·GitHub App 설정은 변경하지 않았다.
