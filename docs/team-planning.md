# 계정 담당자·일정·백로그·스프린트 계약

## 계정과 GitHub 참여

개발자는 GitHub App의 웹 OAuth(PKCE S256)로 가입·로그인한다. 검증된 GitHub 숫자 사용자 ID를 서비스 계정에 연결한다. 로그인 아이디/표시 이름만으로 기존 계정의 소유권을 넘기지 않는다. 기존 계정 연결은 기존 서비스 세션에서 명시적으로 시작한다. 활성 GitHub 조직 구성원임을 가입·로그인 때 확인한다. 사용자 OAuth 토큰은 본인·조직 확인에 사용한 뒤 보관하지 않고, 업무 데이터 연동은 기존 조직 GitHub App을 사용한다.

기본 워크스페이스는 검증된 조직 구성원이 자동 참여한다. 추가 공간은 관리자가 조직 구성원 참여를 허용한 경우에만 선택 참여한다. 비개발자의 자체 계정 가입·기존 초대와 멤버 관리는 계속 제공한다. OAuth의 조직 확인과 서비스 내 워크스페이스 멤버십은 구분한다.

- `GET /api/auth/github/config`: 공개 설정 상태·조직·콜백 URL(시크릿 제외).
- `GET /api/auth/github/start?intent=signin|link`: 브라우저 상태 쿠키와 10분 TTL·일회용 state, PKCE를 생성하고 GitHub로 이동한다. 다른 공개 공간은 로그인 뒤 워크스페이스 선택 창에서 참여한다.
- `GET /api/auth/github/callback`: state/쿠키/PKCE·본인·조직을 확인하고 서비스 세션을 발급한다. 연결은 기존 세션에 바인딩한다. 오류는 허용한 코드로만 화면에 전달한다.
- `GET /api/auth/workspaces/available`, `POST /api/auth/workspaces/join {id}`: 조직 확인이 최근인 계정만 공개한 공간을 조회·참여한다. 오래된 조직 확인은 GitHub 재인증을 안내한다.

실제 활성화에는 App Client ID·Client Secret, 조직 Members 읽기 권한, `https://cloud-pm.soldoc.co.kr/api/auth/github/callback` 콜백 등록이 필요하다. PEM 키는 Client Secret을 대신하지 않는다.

## 담당자 매칭

태스크에 선택 항목 `assigneeUserId`(UUID 또는 null)를 추가한다. 원래의 `assignee` 문자열도 호환·GitHub 연동용으로 보존한다. 표시 이름의 유사도로 자동 연결하지 않는다.

1. 명시적으로 지정한 담당 계정 ID를 우선한다.
2. 워크스페이스의 명시적 담당자 매칭표를 적용한다.
3. 검증된 GitHub 아이디 또는 서비스 아이디가 정확히 일치하는 단일 계정을 연결한다.
4. 중복 후보·탈퇴자·미등록 담당자는 미매칭으로 표시하고 PM이 지정한다.

기존 문자열만 변경하는 클라이언트는 이전 계정 연결을 해제하고 새 문자열로 다시 매칭한다. 계정 ID가 지정되면 해당 구성원의 GitHub 아이디 또는 서비스 아이디로 문자열을 정규화한다. GitHub 이슈 발행의 담당자는 저장소별 배정 가능 여부를 별도로 검사한다. 다른 워크스페이스 계정에 배정할 수 없다.

## 일정·공수와 리소스

태스크에 `startDate`, `estimatedHours`, `storyPoints`, `sprintId`를 선택 항목으로 추가한다. 기존 `dueDate`를 종료일로 사용하며 시작일이 종료일보다 늦으면 거절한다. 필드 생략은 기존 값을 보존하고 null은 해제다.

리소스는 시작~마감일의 담당자 근무일에 예상 공수를 균등 배분한다. 마감일만 있으면 해당 날짜를 기준으로 배분하고 추정임을 표시한다. 완료·취소한 태스크는 예정 부하에서 제외한다. 날짜·공수가 없는 작업과 담당자 미매칭은 따로 보여 준다. 과거 실제 근무 시간으로 해석하지 않는다.

기본 가용 시간은 월~금 8시간이며 구성원별 근무 요일·일일 가용 시간과 날짜별 예외 시간을 설정할 수 있다. 0시간은 가용 시간 없음으로 처리한다. 조회는 최대 93일, 구성원은 최대 100명씩 페이지로 제공한다. 집계는 조회자의 접근 가능한 프로젝트 범위다.

## 보기와 필터

태스크 조건(프로젝트·담당 계정/내 작업·기존 담당자 문자열·상태·유형·우선순위·검색·선행 대기·스프린트·마감 범위)을 개인 보기 또는 워크스페이스 공유 보기로 저장한다. `me`는 조회자 자신의 계정으로 해석한다. 개인 보기는 소유자만 조회·수정·삭제한다. 공유 보기는 구성원이 조회하고 작성자 또는 관리자가 수정·삭제한다. 숨겨진 프로젝트의 보기와 검색 결과는 노출하지 않는다.

## 백로그와 스프린트

프로젝트별 백로그 순서를 저장하고 드래그 또는 위·아래 버튼으로 변경한다. 순서 변경은 revision을 검사하며 상태를 자동 변경하지 않는다. 스프린트가 없는 미완료 작업을 백로그에서 계획한다.

스프린트는 프로젝트·이름·목표·시작/종료일·계획/진행/종료 상태를 가진다. 프로젝트마다 동시에 한 개만 진행할 수 있다. 시작 시 최초 범위를 기록한다. 종료 시 완료/취소/미완료·공수·포인트를 기록하고 미완료 작업을 백로그 또는 다음 계획 스프린트로 이동한다. 취소는 완료량에 포함하지 않는다. 종료 집계는 종료 시점 기준으로 보존한다. 계획 스프린트 삭제는 작업을 백로그로 돌리고 작업 자체는 보존한다.

