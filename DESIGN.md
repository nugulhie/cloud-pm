---
name: 솔닥 Cloud PM
description: GitHub 근거로 프로젝트 현황을 확인하는 솔닥 사내 PM 작업 공간
colors:
  soldoc-blue: "#008def"
  action-blue: "#006fbf"
  action-blue-deep: "#005d9f"
  blue-wash: "#eaf5ff"
  signal-orange: "#fc7e2f"
  chart-navy: "#102b46"
  chart-navy-deep: "#0c233b"
  canvas: "#f4f6f8"
  surface: "#ffffff"
  ink: "#1c2d3e"
  heading-ink: "#18334c"
  muted-ink: "#5f6f82"
  hairline: "#e1e7ed"
  control-line: "#d7e0e9"
  nav-ink: "#c4d2df"
  nav-label: "#94abc1"
  done-green: "#216847"
  done-wash: "#edf7f1"
  attention-amber: "#8b4c16"
  attention-wash: "#fff6eb"
  danger-red: "#b53d43"
  danger-wash: "#fff2f2"
  info-blue: "#2b5e9f"
  info-wash: "#edf4fd"
typography:
  display:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Segoe UI, sans-serif"
    fontSize: "29px"
    fontWeight: 750
    lineHeight: 1.3
    letterSpacing: "-1.2px"
  title:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.55
    letterSpacing: "-0.4px"
  body:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 650
    lineHeight: 1.5
  caption:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.action-blue-deep}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger-red}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "9px 11px"
    height: "38px"
  nav-item:
    backgroundColor: "{colors.chart-navy}"
    textColor: "{colors.nav-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 11px"
    height: "37px"
  nav-item-active:
    backgroundColor: "{colors.chart-navy}"
    textColor: "{colors.surface}"
  status-chip-done:
    backgroundColor: "{colors.done-wash}"
    textColor: "{colors.done-green}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "4px 7px"
  attention-chip:
    backgroundColor: "{colors.attention-wash}"
    textColor: "{colors.attention-amber}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "1px 7px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "20px"
---

# Design System: 솔닥 Cloud PM

## Overview

**Creative North Star: "The Control Room Ledger"**

관제실의 상황판처럼, 짙은 네이비 프레임 안에서 여러 저장소에 걸친 업무 상태를 한눈에 훑는 장부다. 화면의 주인공은 행 목록과 표에 정렬된 사실이며, 장식은 그 사실을 읽는 속도를 늦추지 않는 범위에서만 존재한다. 색은 평소에 조용하고, 개입이 필요한 곳(차단·지연·선택)에서만 켜진다.

밀도는 높게 유지하되 글자는 읽을 수 있어야 한다. PM이 하루에 여러 번 열어 현황을 확인하는 도구이므로 한 화면에 많은 행을 담고, 대신 크기 계층·정렬·여백 리듬으로 구분한다. 면은 평평하고, 테두리와 배경 톤 차이로 구역을 나눈다. 떠 있는 것(모달·메뉴)만 그림자를 갖는다.

솔닥 공식 로고의 파랑과 주황은 브랜드의 목소리다. 파랑은 행동(주요 버튼·링크·초점)을, 주황은 선택 표시와 주목할 항목을 맡는다. 둘 다 넓은 면을 칠하지 않는다.

**Key Characteristics:**

- 네이비 사이드바 프레임 + 밝은 회청색 캔버스 + 흰 패널의 세 층 구조
- 행 목록·표 중심의 높은 정보 밀도, 12px 미만 글자 없음
- 평면 표면, 1px 테두리, 그림자는 떠 있는 요소에만
- 파랑은 행동, 주황은 선택·주목, 초록·호박·빨강은 상태 의미 전용
- Pretendard 단일 서체, 굵기(400·650·750)로 위계 표현

## Colors

차분한 회청색 중립 위에 솔닥 파랑이 행동을, 주황이 주목을 맡는 절제된 팔레트다.

### Primary

- **Soldoc Blue** (`soldoc-blue`): 공식 로고의 파랑. 입력 초점 테두리, 초점 링(40% 투명), 사이드바 활성 항목의 배경 틴트에 쓴다. 흰 글자를 올리는 면에는 대비가 부족하므로 쓰지 않는다.
- **Action Blue** (`action-blue`): 흰 글자를 올리는 주요 버튼, 텍스트 버튼, 선택된 보기 전환에 쓴다. 호버 시 **Action Blue Deep**(`action-blue-deep`)으로 짙어진다.
- **Blue Wash** (`blue-wash`): 안내 배너·초안 알림·선택 행의 옅은 배경.

### Secondary

- **Signal Orange** (`signal-orange`): 공식 로고의 주황. 사이드바 활성 항목의 3px 표시선, 페이지 제목 앞 표식, 주목할 항목의 강조에만 쓴다. 글자색이나 넓은 면에는 쓰지 않는다.

### Tertiary

