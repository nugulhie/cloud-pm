# GitHub 웹훅과 작업 큐

## 동작 방식

최초 연결 시 **GitHub 수동 동기화** 또는 `npm run sync`로 기존 이슈·PR을 한 번 가져옵니다. 이후에는 `npm run worker`가 웹훅의 변경 항목만 반영합니다. 정기 전체 수집용 cron은 등록하지 않습니다. 웹 화면의 15초 갱신은 저장된 데이터 조회입니다. 웹훅 누락이 의심될 때만 프로젝트를 선택해 수동 동기화합니다. 추가 설치한 저장소의 과거 이력도 최초 수동 수집이 필요합니다.

| 이벤트                       | 처리 범위                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| 이슈·댓글                    | 서명된 본문에서 제목·본문·상태·작성자·담당자·라벨 반영                                    |
| PR·리뷰                      | 해당 PR 메타데이터 반영. 커밋 SHA가 바뀌거나 diff 캐시가 없을 때 해당 PR 파일·커밋만 조회 |
| CI                           | 해당 SHA의 상태·검사만 조회. 동일 SHA의 대기 이벤트를 병합                                |
| 기본 브랜치 push·저장소 변경 | 해당 저장소의 `.cloud-pm/tasks` YAML 색인만 갱신                                          |
| 다른 브랜치 push             | 무시. PR 변경은 `pull_request.synchronize`로 수신                                         |

PR 머지 이벤트는 캐시된 YAML에서 해당 PR을 참조하는 완료 조건을 평가합니다. 다른 저장소에 둔 YAML도 지원하며 프로젝트의 연결 저장소 범위를 검사합니다. 자동 완료는 취소·수동 완료 상태를 덮어쓰지 않습니다. 조건 평가 시 누락된 PR 근거만 추가 조회합니다. 구버전 데이터는 YAML 색인을 한 번 보충하고, 본문이 없는 기존 실패·대기 작업은 저장소별 `since` 변경분으로 복구합니다. 프로세스를 재시작해도 전체 수집을 다시 예약하지 않습니다.

## 연결

GitHub App 사용자는 [App 설정 안내](github-app-setup.md)를 따릅니다. 기존 조직 웹훅도 `GITHUB_WEBHOOK_SECRET`으로 지원합니다.

1. 웹·작업자에 동일한 PostgreSQL `DATABASE_URL`, `GITHUB_ORG`, App 자격 증명 또는 `GITHUB_TOKEN`을 설정합니다.
2. Payload URL을 `https://서비스주소/api/webhooks/github`, Content type을 `application/json`으로 등록하고 Secret을 서버와 맞춥니다.
3. `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issues`, `issue_comment`, `push`, `check_run`, `check_suite`, `status`, `repository` 이벤트를 선택합니다.
4. `npm run worker`를 실행하고 GitHub delivery 응답과 서비스 작업 큐를 확인합니다.

`ping`과 미지원 이벤트는 작업을 만들지 않습니다. 원문 바이트의 HMAC-SHA256을 검증하고 조직·App 설치를 확인합니다. DB에는 delivery ID와 필요한 정규화 필드만 저장합니다. 인증 헤더·원본 전체 본문·댓글 자체는 보관하지 않습니다. 본문 제한은 1 MiB입니다.

## 중복·순서·재시도

- 영속 큐 저장 성공 시 202를 반환합니다. 같은 delivery ID는 다시 실행하지 않습니다.
- 이전 `updated_at`의 이벤트는 최신 캐시를 덮어쓰지 않습니다. 댓글에서 누락된 PR 머지·리뷰어·diff 정보는 보존합니다.
- 동일 SHA의 CI 및 같은 저장소 설정 작업은 성공 후에만 병합합니다. 처리 시작 이후 수신된 이벤트는 남깁니다.
- 수동 동기화와 웹훅 처리는 공통 임대로 직렬화합니다. 다른 동기화가 진행 중이면 시도 횟수를 소진하지 않고 대기합니다.
- claim은 `FOR UPDATE SKIP LOCKED`를 사용합니다. 임대는 90초, 갱신은 20초이며 이전 작업자는 새 임대의 작업을 완료할 수 없습니다.
- 일반 실패는 최대 5회, 30·60·120·240초 대기합니다. `failed` 작업은 웹·MCP에서 재시도할 수 있습니다.
- **API 403/429 한도 초과는 별도 대기**합니다. `Retry-After`·`X-RateLimit-Reset`을 따르며 시도 횟수를 소진하지 않습니다. 정상 인증 키는 무효화하지 않습니다. 백그라운드 조회는 사용자 작업을 위해 200회 예산을 남깁니다.
- API 대기 중에도 이슈 웹훅처럼 추가 조회가 없는 작업은 계속 처리합니다. PR 메타데이터와 머지 판정은 diff 조회보다 먼저 저장합니다.

전달 보장은 at-least-once입니다. 매시간 증분 보정과 저장소별 20개 원본 순환 검사를 수행합니다. 403·404는 접근 불가로 표시하고 본문·diff를 제거하며, 삭제로 단정하지 않습니다. 서명된 명확한 삭제 이벤트는 삭제 상태로 반영합니다. 정기 보정이 대기·실행 중이면 중복 생성하지 않고 API 한도에서는 재시도 시각까지 대기합니다. 설정 404는 경로 부재·접근 불가를 구별할 수 없어 해당 색인을 비웁니다. GitHub가 커밋 없는 저장소라고 명시한 409는 정상적인 빈 색인으로 처리하며, 다른 409·권한 오류는 재시도합니다. 다른 설정 조회 실패는 기존 색인을 유지하고 재시도합니다. 잘못된 YAML은 자동 완료 근거로 사용하지 않습니다.

## 검증

`npm test`는 서명·중복·임대·증분 반영·오래된 이벤트·SHA별 diff 재사용·저장소 간 완료 조건·한도 대기를 확인합니다. `tests/github-webhook-simulation.ts`는 Postman 로컬 HTTP 시뮬레이션으로 실제 클라이언트의 요청 범위와 403 복구를 검증합니다. 실제 운영 delivery 수신은 배포 후 별도로 확인합니다.

[GitHub 웹훅 이벤트](https://docs.github.com/en/webhooks/webhook-events-and-payloads) · [API 요청 제한](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) · [서명 검증](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
