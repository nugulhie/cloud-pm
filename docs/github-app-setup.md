# GitHub App 조직 연동

`soldoc-kr`에 설치한 비공개 App으로 PR·이슈·파일 변경을 수집하고 PRD에서 봇 명의의 이슈를 생성합니다. PM은 GitHub 계정이나 PAT 없이 서비스 계정으로 참여합니다. App을 등록한 것만으로 서버 연결이 활성화되지는 않습니다.

2026-11-03 운영 웹·작업자에 App `5589960` / 설치 `178059528`을 적용했습니다. 설치된 저장소 58개와 PR·이슈 조회, GitHub 계정 없는 서비스 사용자의 대시보드·조회 전용 MCP 접근을 확인했습니다. 실제 GitHub ping은 200, 설치·저장소 이벤트는 202를 반환했고 서명 없는 요청은 401로 거부했습니다. 실제 `issues` 이벤트가 큐에서 1회 처리로 완료된 것도 확인했습니다. 검증 과정에서 외부 이슈를 생성하지는 않았습니다.

## 1. 조직 권한과 등록

조직 Owner에게 **App 생성 권한과 대상 저장소 설치 승인**을 요청합니다. 모든 App 관리 권한을 위임받으면 생성할 수 있지만, App manager 역할 자체가 조직 설치 권한을 주지는 않습니다. 설치는 조직 정책에 따라 Owner가 승인해야 합니다. [등록 권한](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) · [App manager 범위](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/adding-and-removing-github-app-managers-in-your-organization)

