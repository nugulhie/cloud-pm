# MCP 연결

## 원격 연결

웹 서버의 `/api/mcp`는 JSON 응답을 사용하는 stateless Streamable HTTP 엔드포인트입니다. 요청마다 `Authorization: Bearer <프로필에서 발급한 개인 서비스 토큰>`을 전달합니다. 읽기 토큰에는 변경 도구가 노출되지 않으며 공통 서비스에서도 수정 권한을 다시 검사합니다.

Claude Chat의 사용자 정의 원격 커넥터에 공개 HTTPS MCP URL을 등록하고 Request headers에 `Authorization: Bearer <개인 서비스 토큰>`을 설정합니다. [Claude 공식 안내](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)는 고정 Bearer 토큰 인증을 지원합니다. 현재 서버는 OAuth 서버를 제공하지 않으며 실제 Claude 계정에서의 연결은 아직 검증하지 않았습니다.

Team·Enterprise의 조직 커넥터에 설정한 고정 자격 증명은 사용하는 멤버들이 공유합니다. 이를 개인별 로그인처럼 취급하면 안 됩니다. 여러 기획자의 개인 저장소 권한을 구분하는 조직 배포에는 사용자별 OAuth 연결을 추가해야 합니다. Claude는 Anthropic 클라우드에서 접속하므로 `localhost` 대신 공개 HTTPS 주소가 필요합니다.

`APP_URL`은 사용자가 접근하는 공개 웹 origin으로 설정합니다. 다른 origin을 가진 브라우저 요청은 거부하며 원격 MCP 클라이언트는 불필요한 Origin 헤더를 보내지 않도록 구성합니다. HTTP 엔드포인트를 공개할 때는 HTTPS 프록시에서 요청 크기·요청 속도 제한을 적용하세요.

## 로컬 연결

다음과 같은 stdio 서버를 클라이언트에 등록합니다. 작업 경로는 이 저장소로 지정하거나 절대 경로로 실행합니다.

```json
{
  "mcpServers": {
    "cloud-pm-agent": {
      "command": "node",
      "args": [
        "--env-file=/absolute/path/cloud-pm-agent/.env",
        "--import",
        "/absolute/path/cloud-pm-agent/node_modules/tsx/dist/loader.mjs",
        "/absolute/path/cloud-pm-agent/src/mcp/stdio.ts"
      ]
    }
  }
}
```

로컬 stdio에 `MCP_ACCESS_TOKEN`을 설정하면 개인 프로필 권한을 적용합니다. 미설정 시 프로세스를 실행하는 OS 사용자를 신뢰하는 로컬 관리 연결이므로 공유 원격 실행에는 사용하지 않습니다. `MCP_READ_ONLY=true`로 조회만 허용할 수 있습니다. `DATA_DIR`에는 절대 경로를 사용하고 웹과 동시에 연결하려면 `DATABASE_URL`을 설정하세요. 표준 출력은 MCP 프로토콜 전용이며 서비스 로그는 출력하지 않습니다.

## 도구

| 도구                               | 기능                                | 권한         |
| ---------------------------------- | ----------------------------------- | ------------ |
| `get_project_status`               | 기능·태스크·개입 항목과 규칙 브리핑 | 조회         |
| `list_tasks`                       | 프로젝트·담당자별 태스크 조회       | 조회         |
| `get_pull_request_changes`         | 수집된 PR 작성자·파일·diff 조회     | 조회         |
| `create_project`, `create_feature` | 프로젝트·기능 등록                  | 수정         |
| `create_task`, `update_task`       | 태스크 등록·수정                    | 수정         |
| `link_task`                        | GitHub 항목 직접 연결               | 수정         |
| `suggest_task_links`               | 제목 키워드 기반 후보 생성          | 수정         |
| `ai_suggest_task_links`            | AI 연결 후보 생성                   | 수정·AI 설정 |
| `decide_task_link`                 | 후보 승인·거절                      | 수정         |
| `list_sync_jobs`                   | 최근 웹훅 작업 상태 조회            | 조회         |
| `retry_sync_job`                   | 실패한 웹훅 작업 수동 재시도        | 수정         |
| `sync_github`                      | 조직 수집·YAML 평가·DB 반영         | 수정         |
| `analyze_project`                  | 근거가 포함된 AI 기술 브리핑        | 수정·AI 설정 |