- **Chart Navy** (`chart-navy`): 왼쪽 메뉴 프레임. 업무 영역과 탐색을 구분하는 유일한 짙은 면이다. 더 짙은 **Chart Navy Deep**(`chart-navy-deep`)은 모달 그림자 색의 기준이다.

### Neutral

- **Canvas** (`canvas`): 본문 영역 배경.
- **Surface** (`surface`): 패널·표·입력·보조 버튼 배경.
- **Ink** (`ink`): 본문 글자. 제목은 조금 더 푸른 **Heading Ink**(`heading-ink`).
- **Muted Ink** (`muted-ink`): 보조 설명·메타 정보·빈 상태 문구. Canvas 위에서도 4.5:1 이상을 유지하는 가장 밝은 값이다.
- **Hairline** (`hairline`): 패널 테두리와 행 구분선. 입력·보조 버튼은 한 단계 짙은 **Control Line**(`control-line`).
- **Nav Ink / Nav Label** (`nav-ink`, `nav-label`): 네이비 위의 메뉴 글자와 그룹 라벨.

### Semantic

- **Done Green** on **Done Wash**: 완료 상태.
- **Attention Amber** on **Attention Wash**: 차단·확인 필요·지연 같은 개입 신호.
- **Danger Red** on **Danger Wash**: 삭제·실패·되돌릴 수 없는 작업.
- **Info Blue** on **Info Wash**: 진행 중 상태와 PR 같은 참조 배지.
- GitHub의 merged 표시만 GitHub 고유의 보라를 유지한다. 사용자가 GitHub에서 보던 의미와 일치시키기 위한 예외이며 다른 곳에는 쓰지 않는다.
- 태스크 단계(backlog·ready·in_progress·in_review·done·canceled)는 각각 옅은 배경과 짙은 글자 쌍으로 표시한다. 단계 색은 상태 칩·상태 선택 상자에서만 쓴다.

### Named Rules

**The Quiet Until Needed Rule.** 화면 대부분은 중립색이다. 채도 있는 색은 행동(파랑), 선택·주목(주황), 상태 의미(초록·호박·빨강)를 전달할 때만 등장한다. 장식 목적의 색 면은 없다.

**The White-Text Contrast Rule.** 흰 글자를 올리는 파랑은 항상 Action Blue 이상으로 짙게 쓴다. 로고 파랑 위에 흰 글자를 올리지 않는다.

**The One Source Rule.** 새 색은 hex로 직접 쓰지 않고 이 문서의 토큰을 CSS 변수로 참조한다. 같은 역할의 색이 두 값으로 존재하면 하나로 합친다.

## Typography

**Body Font:** Pretendard (with -apple-system, Apple SD Gothic Neo, Segoe UI fallback)
**Label/Mono Font:** ui-monospace (코드·diff·식별자 전용)

**Character:** 한글과 라틴을 같은 리듬으로 그리는 단일 서체 체계. 서체를 바꾸지 않고 굵기와 크기 단계로만 위계를 만든다.

### Hierarchy

- **Display** (750, 29px, 1.3, -1.2px): 페이지 제목. 화면마다 하나.
- **Title** (650, 15px, 1.55, -0.4px): 패널·섹션 제목.
- **Body** (400, 14px, 1.55): 본문, 표의 주요 셀, 태스크 제목.
- **Label** (650, 12px): 버튼, 입력, 표 머리, 메뉴 항목.
- **Caption** (400, 12px, 1.6): 보조 설명, 메타 정보, 상태 칩.
- **Code** (400, 12px, monospace): PR 번호, 파일 경로, diff.

### Named Rules

**The 12px Floor Rule.** 어떤 글자도 12px보다 작지 않다. 정보가 넘치면 글자를 줄이지 않고 행을 접거나 보조 정보를 상세로 옮긴다.

**The Weight Not Size Rule.** 같은 크기 안의 강조는 굵기(400→650)로 한다. 강조를 위해 크기 단계를 새로 만들지 않는다.

## Layout

- **프레임:** 232px 고정 네이비 사이드바 + 유동 본문. 본문 상단에 62px 흰색 상단바(경로·알림·새로고침)가 있다.
- **본문:** 좌우 32px 여백(`spacing.xl`). 패널 내부는 20px(`spacing.lg`). 요소 간 간격은 8·12px 단계를 쓴다.
- **밀도:** 목록은 카드 그리드가 아닌 행 목록·표로 표시한다. 행은 1px 구분선으로 나누고, 열은 제목·진행·담당·일정처럼 의미 단위로 정렬한다.
- **반응형:** 1100px 이하에서 여러 열 레이아웃을 줄이고, 720px 이하에서 사이드바를 상단 메뉴 버튼으로 여는 전체 화면 메뉴로 바꾸며 표를 세로 쌓기로 전환한다. 600px 이하에서 버튼을 전체 폭으로 늘린다.
- **조작 높이:** 입력·버튼은 38~40px. 모바일에서 누르는 대상은 44px 이상을 목표로 한다.

## Elevation & Depth