[조직 App 등록](https://github.com/organizations/soldoc-kr/settings/apps/new)에서 다음 값을 확인합니다. 로컬 `.data/aws-deploy/github-app-registration-url.txt`에는 같은 값이 채워진 URL이 있습니다. App 이름이 사용 중이면 고유한 이름을 선택합니다.

| 항목         | 값                                                       |
| ------------ | -------------------------------------------------------- |
| App 이름     | `cloud-pm-agent-soldoc`                                  |
| Homepage URL | `https://cloud-pm.soldoc.co.kr`                          |
| Setup URL    | `https://cloud-pm.soldoc.co.kr/`                         |
| Webhook URL  | `https://cloud-pm.soldoc.co.kr/api/webhooks/github`      |
| Webhook      | Active, SSL verification 활성화                          |
| 설치 범위    | Only on this account                                     |
| Callback URL | `https://cloud-pm.soldoc.co.kr/api/auth/github/callback` |
| Device Flow  | 사용하지 않음                                            |

Webhook secret에는 로컬 `.data/aws-deploy/github-app-webhook-secret.txt`의 값을 입력합니다. 이 파일은 권한 `600`이며 기존 조직 웹훅 비밀키와 별도로 생성했습니다. 비밀키를 URL·이슈·채팅에 붙이지 않습니다. 파일이 없으면 관리자가 새 비밀키를 만들어 GitHub와 서버에 동일하게 설정합니다.

Repository permissions는 **Metadata·Contents·Pull requests·Checks·Commit statuses: Read-only**, **Issues: Read and write**로 설정합니다. GitHub OAuth 가입·기존 계정 연결에는 Organization permissions의 **Members: Read-only**도 필요합니다. 앱 설정을 저장한 뒤 조직의 **Installed GitHub Apps → Configure**에서도 권한 변경을 승인합니다. Contents 쓰기 권한은 요청하지 않습니다. [권한 선택](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)

이벤트는 `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issues`, `issue_comment`, `push`, `check_run`, `check_suite`, `status`, `repository`를 선택합니다. 설치 변경 이벤트도 처리합니다.

## 2. 설치와 서버 설정

1. **Create GitHub App → Install App → soldoc-kr**에서 수집할 저장소를 선택하고 설치합니다. 설치 범위에 빠진 저장소는 조회되지 않습니다.
2. General의 **App ID**를 기록하고 **Generate a private key**로 PEM 파일을 내려받습니다. 서버 작업자에게 App ID와 이 컴퓨터에 저장된 PEM의 **경로**를 전달합니다. PEM 본문을 채팅에 복사하지 않습니다.
3. 공통 App 설정은 웹과 작업자에 적용합니다. OAuth Client Secret은 웹에만 전달하며 제공된 Compose 구성이 이를 분리합니다. 운영 Compose에서는 PEM을 base64 한 줄로 인코딩해 보호된 환경 파일에 저장합니다. base64는 암호화가 아닙니다. 기존 `TOKEN_ENCRYPTION_KEY`는 변경하지 않습니다.

```dotenv
GITHUB_ORG=soldoc-kr
GITHUB_APP_ID=<App ID>
GITHUB_APP_PRIVATE_KEY_BASE64=<PEM의 base64 값>
GITHUB_APP_WORKSPACE_ID=main
GITHUB_APP_WEBHOOK_SECRET=<등록 화면에 입력한 secret>
# GitHub OAuth용: 위 Callback URL 등록과 Members 읽기·설치 승인이 필요합니다.
GITHUB_APP_CLIENT_ID=<Client ID>
GITHUB_OAUTH_CLIENT_ID=<동일 App의 Client ID>
GITHUB_OAUTH_CLIENT_SECRET=<Client Secret>
# 선택: GITHUB_APP_INSTALLATION_ID
# 로컬에서는 BASE64 대신 GITHUB_APP_PRIVATE_KEY_PATH=/절대경로/app.pem
```

설치 ID는 조직에서 자동 조회합니다. JWT로 설치 토큰을 발급하고 만료 60초 전부터 새 토큰을 발급합니다. GitHub 설치 토큰은 일반적으로 1시간 유효합니다. 키 파일 교체·환경 변경 후에는 웹과 작업자를 재시작합니다. [설치 인증](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)

App은 지정한 워크스페이스와 관리자가 GitHub 조직 구성원 참여를 허용한 공간에 공유됩니다. 다른 공간의 개인·공용 PAT 동작은 유지합니다. App 설정이 없으면 기존 PAT를 사용하지만, App을 설정한 뒤 인증이 실패하면 PAT로 자동 우회하지 않습니다. 기존 공용 PAT는 연결 검증 후 관리자가 별도로 폐기합니다.

## 3. 웹훅 네트워크와 확인

2026-11-03 운영 ALB에 GitHub Meta API `hooks`의 IPv4 7개 대역을 HTTPS로 허용했습니다. 해당 대역의 요청은 **`cloud-pm.soldoc.co.kr` + `/api/webhooks/github` + POST** 조건을 충족해야 전달하며, 그 외 요청은 403으로 차단합니다. 기존 개인·사내 IP의 접근 규칙은 유지했습니다. 운영 ALB는 IPv4 형식이며 GitHub 발신 대역 변경 시 보안 그룹과 ALB source 조건을 함께 갱신해야 합니다. 문서의 예시 IP를 복사하지 말고 Meta API의 최신 값을 조회합니다. [GitHub 발신 IP 확인](https://docs.github.com/en/rest/meta/meta#get-github-meta-information)

연결 후 다음 순서로 확인합니다.

- 프로필 → 워크스페이스 GitHub 연결에 App과 설치된 저장소 개수가 표시되는지 확인합니다.
- 최초 **GitHub 동기화**를 실행해 현재 PR·이슈를 수집합니다. 추가 설치한 저장소도 최초 동기화를 실행합니다.
- GitHub App의 Advanced → Recent deliveries에서 `ping` 200, 저장소 이벤트 202 및 서비스 작업 큐의 처리 결과를 확인합니다.
- 기존 프로젝트에 필요한 저장소가 모두 설치 범위에 포함됐는지 확인합니다. 일부가 빠지면 해당 프로젝트가 숨겨질 수 있습니다.

웹훅으로 변경을 수집하므로 변경 확인용 상시 폴링에 의존하지 않아도 됩니다. GitHub는 실패한 delivery를 자동 재전송하지 않으므로 실패 기록 재전송과 주기적인 보정 동기화를 운영 정책으로 두는 것이 좋습니다. 수신 후 작업 큐의 재시도와 delivery 재전송은 별개입니다. [실패 delivery 처리](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)

## 검증과 현재 범위

단위 테스트는 JWT 서명·만료 전 갱신·설치 철회·조직/워크스페이스 범위·조회 전용 MCP 권한·웹훅 서명을 검증합니다. HTTP 시뮬레이션은 자체 작성한 GitHub 대체 서버를 사용합니다. 운영 검증은 실제 키·설치로 조회하고 GitHub delivery 기록과 서비스 응답을 확인한 별도의 증거입니다. Issues 쓰기 권한 설정은 확인했지만 실제 외부 이슈 발행은 검증하지 않았습니다.

```sh
npx tsx --test tests/github-app.test.ts
npx playwright test e2e/github-app.spec.ts
postman simulation run postman/simulations/github-app.sim.yaml --proxy --no-history --lift 'node --use-env-proxy --import tsx tests/github-app-simulation.ts'
```

## 새 조직과 서버·DB 이전

다른 조직의 App·최초 소유자 생성, 기존 조직 연결을 유지한 환경 이전은 [운영 튜토리얼](operations-tutorial.md)을 따릅니다. `TOKEN_ENCRYPTION_KEY`와 기존 DB를 함께 보존하고, 도메인이 바뀌면 Callback·Webhook URL도 갱신합니다.
