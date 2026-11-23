# Jira 대비 기능 차이 점검 — 2026-11-04

## 비교 기준과 판단

cloud-pm-agent의 `720ef7a` 소스와 2026-11-04에 확인한 Atlassian 공식 문서를 비교했다. PM의 프로젝트 파악·계획·업무 조정과 개발자의 실행 관리를 기준으로 평가했다. Jira Cloud를 비교 대상으로 삼고, Premium/Enterprise의 고급 계획은 구분했다. Jira Service Management, Product Discovery, Confluence 및 Marketplace 앱 전체의 기능을 Jira 기본 기능으로 합산하지 않았다.

현재 프로젝트는 GitHub 활동을 PRD·태스크·정책에 연결해 현황을 확인하는 흐름을 제공한다. 주요 차이는 **계획을 저장하는 단위, 프로젝트별 진행 규칙, 재사용 가능한 보기, 운영 자동화, 시간에 따른 성과 분석**이다. 기능 개수나 단일 완성도 비율로 환산하지 않았다.

이번 점검은 소스 모델·서비스·공개 API·화면과 공식 문서를 확인한 결과다. 실제 Jira 테넌트의 설정별 동작이나 양쪽 제품의 부하·사용성을 실험한 결과는 아니다. ‘미지원’은 확인한 소스에 해당 업무 데이터와 조작 흐름이 없다는 의미다.

## 이미 제공하는 기능

