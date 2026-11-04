# 정책·용어 변경 영향 조회 계약

정책 또는 용어에서 명시적으로 참조한 PRD와 연결 태스크·GitHub 이슈·PR을 모아 변경 검토 대상을 찾는다. 문서 편집 중에도 조회할 수 있다. 연관성은 저장된 참조 관계에 근거하며 내용의 의미가 실제로 변경되었거나 관련 작업에 반영되었다고 판정하지 않는다.

## HTTP와 MCP

- `GET /api/knowledge/impact?id=<문서 ID>&kind=requirements&limit=40&offset=0`
- MCP 읽기 도구: `get_knowledge_impact`. HTTP와 같은 입력·응답을 사용한다.
- `kind`: `requirements`(기본값), `tasks`, `issues`, `prs`.
- 선택 입력 `project`: 현재 접근 가능한 프로젝트 ID. 해당 프로젝트로 집계와 목록을 좁힌다.
- `offset`: 0 이상의 정수, 기본 0. `limit`: 1–100 정수, 기본 40.
- 인증은 기존 세션 또는 MCP/API 토큰을 사용한다. 쓰기 권한은 필요하지 않다. HTTP 응답은 `Cache-Control: no-store`다.

성공 응답에는 `document`(id, kind, name, revision, updatedAt), `summary`(requirements, tasks, issues, prs, projects), `projects`(관련 프로젝트 선택지), `kind`, `project`, `page`(items, total, offset, limit, hasMore, nextOffset)가 포함된다.

목록 항목은 `id`, `kind`, `title`, `label`, `status`, `assignees`, `updatedAt`, `projects`, `references`, `referenceCount`를 포함한다. GitHub 항목에는 `repository`, `number`, `url`이 추가된다. `references`는 PRD ID·번호·기능명·프로젝트와 연결 경로(`prd`, `task`, `subtask`, `published_issue`)를 최대 5개 제공한다. 전체 경로 수는 `referenceCount`다. 큰 본문과 파일 diff는 반환하지 않는다. 최종 활동 시각 내림차순, ID 순으로 정렬한다.

오류는 기존 `{error: string}` 형식이다. 잘못된 입력은 400, 미인증은 401, 존재하지 않는 문서 또는 접근할 수 없는 프로젝트는 404다. 연결된 항목이 없으면 빈 목록을 포함한 200이다. MCP 오류는 기존 도구 오류 형식을 사용한다.

## 연관성·권한 규칙

1. 정책은 PRD의 `policyIds`, 용어는 `glossaryIds`의 명시적 참조를 따른다. 본문의 단순 문자열 일치는 사용하지 않는다.
2. 해당 PRD의 변환 태스크와 같은 프로젝트의 하위 태스크를 포함한다. 순환·중복 경로를 제한한다.
3. 태스크에 승인된 GitHub 연결만 집계한다. 제안·거절 연결은 제외한다.
4. PRD에서 발행이 확인된 이슈도 포함한다. 캐시에 없으면 상태를 `unknown`으로 표시하며 열림으로 추정하지 않는다.
5. 같은 저장소·번호·종류의 GitHub 항목을 합치고 근거 PRD를 표시한다. 프로젝트 필터를 적용한 뒤 개수를 계산한다. 프로젝트 선택지는 접근 가능한 관련 프로젝트 전체다.
6. 현재 워크스페이스·프로젝트·저장소 권한을 적용한다. 프로젝트 설정에서 제거된 저장소의 과거 발행 기록도 현재 저장소 접근 권한을 별도로 검사한다.

조회는 GitHub를 실시간 호출하지 않는다. 정책 저장만으로 PRD·태스크·GitHub 원문을 수정하지 않는다. 이슈 직접 정책 연결 및 항목별 검토 완료 기록은 이번 계약에 포함하지 않는다.

## 사용과 검증

정책·용어 카드의 **연결·영향 보기**를 누른다. PRD와 태스크 제목에서 상세로 이동할 수 있고 GitHub 항목은 원문을 새 창으로 연다. 기존 문서의 편집 화면에도 동일한 검토 목록을 표시한다. 편집 중인 내용을 보존하도록 편집 화면 안의 목록은 조회 용도로 사용한다.

그래프·집계·권한·페이지·MCP 회귀 검사 4개와 HTTP 인증·읽기 토큰·캐시·오류 계약 검사 1개를 추가했다. 전체 자동 검사 180개와 별도 HTTP 검사 1개가 통과했다. 운영용 빌드와 격리된 로컬 계정으로 브라우저 검사 3개를 통과했다. 프로젝트 필터, 40개 단위 페이지, PRD 상세 이동, 정책 변경 후 조회, 하위 작업·PR 근거, 재시도·빈 목록, 용어 참조와 390px 가로 넘침을 확인했다. 실제 GitHub 원문 변경은 수행하지 않았다.