평면 시스템이다. 고정된 표면은 그림자 없이 배경 톤(Canvas → Surface)과 1px 테두리로 깊이를 나타낸다. 화면 위에 떠서 다른 내용을 가리는 요소만 그림자를 갖는다.

### Shadow Vocabulary

- **Overlay** (`box-shadow: 0 24px 80px #0c233b26`): 모달·편집 대화상자.

### Named Rules

**The Flat-By-Default Rule.** 패널·카드·버튼은 휴식 상태와 호버 상태 모두 그림자가 없다. 호버는 배경 톤과 테두리 색 변화로 표현한다.

## Shapes

작고 일정한 모서리. 조작 요소는 6px, 패널은 8px, 모달은 10px, 배지·칩은 4px다. 원형은 아바타·오늘 날짜 표시처럼 사람·시점을 가리키는 요소에만 쓴다. 테두리는 항상 1px 실선이다.

## Components

### Buttons

- **Shape:** 살짝 둥근 모서리(6px), 높이 40px.
- **Primary:** Action Blue 면에 흰 글자, Label 서체, 10px 16px 안쪽 여백. 화면의 핵심 행동 하나에만 쓴다.
- **Hover / Focus:** 호버 시 Action Blue Deep으로 0.15초 전환. 초점은 3px Soldoc Blue 40% 외곽선, 3px 간격.
- **Secondary:** 흰 면, Control Line 테두리, Ink 글자. 호버 시 옅은 파랑 배경.
- **Danger:** 흰 면, 빨강 글자, 옅은 빨강 테두리. 호버 시 Danger Wash.
- **Text button:** 테두리 없이 Action Blue 글자. 패널 머리의 보조 행동(관리·추가)에 쓴다.

### Chips

- **Style:** 옅은 의미색 배경 + 짙은 같은 색조 글자, 4px 모서리, Caption 서체.
- **State:** 태스크 단계·완료·차단 표시. 상태를 바꿀 수 있는 곳에서는 같은 색 쌍의 선택 상자로 표시한다.

### Cards / Containers

- **Corner Style:** 8px.
- **Background:** Surface on Canvas.
- **Shadow Strategy:** 없음(Flat-By-Default).
- **Border:** 1px Hairline.
- **Internal Padding:** 20px. 행 목록 패널은 안쪽 여백 없이 행이 가장자리까지 이어진다.

### Inputs / Fields

- **Style:** 흰 면, 1px Control Line, 6px 모서리, 높이 38px, Label 크기 글자.
- **Focus:** 테두리가 Soldoc Blue로 바뀌고 초점 외곽선이 함께 표시된다.
- **Checkbox / Radio:** Action Blue 강조색.

### Navigation

- **Style:** Chart Navy 프레임 위의 세로 메뉴. 그룹 라벨(업무·문서·활동·관리)은 Nav Label 색 대문자 간격 라벨이다.
- **Item:** 높이 37px, 18px 선 아이콘 + 메뉴명. 호버 시 흰색 4% 틴트와 흰 글자.
- **Active:** Soldoc Blue 15% 틴트 배경, 흰 글자, 왼쪽 3px Signal Orange 표시선, 아이콘은 밝은 파랑.
- **Mobile:** 720px 이하에서 상단바의 메뉴 버튼으로 여는 전체 화면 메뉴.

### Project Ledger (signature)

프로젝트 현황의 행 목록. 한 행에 식별자 칩·프로젝트명·목표, 진행률 막대와 완료 수, 담당자 아바타, 일정과 차단 칩을 의미 단위 열로 나란히 놓는다. 행을 누르면 프로젝트 상세로 이동한다. 이 장부 형식이 시스템 전체의 기준 레이아웃이다.

## Do's and Don'ts

### Do:

- **Do** 새 색·반경·간격을 이 문서의 토큰(CSS 변수)으로 참조한다.
- **Do** 개입이 필요한 항목(차단·지연·미할당·검수 대기)에만 Attention Amber와 Signal Orange를 쓴다.
- **Do** 목록은 행 목록·표로 만들고 열을 의미 단위로 정렬한다.
- **Do** 호버와 선택은 배경 톤·테두리 색으로 표현하고 0.15초 안에 전환한다.
- **Do** 모든 조작 요소에 Soldoc Blue 초점 외곽선을 보장한다.

### Don't:

- **Don't** 12px보다 작은 글자를 쓰지 않는다(The 12px Floor Rule).
- **Don't** 패널·카드·버튼에 그림자를 주지 않는다. 그림자는 모달·메뉴 같은 떠 있는 요소 전용이다.
- **Don't** 로고 파랑(`soldoc-blue`) 위에 흰 글자를 올리지 않는다.
- **Don't** 주황을 글자색이나 넓은 배경으로 쓰지 않는다.
- **Don't** 컴포넌트 CSS에 새 hex 값이나 4·6·8·10px 밖의 모서리 반경을 직접 쓰지 않는다.
- **Don't** 둥근 상자 한쪽에만 강조선을 두지 않는다. 전체 1px 테두리나 배경 톤으로 구분한다. 사이드바 활성 메뉴의 주황 표시선만 예외다.