- 상태별 드래그 보드, 여러 단계의 하위 태스크, 담당자·우선순위·기한, 일괄 등록·수정·삭제. [태스크 모델](../src/core/model.ts#L33), [보드](../src/components/task-board.tsx#L308), [계층](../src/core/task-hierarchy.ts#L3).
- 같은 프로젝트 안에서 태스크 선행·후행 관계와 차단 표시, 자기 참조·순환 방지. [의존관계](../src/core/dependencies.ts#L24).
- 댓글, 멘션, 댓글 참여자·담당자에 대한 앱 내 알림, 변경 이력. [협업](../src/core/collaboration.ts#L128), [이력](../src/core/history.ts#L122).
- GitHub PR·이슈·라벨·리뷰·파일 diff, 웹훅 갱신, 직접 연결·후보 승인, PRD에서 이슈 생성, 수동 완료 및 YAML 조건 자동 완료. [서비스](../src/core/service.ts), [GitHub 변경 반영](../src/github/changes.ts).
- PRD, 정책·용어 참조, 정책 간 의존관계와 간접 PRD·태스크·이슈·PR 영향 조회. [영향 조회](../src/core/knowledge-impact.ts), [정책 그래프](../src/core/policy-dependencies.ts).
- 워크스페이스·초대·역할, GitHub 계정 없는 가입, 개인 MCP 토큰, MCP 조회·생성·수정. [사용자](../src/users/service.ts), [MCP](../src/mcp/server.ts).

Jira도 공식 MCP에서 검색·작업 생성·수정을 지원한다. 우리 제품의 집중 영역은 GitHub 개발 근거와 PRD·정책·용어의 연결을 PM 업무 흐름에 맞게 제공하는 것이다. [Atlassian MCP 공식 안내](https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/).

## 없는 기능과 부분 지원 기능

| 영역                            | 현재 판정 | 현재 구현과 보완할 내용                                                                                                                                                                                                                                                                                                 | Jira 공식 근거                                                                                                                                                                                                   |
| ------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 프로젝트별 워크플로·승인        | 부분 지원 | 상태는 고정 6개다. PRD의 ‘승인’은 상태값이며 승인자·승인 기록·반려 경로·필수 입력·상태 전이 조건을 설정하는 기능은 없다. 프로젝트별 QA/기획 승인 절차가 필요하다. [모델](../src/core/model.ts#L43), [저장](../src/core/service.ts#L710), [PRD 상태](../src/core/requirement-model.ts#L5).                               | [워크플로·승인 단계](https://support.atlassian.com/jira-software-cloud/docs/set-up-approval-steps/)                                                                                                              |
| 백로그 정렬·스프린트            | 부분 지원 | `backlog` 상태와 상태 이동은 있다. 백로그의 수동 우선순위 순서, 스프린트 기간·목표·범위·시작/종료·이월은 없다. 보드의 진행 중 작업 수 제한(WIP)과 담당자별 가로 레인 설정도 없다. Scrum/Kanban 운영 방식에 따라 도입한다. [보드](../src/components/task-board.tsx#L308), [모델](../src/core/model.ts#L33).              | [백로그·스프린트·추정](https://www.atlassian.com/software/jira/agile)                                                                                                                                            |
| 릴리스·버전·마일스톤            | 미지원    | 프로젝트 기간·태스크 기한은 있지만 배포 버전, 릴리스에 포함된 작업, 목표 배포일·실제 배포일, 단계별 마일스톤을 관리하는 데이터가 없다. 완료된 작업을 묶어 출시 준비 상태를 확인하기 어렵다. [프로젝트·태스크 모델](../src/core/model.ts#L3).                                                                            | [Version management](https://www.atlassian.com/software/jira/agile)                                                                                                                                              |
| 태스크 타임라인·일정 계획       | 부분 지원 | 월간 캘린더는 프로젝트의 시작·종료일을 표시한다. 태스크는 기한만 있고 시작일·기간·타임라인·일정 조정 화면이 없다. [캘린더](../src/components/project-calendar.tsx#L4), [태스크 날짜](../src/core/model.ts#L47).                                                                                                         | [기본 타임라인 등 보기](https://www.atlassian.com/software/jira/jira/pricing)                                                                                                                                    |
| 프로젝트 간 선행 관계·고급 계획 | 부분 지원 | 태스크 의존관계는 같은 프로젝트 안에서 검증한다. 프로젝트를 가로지르는 작업 차단, 일정 영향 계산, 팀 통합 계획·시나리오 비교는 없다. 여러 저장소가 같은 프로젝트에 속한 경우의 연결은 현재 가능하다. 정책의 간접 PRD 조회와 태스크 일정 의존은 별개다. [범위 검증](../src/core/dependencies.ts#L30).                    | [Plans — Premium/Enterprise](https://support.atlassian.com/jira-software-cloud/docs/what-is-advanced-roadmaps)                                                                                                   |
| 추정치·작업 시간·팀 여력        | 미지원    | 담당자와 작업 수는 볼 수 있지만 스토리 포인트, 예상·실제·남은 시간, 작업 시간 기록, 근무 가능 시간 대비 배정량은 없다. 담당자 문자열은 서비스 사용자 ID와 별도로 저장된다. [모델](../src/core/model.ts#L33), [현황 집계](../src/components/project-overview.tsx#L29).                                                   | [시간 기록](https://support.atlassian.com/jira-cloud-administration/docs/configure-time-tracking/), [팀 capacity](https://support.atlassian.com/jira-software-cloud/docs/assign-capacity-from-your-timeline/)    |
| 진행 추이·성과 리포트           | 부분 지원 | 완료율·차단·지연 목록·규칙 브리핑과 수동 분석은 있다. 번다운·벨로시티·누적 흐름·단계별 체류 시간·리드타임/사이클타임, 사용자 정의 차트와 대시보드는 없다. 기존 변경 이력을 지표 집계에 활용할 수 있다. [현황](../src/core/service.ts#L472), [브리핑](../src/core/service.ts#L517), [이력](../src/core/history.ts#L122). | [Jira 리포트](https://www.atlassian.com/software/jira/features/reports)                                                                                                                                          |
| 저장한 보기·공유 검색           | 부분 지원 | 검색·담당자·상태·프로젝트·GitHub 필터는 있다. 조건은 화면 상태로 관리하며 사용자별 이름 있는 저장 보기, 공유 필터, 필터 구독, JQL과 같은 검색 언어는 없다. 우선은 ‘내 작업·이번 주 마감·선행 대기’를 버튼으로 저장하는 방식이 적합하다. [필터 상태](../src/components/dashboard.tsx#L106).                              | [저장·공유 필터](https://support.atlassian.com/jira-software-cloud/docs/what-is-a-saved-search/)                                                                                                                 |
| 범용 자동화·반복 작업           | 부분 지원 | GitHub 웹훅과 YAML의 PR 완료 조건, 큐 재시도는 있다. 사용자가 트리거·조건·동작을 조합하는 규칙, 반복 태스크, 마감 전 알림, 매주 PM 브리핑, 자동 담당자 배정은 없다. [완료 처리](../src/core/service.ts#L1517), [작업 큐](../src/jobs/queue.ts).                                                                         | [자동화 규칙](https://support.atlassian.com/cloud-automation/docs/create-and-edit-jira-automation-rules), [예약 트리거](https://support.atlassian.com/cloud-automation/docs/jira-automation-triggers/)           |
| 알림·구독·외부 협업             | 부분 지원 | 댓글·멘션·댓글 참여자/담당자 앱 내 알림은 있다. 임의 구독자, 담당자·상태·기한·정책 변경 알림과 이메일·Slack/Teams 전달은 없다. [수신자](../src/core/collaboration.ts#L128), [알림 조회](../src/core/collaboration.ts#L180).                                                                                             | [Watch·공유·댓글](https://support.atlassian.com/jira-software-cloud/docs/watch-share-and-comment-on-a-work-item/)                                                                                                |
| 태스크 첨부파일                 | 미지원    | Markdown 본문·외부 이미지/링크와 CSV/JSON 가져오기는 있다. 내부 태스크에 이미지·PDF를 첨부하고 권한·다운로드·미리보기를 관리하는 기능은 없다. [태스크 모델](../src/core/model.ts#L33), [공개 API](../src/app/api/[...path]/route.ts).                                                                                   | [첨부파일](https://support.atlassian.com/jira-software-cloud/docs/add-an-attachment-to-an-issue/)                                                                                                                |
| 사용자 정의 필드·폼·분류        | 미지원    | 태스크/PRD 입력 항목과 작업 유형은 고정이다. GitHub 라벨을 수집하지만 내부 작업의 자유 라벨·컴포넌트·프로젝트별 필드·입력 양식은 없다. [유형·필드](../src/core/model.ts#L20), [PRD 필드](../src/core/requirement-model.ts#L13).                                                                                         | [커스텀 필드](https://support.atlassian.com/jira-software-cloud/docs/add-custom-fields-to-your-project/), [폼 구성](https://support.atlassian.com/jira-software-cloud/docs/add-or-remove-fields-from-your-form/) |
| 프로젝트 보관·삭제 복구         | 부분 지원 | 삭제 영향 미리보기·연쇄 삭제·의존관계 보호·변경 이력은 있다. 삭제 표식이 DB에 남지만 프로젝트 보관 상태와 휴지통/복구 화면·API는 없다. [삭제 표식](../src/db/store.ts#L192), [API](../src/app/api/[...path]/route.ts).                                                                                                  | [프로젝트/공간 휴지통 복구](https://support.atlassian.com/jira-cloud-administration/docs/restore-a-project-from-trash/)                                                                                          |
| 조직 인증·관리                  | 부분 지원 | 자체 가입·로그인·초대·워크스페이스 역할·저장소 접근 범위는 있다. 회사 SSO·SCIM과 프로젝트/작업별 독립 권한 정책은 없다. 현재의 간단한 가입 정책을 유지하면서 조직 요구가 생길 때 선택적으로 도입한다. [계정·권한](../src/users/service.ts).                                                                             | [플랜·Guard 안내](https://www.atlassian.com/software/jira/jira/pricing)                                                                                                                                          |

기본 타임라인과 다중 프로젝트 Plans는 구분해야 한다. Plans의 고급 의존·capacity·시나리오는 Premium/Enterprise 범위다. 커스텀 승인 절차는 현재 Premium 안내에 포함되며 프로젝트 유형·설정의 영향도 받는다. SSO/SCIM도 Atlassian Guard 및 계약 범위를 확인해야 한다. [Plans 범위](https://support.atlassian.com/jira-software-cloud/docs/what-is-advanced-roadmaps), [현행 플랜 구성](https://www.atlassian.com/software/jira/jira/pricing).

Jira의 프로젝트 휴지통 복구를 ‘모든 개별 이슈 삭제를 즉시 복구하는 기능’으로 해석하지 않았다. 위 복구 비교는 프로젝트/공간 단위다.

## 우리 제품 기준 권장 순서

다음 순서는 Jira 기능 수를 맞추기 위한 순서가 아니라 현재 PM 사용 흐름에 대한 판단이다.

1. **저장한 보기·내 작업**: 수천 개 태스크에서 매번 필터를 다시 조합하는 부담을 줄인다. 개인 보기와 팀 공유 보기를 구분한다.
2. **릴리스·마일스톤**: 완료된 태스크를 배포 버전에 묶고 목표·실제 배포일과 출시 준비 상태를 확인한다. 기존 수동/PR 조건 완료는 유지한다.
3. **프로젝트별 QA·승인 절차**: 상태·필수 입력·검토자·반려·승인 기록을 선택 설정으로 추가한다. 기존 ‘기능=태스크’ 모델 안에서 확장한다.
4. **변경·마감 알림과 자동화**: 담당자·기한·정책 변경 알림부터 제공하고 이후 예약 규칙과 반복 작업으로 넓힌다.
5. **시간 기반 리포트·태스크 타임라인**: 상태 이력·태스크 시작일·릴리스 정보를 기반으로 지연 추이와 일정 영향을 보여 준다.

스프린트·스토리 포인트·정교한 capacity는 팀이 실제로 그 방식으로 계획할 때 추가한다. PM의 일상 업무 개선에는 저장한 보기·릴리스·선택형 검토 절차가 먼저다.

## 정책·PRD 특화 기능의 다음 보완

현재 정책 영향 조회는 ‘무엇이 연결되어 있는지’를 보여 준다. **어떤 PRD가 변경된 정책을 검토했는지, 누가 반영할지, 어느 정책 버전까지 확인했는지**를 저장하는 기능은 없다. [현재 응답 모델](../src/core/knowledge-impact.ts#L334), [문서 모델](../src/core/knowledge-model.ts#L3).

정책 변경 시 검토 대상을 생성하고 PRD별 검토자·담당자·확인한 정책 revision·검토 일시·조치 상태를 기록하는 흐름이 적합하다. 이는 우리 정책·PRD 업무에 대한 추가 제안이며 Jira의 기본 자동 정책 영향 분석 기능으로 간주하지 않는다. 현재 GitHub 원문 자동 덮어쓰기와 분리된 검토·선택 반영 흐름을 유지한다.

## 비교와 함께 확인한 계정·편집 편의

- 비밀번호 변경은 현재 비밀번호를 요구한다. 분실 후 본인 확인을 거치는 재설정 경로가 필요하다. GitHub 계정이 없는 구성원도 사용할 수 있는 확인 수단을 정해야 한다. [비밀번호 변경](../src/users/service.ts#L798).
- 태스크 사이를 이동할 때의 입력 보호는 일부 구현되어 있다. PRD·정책 편집에는 브라우저 새로고침·재시작 후 복원하는 초안 저장이 없다. 닫기·Esc 이탈 보호와 초안 보존을 함께 검토한다. [태스크 이동 보호](../src/components/dashboard.tsx#L560), [PRD 닫기](../src/components/requirements-panel.tsx#L160), [대화창](../src/components/editor-dialog.tsx#L30).

이 항목들은 소스에서 확인한 우리 제품의 운영 편의 보완점이며, 모든 Jira 화면의 동등한 동작을 실험해 비교한 결과는 아니다.
