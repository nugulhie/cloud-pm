# 태스크 완료 조건 YAML 설정

GitHub App 연동에는 별도 GitHub Actions 워크플로나 Actions Secret이 필요하지 않습니다. 설치한 App의 `push`·`pull_request` 웹훅을 서버가 받고 현재 상태를 조회합니다. 태스크를 직접 완료할 수도 있고, PR 머지로 자동 완료하려는 작업만 완료 조건 파일을 추가합니다.

## 기본 브랜치에 완료 조건 등록

태스크 상세의 내부 프로젝트·기능·태스크 ID를 사용해 저장소의 `.cloud-pm/tasks/<태스크ID>.yaml`에 저장합니다. 기본 브랜치에 반영되어야 서버가 읽습니다. `ADMIN-001` 같은 표시 번호와 `ADMIN` 같은 5자리 프로젝트 기능 식별자는 이 파일의 내부 ID를 대신하지 않습니다.

```yaml
version: 1
task: TASK-123
project: customer-platform
feature: social-login
completion:
  all:
    - pull_request:
        repository: soldoc-kr/backend
        number: 142
        state: merged
        target_branch: main
```

예시 ID·저장소·PR 번호·대상 브랜치를 실제 값으로 바꿉니다. 여러 PR이 모두 필요하면 `all`에 추가하고, 하나만 충족하면 되는 작업은 `any`를 사용합니다. 미머지 종료·다른 대상 브랜치·조회 실패는 완료로 판정하지 않습니다. 반영 후 GitHub 동기화를 실행하거나 웹훅 작업 큐의 처리 결과를 확인합니다.

## PRD 이슈 본문의 YAML과 구분

PRD에서 발행한 이슈의 **Cloud PM 연결** YAML은 `workspace`, `project`, `feature`, `task`, `requirement`를 담은 연결 정보입니다. GitHub Actions 워크플로 파일이나 위 완료 조건 파일과는 형식·용도가 다릅니다. 이슈 생성 시 서비스가 태스크 연결을 함께 저장하므로 본문 YAML을 Actions에 따로 등록할 필요는 없습니다.

저장소의 `.github/workflows/*.yml`은 빌드·테스트·배포를 실행하는 GitHub Actions 설정입니다. 기존 워크플로는 그대로 운영하고, 그 파일의 변경이 필요하면 구체적인 파일과 목적을 기준으로 검토합니다.
