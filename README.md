# 아그리콜라 드래프트 미니게임 (v0.2)

친구 10명 모임 프라이빗 사용을 위한 아그리콜라 **드래프트 단계만** 실시간으로 진행하는 미니게임.

## 새로 들어간 것 (v0.2)

- **8개 덱 (총 615장)** 자동 임포트 — Base A / E / I / K / G / C / Z / M
  - 카드 이름 · 코드 · 소속 덱 = 팬 컴펜디엄(alavigne.net) 기반 자동 반영
  - 카드 능력 텍스트 · 이미지 URL = **카드 관리 페이지에서 편집** (한 명이 채우면 서버에 저장되어 모두가 씀)
- **socket.io CDN 폴백** — 로컬 소켓 스크립트가 502여도 CDN으로 자동 로드해 흰 화면 안 뜸
- **드래프트 종료 후 투표 페이지**
  - 각 상대 플레이어의 빌드에 1~5★ 별점
  - 상대 픽 중 **MVP / dud 카드 클릭** (골드/빨강)
  - 모두 제출하면 자동 마감 (호스트는 즉시 마감 가능)
- **카드 티어 · 통계 페이지**
  - 티어 (S/A/B/C/D) — 점수 상위순 정렬로 자동 부여
  - 등장 횟수 · 픽 횟수 · 픽률 · MVP-dud 카운트 · 누적 점수
  - 이름/코드 검색
- **카드 관리 페이지**
  - 덱별 인라인 편집 (이름 · 능력 · 이미지 URL)
  - **CSV 일괄 임포트 / 내보내기**

## 실행

```bash
npm install
npm start   # http://localhost:3000
```

같은 와이파이 친구들과: 서버 PC 사설 IP (예 `http://192.168.0.10:3000`) 공유.
외부 사용: Railway / Render / Fly.io 무료 티어에 그대로 배포.

## 페이지 구조

- `#/` 로비 — 방 만들기 / 참가 / 이전 방 재접속
- `#/room/XXXXXX` 방 (드래프트 + 투표)
- `#/history` 종료된 드래프트 기록 목록
- `#/history/<file>` 개별 기록 상세 (플레이어별 픽 · 투표 결과 · 전체 로그)
- `#/stats` 카드 티어 / 통계 (누적)
- `#/admin` 카드 관리 홈 (덱 목록 · CSV 일괄 임포트)
- `#/admin/<deckId>` 개별 덱 카드 편집 (이름 · 능력 · 이미지 URL)

## 카드 능력 / 이미지 채우는 방법 (친구 1명만 한번 하면 됨)

1. 상단 "카드 관리" 클릭 → 편집할 덱 선택
2. 각 카드 행의 능력 / 이미지 URL 칸에 입력
3. 상단 "저장" 클릭 → 서버 파일에 저장, 이후 모두에게 즉시 반영

**CSV 일괄 임포트**가 훨씬 빠릅니다:

1. 관리 홈에서 CSV 붙여넣기 (헤더: `code,name,ability,imageUrl,deckId,kind`)
2. 매칭되는 코드는 UPDATE, 없으면 (deckId+kind+name 있을 때) ADD
3. "임포트 실행" 클릭

CSV 예시:
```csv
code,name,ability,imageUrl,deckId,kind
E13,도끼,울타리 설치 시 나무 -1,https://your-image-host/e13.jpg,e,minorImprovements
E14,빵 굽는 판,직업 카드 사용 시 음식 +1,https://your-image-host/e14.jpg,e,minorImprovements
```

이미지 URL은 각자 갖고 있는 카드 사진을 Imgur, Google Drive 공유 링크, 개인 서버 등에 올려 붙이면 됩니다.

## 티어 점수 계산

- 각 드래프트 종료 시 카드별 `seen` (내 손에 등장), `picked` (내가 픽함) 카운트
- 투표 마감 시:
  - 픽한 사람이 받은 별점의 (avg - 3) × 0.5 만큼 카드 점수에 반영
  - MVP 표시당 +1, dud 표시당 -1
- 누적 점수 상위순 정렬 → 상위 10% S, 다음 20% A, 중간 40% B, 다음 20% C, 하위 10% D

## 폴더 구조

```
agri-draft/
├── server.js                 # Express + Socket.IO
├── package.json
├── scripts/
│   └── build_decks.js        # 팬 컴펜디엄에서 카드 목록 재빌드
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
└── data/
    ├── decks/                # 덱 정의 (JSON)
    │   ├── a.json ~ m.json
    ├── history/              # 드래프트 종료 기록
    └── stats.json            # 누적 카드 통계 / 티어
```

## 참고

- 카드 이름 · 코드 · 덱 소속: [Unofficial Agricola Compendium](https://alavigne.net/Gaming/Agricola/agricola-comp-v9.0.html) 기반
- Agricola © Lookout Games / Uwe Rosenberg. 이 프로젝트는 친구 모임 프라이빗 팬 프로젝트이며 공식 상품이 아님.

## 이번 버전 알려진 한계

- 컴펜디엄 페이지 구조상 M덱 · A덱은 직업 카드가 자동 파싱에 안 잡혔음 (부속설비는 정상). 필요시 관리 페이지에서 직접 추가하거나 CSV 임포트로 채우면 됨.
- 능력 텍스트는 기본이 빈 값 — 관리 페이지에서 채워야 카드에 표시됨.
- 이미지 URL도 마찬가지 — 비어있으면 카드에 이미지 자리가 안 뜸.
