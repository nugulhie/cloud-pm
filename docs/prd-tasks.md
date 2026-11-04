# PRD와 개발 태스크 연결

PRD는 제품 요구사항이고 태스크는 담당자·저장소별 실행 단위다. 하나의 PRD에
프론트엔드·백엔드 등 여러 태스크를 연결하며 GitHub 이슈는 개별 태스크에
생성한다. PRD 화면은 연결된 태스크와 그 이슈를 모아서 보여준다. PRD 상태는
개별 태스크의 상태와 별도로 관리한다.

## 태스크 생성

`POST /api/requirements/convert` 및 MCP `convert_requirements_to_tasks`:

```json
{
  "entries": [{ "id": "signup", "revision": 3 }],
  "tasks": [
    {
      "id": "signup-ui",
      "title": "회원가입 화면",
      "repository": "org/frontend",
      "assignee": "frontend-dev"
    },
    {
      "id": "signup-api",
      "title": "회원가입 API",
      "repository": "org/backend",
      "assignee": "backend-dev"
    }
  ]
}
```

`tasks`는 한 PRD에 1~20개를 추가한다. 태스크 ID는 호출자가 생성하며 같은
ID로 재시도해도 중복 생성하지 않는다. 다른 태스크의 ID를 재사용하면 409다.
저장소는 해당 프로젝트에 연결된 저장소만 허용한다. `tasks`를 생략하면
기존 일괄 전환과 동일하게 PRD별 기본 태스크 하나만 생성한다. 기존 연결은
유지하며 `taskIds`에 전체 태스크 ID를 반환한다. `taskId`는 이전 클라이언트를
위한 첫 번째 태스크 ID다. PRD 수정·CSV 재가져오기는 연결을 유지한다.

## 태스크별 이슈 생성

`POST /api/requirements/issue-preview`, `/api/requirements/issue` 및 같은 MCP
도구에 `taskId`를 지정한다. 태스크가 여러 개이면 필수다. 선택한 태스크의
제목·설명·담당자를 사용하고 PRD 정책과 연결 메타데이터를 포함한다.
태스크에 저장소가 지정되어 있으면 일치해야 한다. 미리보기 해시는 태스크
수정도 감지한다. 실제 발행은 쓰기 권한과 저장소 Issues 쓰기 권한이 필요하다.

발행 기록은 PRD 전체가 아닌 태스크별로 구분한다. 다른 태스크의 발행을
막지 않으며 같은 태스크에 재요청하면 기존 이슈를 반환한다. 응답이 불확실한
경우 자동 재발행하지 않는다. 과거 PRD 단일 이슈 기록도 해당 태스크로
해석한다. 이슈 생성은 원격 쓰기이며 담당자 변경은 별도 작업이다.

## 삭제·접근 및 영향 범위

연결된 태스크나 발행 이력이 있으면 PRD 삭제를 막는다. 태스크가 삭제되어도
발행 이력을 지우지 않는다. 연결된 태스크의 프로젝트 변경을 막고,
정책 영향 분석은 모든 연결 태스크와 하위 태스크·GitHub 이슈를 포함한다.
프로젝트·워크스페이스 접근 검사와 revision 충돌 방지는 기존과 동일하다.