## API·MCP 공통 규칙

`/api/planning/*`는 기존 세션/개인 MCP 토큰의 워크스페이스·저장소·읽기/쓰기 권한을 적용한다. GET은 `no-store`, 입력 오류 400, 미인증 401, 권한 없음 403, 미존재/비공개 404, revision 충돌 409를 사용한다. 조회는 기본 50개·최대 100개, mutation은 항목당 revision을 사용한다. OAuth·계정 연결은 브라우저에서만 수행한다.

조회: `GET people`, `GET assignments`, `GET views`, `GET sprints`, `GET backlog`, `GET resources`, `POST tasks/query`.
수정: `POST assignments`, `POST assignments/delete`, `POST capacity`, `POST views`, `POST views/delete`, `POST sprints`, `POST sprints/start`, `POST sprints/close`, `POST sprints/delete`, `POST sprints/assign`, `POST backlog/reorder`.

새 업무 데이터의 조회·작성·수정·삭제·스프린트 실행과 리소스 조회는 MCP에서도 같은 서비스·검증으로 제공한다. OAuth의 원격 요청 제한 시간은 15초다. 실제 GitHub 사용자 동의·조직 설치 권한과 로컬 HTTP 검증 결과를 구분한다.

## 생성한 GitHub 이슈의 담당자 변경

기존 이슈 발행 시 지정하는 담당자와 내부 태스크 담당자는 연결하되, 원본 변경은 명시적인 동작으로 수행한다. GitHub 이슈 상세에서 저장소의 배정 가능 사용자 목록으로 담당자를 변경·해제하고 결과를 캐시에 반영한다. 서비스 담당자가 GitHub 계정에 연결되어 있으면 해당 GitHub 아이디를 후보로 사용한다.

`POST /api/github/issue-assignees`는 항목 ID·담당자 목록·원본 확인 시각을 받는다. 승인된 연결 태스크의 담당자까지 변경할지는 별도 옵션과 태스크 revision으로 지정한다. GitHub 변경 성공 뒤 내부 수정이 충돌하면 부분 성공을 숨기지 않고 안내한다. 요청 결과가 불명확하면 원본을 다시 확인하며 자동 재시도로 다른 사람의 배정을 덮어쓰지 않는다. GitHub 이슈 원문 변경은 웹과 MCP 모두 명시적인 쓰기 권한·대상 저장소 접근·GitHub Issues 쓰기 권한을 검사한다.

GitHub는 배정이 반영되지 않아도 성공 응답을 보낼 수 있으므로 실제 반환된 담당자 목록을 확인한다. 원본 수정 시각 비교는 쓰기 전 확인이며 다른 클라이언트와의 원격 쓰기를 원자적으로 잠그는 기능은 아니다. [GitHub 이슈 수정 계약](https://docs.github.com/en/rest/issues/issues#update-an-issue)을 따른다.

## 화면 사용

- 개인 프로필에서 GitHub 계정을 연결하거나 로그인 화면에서 GitHub 가입·로그인을 선택한다. 기존 비밀번호 계정은 로그인한 뒤 연결해야 같은 계정으로 사용한다. 새 OAuth 계정은 GitHub으로 인증하며, 개인 MCP 토큰은 프로필의 MCP·API에서 별도로 발급한다.
- 태스크 편집에서 담당 계정·시작일·마감일·예상 공수·포인트·스프린트를 지정한다. 담당자 매칭표는 워크스페이스 전체에 적용하며, 이미 직접 지정된 담당 계정을 덮어쓰지 않는다.
- 리소스 계획의 색과 ‘초과 배정’ 문구로 부하를 확인하고 가용 시간 설정에서 휴무를 0시간으로 등록한다. 실제 근무 시간 추적이나 외부 휴일 자동 연동은 포함하지 않는다.
- 태스크 보드에서 현재 조건을 개인·공유 보기로 저장한다. 다른 사람의 공유 보기는 적용하거나 복사할 수 있고, 작성자·관리자가 수정·삭제한다.
- 백로그·스프린트에서 드래그 또는 위·아래 버튼으로 정렬하고 선택 태스크를 배정한다. 스프린트 시작·종료·삭제는 확인 창에서 한 번 실행하며 동시 변경은 revision 충돌로 안내한다.
- GitHub 활동의 이슈 상세에서 담당자를 변경한다. 기본값은 원본만 변경하며 내부 태스크를 함께 바꿀 때 승인 연결된 태스크를 선택한다.

## 재현 가능한 검증

```sh
npm test
postman simulation run postman/simulations/github-planning.sim.yaml --proxy \
  --lift 'node --use-env-proxy --import tsx tests/team-planning-simulation.ts'

NEXT_DIST_DIR=.next-planning-e2e npm run build
postman simulation run postman/simulations/github-planning.sim.yaml --proxy \
  --lift 'env NODE_OPTIONS=--use-env-proxy NO_PROXY=127.0.0.1,localhost,::1 no_proxy=127.0.0.1,localhost,::1 PLANNING_HTTP_SIMULATION=true npm run test:e2e:planning'
```

전용 브라우저 구성은 `.data/planning-e2e/run-*`에 합성 계정과 임시 DB를 생성하고
실제 운영 데이터·GitHub 계정·이슈는 수정하지 않는다. Chrome과 Postman CLI가 필요하다.
기본 `test:e2e` 구성에서는 별도 인증 DB가 필요한 이 파일을 건너뛴다.
자체 로컬 GitHub 모의는 공개 계약에 기반하며, 소유자 모의 검색은 CLI 미로그인으로 생략했다.
