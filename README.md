# 오일추 — 오늘 일정 추천해줘~~ 🗓️

> 할일을 추가하고 드래그해서 날짜에 배치하는 일정 관리 웹앱

🔗 **[o1chu.my](https://o1chu.my)**

![PWA](https://img.shields.io/badge/PWA-supported-6c63ff?style=flat-square)
![Vercel](https://img.shields.io/badge/Deployed-Vercel-000?style=flat-square&logo=vercel)
![Supabase](https://img.shields.io/badge/DB-Supabase-3ECF8E?style=flat-square&logo=supabase)

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 🔐 Google 로그인 | Supabase Auth — 기기 간 자동 동기화 |
| 📦 할일 풀 | 할일을 등록해두고 언제든 날짜에 배치 |
| 🗓️ 드래그 앤 드롭 | 할일 카드를 날짜 칸으로 드래그해서 배치 |
| ✅ 완료 처리 | O 버튼으로 완료 표시 및 진행률 시각화 |
| ⏳ 자동 반환 | 미완료 항목을 다음 날로 자동 이동 |
| 📝 날짜 메모 | 날짜별 자유 메모 |
| 👥 그룹 일정 공유 | 초대 코드로 그룹 생성·참여, 공지 일정을 내 리스트로 가져오기 |
| 🗓️ Google Calendar 연동 | 로그인 시 캘린더 영구 연동 (refresh token 기반) |
| ⏰ D-Day 카운터 | 상단 고정 D-Day 표시, 설정에서 날짜 변경 가능 |
| 🔗 링크 모음 | 자주 쓰는 링크 등록 및 빠른 접근 |
| 🔔 푸시 알림 | 매일 오전 알림 (PWA 설치 시) |
| 🎨 테마 변경 | 보라·블루·그린·다크·리퀴드 글라스·젤리·스타레일 |
| 📱 PWA | 홈 화면에 설치해 네이티브 앱처럼 사용 |

---

## 사용 방법

**할일 추가**
1. 상단 입력창에 할일 입력 → 엔터
2. 할일 풀(가로 스크롤)에 카드로 추가됨

**일정 배치**
- 드래그 앤 드롭: 카드를 날짜 칸으로 드래그
- 더블클릭 / 더블탭: 오늘 날짜에 즉시 배치

**일정 제거 / 삭제**
- 배치된 일정 더블클릭 → 풀로 반환
- 드래그 → 🗑️ 휴지통 → 완전 삭제

**그룹 일정 공유**
- 하단 탭바 👥 또는 헤더 그룹 버튼으로 진입
- `+` 버튼으로 그룹 만들기 / 초대 코드로 참여
- 공지된 일정을 `+ 내 리스트` 버튼으로 가져오기
- 그룹장: ⚙️ 버튼으로 이름 변경·멤버 권한·그룹 삭제

---

## 기술 스택

- **Frontend**: HTML · CSS · Vanilla JS (빌드 없음)
- **Auth / DB**: [Supabase](https://supabase.com) (Google OAuth + PostgreSQL)
- **Calendar**: Google Calendar API (GIS + server-side refresh token)
- **Push**: Web Push API + Vercel Serverless Functions
- **Hosting**: [Vercel](https://vercel.com)
- **PWA**: Web App Manifest + Service Worker

---

## 파일 구조

```
오일추/
├── index.html          # 메인 앱 UI
├── landing.html        # 랜딩 페이지
├── style.css           # 전체 스타일
├── state.js            # 상태 관리 + Supabase 연동
├── auth.js             # Supabase 인증 + 로그인 UI
├── render.js           # 렌더링
├── events.js           # 이벤트 핸들러
├── drag.js             # 드래그 앤 드롭
├── modals.js           # 모달 UI (설정·테마·D-Day 등)
├── groups.js           # 그룹 일정 공유
├── gcal/
│   └── gcal.js         # Google Calendar 연동
├── deadline.js         # 기한 설정 UI
├── push.js             # 푸시 알림
├── utils.js            # 공통 유틸리티
├── sw.js               # Service Worker
├── manifest.json       # PWA 설정
├── groups-schema.sql   # 그룹 기능 DB 스키마
├── api/
│   ├── config.js       # 환경변수 제공 엔드포인트
│   ├── gcal-callback.js
│   ├── gcal-token.js   # Google Calendar 토큰 갱신
│   ├── push-subscribe.js
│   └── push-notify.js
├── terms.html          # 이용약관
├── privacy.html        # 개인정보처리방침
└── README.md
```

---

## 환경변수 (Vercel)

| 키 | 설명 |
|----|------|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth 클라이언트 ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth 클라이언트 시크릿 |
| `VAPID_PUBLIC_KEY` | Web Push VAPID 공개키 |
| `VAPID_PRIVATE_KEY` | Web Push VAPID 비공개키 |

---

## 저작권

© 2026 colddog09. All Rights Reserved.

이 프로젝트의 소스코드 및 디자인에 대한 모든 권리는 저작자에게 있습니다.
무단 복사·배포·상업적 이용을 금지합니다.
