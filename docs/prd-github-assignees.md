# PRD 담당자와 프로젝트 번호

2026-11-03 운영에서 기존 프로젝트 6개의 식별자와 GitHub 사용자 13명 조회, 기존 PRD 이슈 미리보기, 식별자 중복 차단, 원본 ID 보존을 확인했습니다. 프로필은 조직 App 연결 상태를 표시하고, 이미 연결된 GitHub 항목은 현재 프로젝트의 추가 작업에서 제외합니다.

## 프로젝트 기능 식별자

프로젝트 생성·수정 화면의 **기능 식별자 (5자리)**에 영문 대문자·숫자 5자리를 입력하거나 **식별자 자동 생성**을 누릅니다. 소문자는 대문자로 정규화합니다. 같은 워크스페이스에서 사용 중인 식별자는 중복 등록할 수 없습니다. 입력을 생략한 API·MCP·Asana 프로젝트 가져오기도 서버에서 자동 생성합니다.

PRD 표·새로 전환하는 태스크 제목·새 GitHub 이슈 제목에 `ADMIN-001`처럼 프로젝트 식별자와 프로젝트별 순번을 사용합니다. 기존 프로젝트는 첫 조회·수정 시 중복 없는 식별자를 자동 부여합니다. 내부 프로젝트 ID·YAML 참조·PRD 순번·CSV 원본 ID는 유지합니다. CSV 원본 ID는 표와 이슈 본문에 별도로 표시하며 CSV 중복 판정에도 계속 사용합니다.

식별자를 수정하면 PRD 표와 이후 생성하는 제목에 새 접두어를 사용합니다. 이미 생성한 태스크·GitHub 이슈의 제목을 일괄 변경하지 않습니다. 프로젝트 ID는 별도 고정 참조값이므로 기능 식별자와 혼동하지 마세요.

## GitHub 담당자 선택

PRD 작성·태스크 상세·담당자 일괄 수정의 목록은 서비스 가입자나 자유 입력 이름 대신 GitHub 로그인으로 표시합니다. 프로젝트에 저장소가 있으면 해당 저장소에 이슈를 배정할 수 있는 사용자들을 합쳐 보여줍니다. 저장소가 없는 Asana 프로젝트는 현재 워크스페이스에서 접근 가능한 GitHub 저장소의 사용자 목록을 사용합니다. 봇은 제외합니다. 미지정도 선택할 수 있습니다.

GitHub 담당자 목록은 현재 인증별로 최대 60초 캐시하며 인증이 다른 사용자끼리 공유하지 않습니다. 조회 실패 시 재시도 버튼을 제공합니다. 이전에 입력·가져온 일반 이름은 기존 값으로 보존하지만 새로운 선택 항목으로 취급하지 않습니다.

이슈 생성 창에서는 PRD 담당자를 기본 선택하고, **GitHub 이슈 담당자**에서 대상 저장소의 사용자로 바꿀 수 있습니다. 여기서 바꾼 값은 이번 GitHub 이슈에 적용하며 PRD·기존 태스크의 담당자를 자동 덮어쓰지 않습니다. 저장소·담당자를 바꾸면 본문을 다시 미리 봐야 합니다.

발행 직전에 GitHub 배정 가능 여부를 다시 확인합니다. 배정 불가·조회 실패이면 아직 이슈를 생성하지 않았다고 안내합니다. 생성 응답에서 담당자가 누락되면 이슈 링크와 경고를 남겨 중복 발행을 방지합니다. [GitHub 담당자 API](https://docs.github.com/en/rest/issues/assignees) · [이슈 생성 API](https://docs.github.com/en/rest/issues/issues#create-an-issue)

## API·MCP

- `GET /api/github/assignees?project=<ID>&repository=<owner/repo>`: `repository`는 선택 사항입니다. `{users:[{login,repositories}],repositories,scope}`를 반환합니다. `scope`는 `project` 또는 `workspace`이며 프로젝트·워크스페이스·저장소 접근 권한을 검사합니다.
- 프로젝트 저장·부분 수정에 `featurePrefix`를 지정합니다. 생략한 수정은 기존 값을 유지하며 새 프로젝트는 자동 생성합니다. 형식 오류는 400, 식별자 충돌은 409입니다.
- 이슈 미리보기·발행 입력에 선택적 `assignee`를 전달합니다. 생략하면 PRD 담당자, 빈 문자열이면 미지정입니다. `previewHash`는 저장소·본문·담당자를 함께 검증합니다. 발행 응답의 `assignmentWarning`이 있으면 생성된 원본에서 배정을 확인합니다.
- MCP `list_github_assignees`는 조회 연결에서도 제공됩니다. `save_requirement`, `preview_requirement_issue`, `publish_requirement_issue`, `create_project`, `update_project_fields`에도 같은 규칙을 적용합니다. 발행·수정은 쓰기 역할이 필요합니다.

## 검증

```sh
npx tsx --test tests/prd-project-prefix.test.ts tests/prd-github-assignees.test.ts tests/requirements.test.ts tests/requirement-csv.test.ts
npx playwright test e2e/prd-github-members.spec.ts
postman simulation run postman/simulations/github-app.sim.yaml --proxy --no-history --lift 'node --use-env-proxy --import tsx tests/prd-github-simulation.ts'
```

실제 App으로 담당자 목록과 배정 가능 여부 조회를 확인합니다. 외부 이슈 생성은 자체 GitHub 대체 서버의 HTTP 시뮬레이션으로 검증하며 실제 조직에 테스트 이슈를 만들지 않습니다.