`update_task`에는 `list_tasks`에서 읽은 `revision`과 전체 태스크 데이터를 보냅니다. 오래된 버전은 충돌 오류로 반환합니다. `status:"done"`으로 직접 완료하고 다른 상태로 재개방할 수 있습니다. `update_task_fields`의 `{id,revision,patch:{status:"done"}}`도 같은 동작입니다. 저장소 기본 브랜치의 PR 조건에 따른 자동 완료는 유지하며, 계속 충족된 조건은 재개방 후 다음 동기화에서 다시 완료할 수 있습니다.

## 검증 범위

쓰기 권한의 MCP SDK 클라이언트로 프로젝트·기능·태스크 생성과 수정, 일괄 수정, 오래된 revision 거부, 직접 완료·재개방, 저장소 접근 제한을 검증합니다. 조회 전용 연결은 쓰기 도구를 노출하지 않으며 직접 호출도 거부합니다.

자동 테스트는 SDK 클라이언트의 in-memory 연결과 웹 HTTP의 initialize·도구 목록·도구 호출을 검증합니다. Claude 외부 계정·공개 HTTPS 프록시·실조직 권한에 대한 검증은 배포 설정 후 수행해야 합니다.

## Claude에서 기획과 태스크 정리

프로필에서 **조회·수정 토큰**을 발급하면 생성과 수정 도구를 모두 사용할 수 있습니다. 별도 `update` 토큰은 없습니다.

| 작업                              | 도구                               |
| --------------------------------- | ---------------------------------- |
| 프로젝트 생성·목표·일정 수정      | `create_project`, `update_project` |
| 기능 이름·목표 정의·수정          | `create_feature`, `update_feature` |
| 태스크 생성·담당자·상태·기한 수정 | `create_task`, `update_task`       |
| 선택 항목 일괄 수정               | `bulk_update_entities`             |
| GitHub 항목 가져오기·연결         | `import_github_items`, `link_task` |
| 관리 항목 삭제                    | `delete_entities`                  |

예시: “현재 프로젝트를 조회하고 고객 온보딩 프로젝트를 만들어 줘. 가입·로그인·초대 기능별 목표를 정의하고, 구현 태스크로 나눠 등록해 줘.” 조회 결과의 저장소·식별자와 최신 `revision`을 사용하며 오류와 부분 처리 결과를 확인합니다.

Claude Chat이 대화에서 기획하고 MCP 도구를 호출하는 흐름에는 서버 `ANTHROPIC_API_KEY`가 필요하지 않습니다. 별도 서버 AI 도구인 `analyze_project`, `ai_suggest_task_links`에만 서버 제공자 설정이 필요합니다. 기능 정의에는 이름·목표·Markdown 인수 기준을 사용합니다. 태스크 완료는 기존 YAML 머지 조건으로 판정합니다.

