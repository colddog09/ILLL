# 오일추

> 할일을 추가하고, 드래그해서 날짜에 배치하는 일정 관리 웹앱

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
| 📊 시간표 위젯 | 오늘/내일 시간표 표시 (설정에서 ON/OFF) |
| 🗓️ Google Calendar 연동 | 로그인 시 캘린더 영구 연동 (refresh token 기반) |
| 🔗 링크 모음 | 자주 쓰는 링크 등록 및 빠른 접근 |
| 🔔 푸시 알림 | 매일 오전 알림 (PWA 설치 시) |
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

**순서 변경**
- PC: `⠿` 핸들 드래그
- 모바일: 일정 탭 선택(파란 테두리) → 드래그

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
ILLL/
├── index.html          # 메인 UI
├── style.css           # 전체 스타일
├── script.js           # 상태 관리 + Supabase 연동
├── render.js           # 렌더링
├── events.js           # 이벤트 핸들러
├── drag.js             # 드래그 앤 드롭
├── gcal.js             # Google Calendar 연동
├── utils.js            # 유틸리티
├── deadline.js         # 기한 설정 UI
├── sw.js               # Service Worker
├── manifest.json       # PWA 설정
├── api/
│   ├── config.js       # 환경변수 제공 엔드포인트
│   ├── gcal-token.js   # Google Calendar 토큰 갱신
│   ├── push-subscribe.js
│   └── push-notify.js
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

## 라이선스

MIT © 2025 [colddog09](https://github.com/colddog09)
