# GitHub 템플릿 배포 예시

[워크플로우 초안](../../docs/github-workflow.md)에 맞춘 기능·개선, 버그, 기술·운영 Issue Forms와 PR 템플릿입니다. 이 디렉터리의 `.github/`는 **배포용 예시**이며 현재 저장소의 GitHub 설정에는 설치하지 않았습니다. 자동 분류 파서와 페이지의 내보내기 기능도 아직 구현되지 않았습니다.

## 파일과 적용 경로

| 제공 파일                                | 대상 저장소 경로                         |
| ---------------------------------------- | ---------------------------------------- |
| `.github/ISSUE_TEMPLATE/feature.yml`     | `.github/ISSUE_TEMPLATE/feature.yml`     |
| `.github/ISSUE_TEMPLATE/bug.yml`         | `.github/ISSUE_TEMPLATE/bug.yml`         |
| `.github/ISSUE_TEMPLATE/engineering.yml` | `.github/ISSUE_TEMPLATE/engineering.yml` |
| `.github/ISSUE_TEMPLATE/config.yml`      | `.github/ISSUE_TEMPLATE/config.yml`      |
| `.github/pull_request_template.md`       | `.github/pull_request_template.md`       |

대상 저장소의 기존 템플릿을 확인한 뒤 필요한 파일만 작업 브랜치에 추가하고 PR로 검토합니다. 기존 파일을 덮어쓰지 말고 항목을 병합하거나 이름을 조정하세요. 기본 브랜치에 반영한 뒤 새 이슈·PR 작성 화면에서 표시를 확인합니다. 저장소 밖에 자동 설치하거나 GitHub에 게시하는 기능은 이 예시에 포함되지 않습니다.

이슈 폼의 `placeholder`는 입력 예시이며 제출 본문에 자동 저장되지 않습니다. 실제 ID를 연결 정보에 입력하거나 해당 필드를 비워 둡니다. `Cloud PM 연결` 제목과 `render: yaml`은 향후 파서의 기준으로 유지하고, 필드의 내부 `id`가 본문에 출력된다고 가정하지 않습니다. PR의 모든 연결 값이 null이면 직접 지정 없음으로 취급하는 계약입니다.

별도 라벨·담당자·GitHub Projects 설정을 강제하지 않습니다. 팀에 이미 있는 제목·라벨 규칙을 적용할 수 있습니다. `config.yml`은 빈 이슈 작성을 허용하므로 기존·비정형 제보를 계속 받을 수 있습니다.

초기 도입은 템플릿과 정보 누락 안내부터 시작합니다. 필수 입력·PR 검사 범위는 팀이 합의한 뒤 조정합니다. 템플릿 입력은 프로젝트 연결·기획 검토·배포 완료를 자동으로 보장하지 않습니다.

참고: [Issue Forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms) · [폼 스키마](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema) · [PR 템플릿](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository)