[Claude 공식 커넥터 안내](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) · [MCP SDK](https://ts.sdk.modelcontextprotocol.io/server)

## 일정과 항목 관리 도구

`create_project`와 `update_project`에 선택적 `startDate`, `endDate` (`YYYY-MM-DD` 또는 `null`)를 전달합니다. `update_feature`는 기능 이름·목표를 변경합니다. 수정에는 최신 `revision`이 필요합니다.

`import_github_items`는 `{project, feature, items: ["owner/repo#123"]}`로 수집된 항목을 태스크로 추가하며 같은 기능의 기존 연결은 건너뜁니다. `delete_entities`는 `{kind: "project" | "feature" | "task", entries: [{id, revision}]}`를 받습니다. 하위 관리 항목·연결도 삭제되며 GitHub 원본은 유지됩니다.

## 여러 워크스페이스

개인 토큰은 발급 당시 워크스페이스에 고정되며 다른 워크스페이스를 지정한 `X-Workspace-Id` 요청은 거부합니다. 웹 화면 전환과 MCP 작업 대상은 독립적입니다. `list_workspaces`로 참여 목록을 조회하고 쓰기 토큰의 `create_workspace`로 이름·설명을 지정해 생성합니다. 새 공간의 프로젝트를 관리하려면 웹에서 전환하고 그 워크스페이스용 토큰을 발급하여 연결하세요. 현재 토큰은 사용자당 하나이므로 재발급 시 이전 연결은 무효화됩니다. [워크스페이스 안내](workspaces.md)

## 댓글과 개인 알림

- `list_task_comments`: `task`로 댓글과 멘션 가능한 구성원을 조회합니다.
- `add_task_comment`: `task`, `body`로 Markdown 댓글을 작성합니다.
- `update_task_comment`: `id`, `revision`, `task`, `body`로 본인 댓글을 수정합니다.
- `delete_task_comment`: `id`, `revision`으로 본인 댓글을 삭제합니다.
- `list_notifications`: 현재 워크스페이스의 본인 알림과 미읽음 수를 조회합니다.
- `mark_notification_read`: 알림의 `id`, `revision`으로 읽음 처리합니다. 읽기 전용 사용자도 본인의 알림을 읽음으로 처리할 수 있습니다.

댓글 작성·수정·삭제와 개인 알림에는 프로필에서 발급한 개인 MCP 토큰이 필요합니다. 댓글의 `@GitHub아이디` 멘션, 담당자, 기존 댓글 작성자에게 앱 내 알림을 제공합니다. 댓글 수정 시 새로운 버전으로 미읽음 처리됩니다. GitHub 원본에 댓글을 전송하지 않습니다.

## 선행·후행 작업

`create_task`와 `update_task`의 `dependsOn` 배열로 같은 프로젝트의 선행 태스크를 등록합니다. 수정 시 배열을 생략하면 관계를 유지하고 `[]`로 해제합니다. 기능을 가로질러 최대 100개를 연결할 수 있으며 자기 참조·순환·다른 프로젝트 연결은 거부합니다.

`get_task_dependencies`에 `task`를 전달하면 `predecessors`, `successors`, `pending`, `blocked`를 반환합니다. `list_tasks`의 `blocked: true`는 미완료 선행 작업이 있는 활성 태스크만, `dependsOn: "TASK-123"`은 해당 작업을 직접 기다리는 태스크를 조회합니다. 취소된 선행 작업도 대기로 표시합니다. 상태와 완료는 사용자가 직접 변경하며 YAML PR 조건의 자동 완료도 유지합니다. 선행 태스크를 삭제하려면 후행 관계를 해제하거나 해당 작업들을 함께 삭제해야 합니다.

## 워크스페이스 역할 적용

개인 연결은 토큰 발급 시 지정한 조회·수정 범위와 현재 워크스페이스 역할을 함께 검사합니다. 조회 전용 역할로 변경하면 기존 쓰기 토큰도 이후 요청부터 조회로 제한되며 멤버 제외 시 해당 공간의 토큰은 해제됩니다. 조회 토큰은 승격 후에도 조회 전용입니다. 개인 알림 읽음 처리는 조회 전용에서도 가능합니다. 역할 변경과 멤버 제외는 브라우저 프로필의 워크스페이스 설정에서 수행합니다.

## 배포와 연결 점검

프로필의 **Claude MCP 연결**에서 현재 공간의 주소·권한·최근 토큰 요청을 확인하고 토큰으로 인증·도구 목록을 점검할 수 있습니다. 실제 Claude 연결 여부는 별도 확인합니다. 배포 파일과 CLI 명령은 [운영 배포 안내](deployment.md)를 참고하세요.

## 업무 조회와 필드별 수정 (2026-10-29)

다음 15개 도구를 추가했다. 기존 생성·수정·삭제 도구도 계속 제공한다.

| 도구                                                   | 용도                                       |
| ------------------------------------------------------ | ------------------------------------------ |
| `list_projects`, `get_project`                         | 프로젝트 검색·페이지와 개별 상세/revision  |
| `get_task`, `get_requirement`, `get_knowledge`         | 작업·PRD·정책/용어의 개별 상세/revision    |
| `list_github_activities`, `get_github_activity`        | PR/이슈 검색·필터·페이지와 본문/파일 상세  |
| `list_task_links`                                      | 작업·프로젝트의 연결 후보와 승인/거절 상태 |
| `list_change_history`                                  | 접근 가능한 최근 변경 이력                 |
| `get_project_schedule`                                 | 프로젝트 시작·종료와 작업별 기한           |
| `preview_delete_entities`                              | 연쇄 삭제 수·선행 참조 차단 미리보기       |
| `update_project_fields`, `update_task_fields`          | 프로젝트·작업의 지정한 필드만 수정         |
| `update_requirement_fields`, `update_knowledge_fields` | PRD·정책/용어의 지정한 필드만 수정         |

페이지 도구는 `offset`(기본 0), `limit`(기본 40, 최대 100)을 받고 `{items,total,offset,limit,hasMore,nextOffset}`을 반환한다. 목록은 현재 접근 가능한 데이터 범위에서 계산한다. 변경 이력은 서버가 제공한 최근 이력 범위이며 전체 기간을 보장하지 않는다.

`list_github_activities`는 `project`, `kind`(`pr`/`issue`), `repository`, `query`, `author`, `assignee`, `reviewer`(개인/팀), `label`, `state`를 지원한다. 종료/머지 항목은 기본으로 숨기며 `hideClosed:false` 또는 명시적 `state`로 조회한다. 목록은 GitHub 변경 시각 최신순이며 기본 `bodyPreview` 300자, `includeBody:true`일 때 본문을 반환한다. 파일 diff는 개별 상세 도구로 읽는다. 프로젝트 저장소 비교는 대소문자를 구분하지 않는다.

`list_tasks`에는 기존 필터 외에 `status`, `priority`, `query`, `dueBefore`를 추가했다. `dueBefore`는 지정 날짜 미만의 기한이 있는 작업만 조회한다. `list_knowledge`는 `kind`, `query`, `status`로 검색한다. `sync_github`의 `project`를 지정하면 해당 프로젝트의 연결 저장소만 수집한다.

필드별 수정은 `{id,revision,patch}`를 받는다. 생략 필드는 유지하고 `dueDate:null`로 기한을 해제한다. 생성 기본값을 적용해 기존 값을 초기화하지 않는다. 빈 patch·알 수 없는 필드·식별자 변경은 거부한다. `project`는 이름·목표·일정·저장소, `task`는 제목·유형·상위/선행 작업·설명·담당자·상태·우선순위·기한·차단 사유·YAML 초안을 수정한다. PRD의 프로젝트와 문서 종류는 이 도구로 변경하지 않는다.

```json
{
  "id": "TASK-123",
  "revision": 4,
  "patch": {
    "assignee": "planner",
    "priority": "high",
    "dueDate": "2026-11-20"
  }
}
```

먼저 `get_task`로 최신 버전을 읽고 `update_task_fields`를 호출한다. 오래된 revision은 충돌 오류이며 다시 조회해 변경 내용을 확인한다. 조회 전용 토큰에는 수정 도구가 노출되지 않고 공통 서비스에서도 쓰기를 거부한다. 존재하지 않는 항목과 접근할 수 없는 항목은 동일하게 처리한다. 삭제 미리보기는 저장하지 않으며 실제 삭제는 `delete_entities`가 다시 검사한다.

## 웹과 MCP의 제공 범위

프로젝트·통합 작업·PRD·정책/용어·GitHub 수집/조회/연결·일정·변경 이력·댓글·개인 알림·분석은 MCP 도구로 다룬다. 워크스페이스 목록/생성도 제공한다. 따라서 **웹의 모든 버튼을 MCP로 조작할 수 있다는 의미는 아니다.**

계정 가입/로그인·비밀번호·개인 GitHub/MCP 토큰·멤버 역할·초대 발급/취소·워크스페이스 가입 정책은 현재 웹 계정 설정에서 관리한다. GitHub PR/이슈 원본 수정·삭제, 복구, 미구현 일정/초안 기능도 MCP에서 제공하지 않는다. PRD를 실제 GitHub 이슈로 발행하는 기능은 별도 미리보기·명시적 발행 도구를 사용한다.

## 기존 프로젝트에 Asana 작업 추가 (호환 도구)

쓰기 토큰의 `preview_asana_file`과 `import_asana_file`은 기존 프로젝트에 작업을 추가하는 호환 도구다. 파일 미리보기·선택·중복 유지/갱신·원자적 저장을 제공한다. 파일은 Asana 원본 ID로 중복을 판단하고 진행 상태·YAML·GitHub 연결을 유지한다. 새 작업은 대기이며 원본 완료 여부는 설명에 보존한다. 새 프로젝트를 함께 가져올 때는 아래 도구를 사용한다.

## 외부 프로젝트 자체 가져오기

기본 외부 가져오기 도구는 `preview_asana_project`, `import_asana_project`다. 기존 프로젝트 ID를 요구하지 않는다. Asana CSV/JSON에서 프로젝트 정보와 작업을 미리 확인하고 프로젝트·선택 작업·원본 연결을 원자적으로 생성하거나 갱신한다. `ids:[]`는 빈 프로젝트 또는 프로젝트만 가져오기다.

GitHub 저장소가 없는 프로젝트도 만들며 저장소는 나중에 연결한다. 재가져오기는 Asana 프로젝트 ID/원본 키로 식별한다. 동명·원본 ID 부재 등으로 자동 판단하기 어려우면 사용자가 원본 키를 확인한다. `projectName`으로 가져올 이름을 지정할 수 있다. 정확한 입력과 중복 정책은 [외부 프로젝트 가져오기](asana-import.md)를 따른다. 기존 `preview_asana_file`/`import_asana_file`은 기존 프로젝트에 작업을 추가하는 레거시 계약으로 유지한다.

Asana 동명 사용자 지정 CSV 열은 각각 보존하며 기본 담당자와 별도 담당자를 구분한다. 기본적으로 모호한 상위는 오류다. 사용자가 승인한 경우 `unresolvedParents:"keep_unlinked"`로 다시 미리 확인하고 같은 정책으로 가져온다. 신규 작업의 모호한 상위는 미연결이며 기존 상위·빈 CSV 제목·변환 불가능한 우선순위는 기존 값을 유지한다. 원본 값과 행별 경고를 반환하며 순환이나 삭제된 작업의 재생성을 허용하지 않는다.

## 정책·용어의 변경 검토 대상

`get_knowledge_impact`는 읽기 토큰으로 사용할 수 있다. 예: `{"id":"policy-security","kind":"issues","project":"customer-platform","limit":40,"offset":0}`. `list_knowledge`에서 문서 ID를 찾은 뒤 PRD·태스크·이슈·PR 중 하나를 선택해 조회한다. 응답의 `summary`와 `references`로 영향을 검토하고, `page.nextOffset`이 있으면 다음 페이지를 요청한다.

PRD의 정책·용어 참조와 하위 태스크·승인된 GitHub 연결을 따른다. 같은 이슈는 중복 집계하지 않는다. 원본이 캐시에 없는 발행 이슈는 `unknown` 상태이며, 정책 편집이 관련 원문을 자동 변경하거나 검토 완료를 뜻하지는 않는다. [API 계약과 권한 규칙](knowledge-impact.md)을 함께 확인한다.

정책 의존관계는 `save_knowledge`의 `dependsOn` 또는 `update_knowledge_fields`의 `patch.dependsOn`으로 등록한다. 예: 환불 정책이 결제 정책을 따르면 환불 정책의 `dependsOn`에 결제 정책 ID를 넣는다. 생략은 유지, `[]`는 해제다. 순환·자기 참조·다른 워크스페이스·용어 연결은 거절한다. `get_knowledge_impact`의 기본 `scope=all`은 의존 정책의 PRD·작업도 집계한다. `scope=direct`는 직접 참조만, `kind=policies`는 의존 정책을 페이지로 조회한다. `policyPath`와 `policyDistance`로 간접 연결 근거를 확인한다.
