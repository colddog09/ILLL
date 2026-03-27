# 📋 일정관리 (ILLL)

GBS 2학년을 위한 드래그&드롭 방식의 일정 관리 웹앱입니다.
Firebase를 통해 로그인하면 모든 기기에서 실시간 동기화됩니다.

🔗 **배포 주소**: [planmanager-six.vercel.app](https://planmanager-six.vercel.app)

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| 🔐 Google 로그인 | Firebase Auth로 기기 간 실시간 동기화 |
| 📦 할일 풀 | 할일을 입력해 두면 언제든 날짜에 배치 가능 (가로 스크롤) |
| 🗓️ 날짜별 일정 | 날짜를 넘기며 일정 관리 |
| ✅ 완료 표시 | O 버튼으로 완료 처리 및 진행률 표시 |
| ⏳ 뒤로 미루기 | 미완료 항목을 다음 날로 이동 |
| 📝 메모 | 날짜별 자유 메모 지원 |
| 📊 시간표 위젯 | 반별 오늘/내일 시간표 표시 (설정에서 ON/OFF) |
| 📂 과거 내역 | 이전 날짜의 일정 및 완료 현황 조회 |
| 📱 PWA 지원 | 홈 화면에 설치해 앱처럼 사용 가능 |

---

## 🕹️ 사용 방법

### 할일 추가
1. 상단 입력창에 할일 입력 후 **엔터** → 할일 풀에 추가
2. 할일 풀은 가로로 스크롤됩니다

### 일정에 배치
- **드래그 앤 드롭**: 할일 카드를 날짜 영역으로 드래그
- **더블클릭 / 더블탭**: 오늘 날짜에 바로 추가

### 일정 되돌리기 & 삭제
- 배치된 일정을 **더블클릭 / 더블탭** → 풀로 반환
- 배치된 일정을 **드래그 → 🗑️ 휴지통** → 완전 삭제

### 순서 변경
- **PC**: `⠿` 핸들을 드래그
- **모바일**: 일정을 탭해서 선택(파란 테두리) → 드래그로 이동

### 설정
- ⚙️ 버튼 → 소속 반 선택 및 시간표 표시 ON/OFF
- 📱 모바일에서는 **ℹ️ 정보** 버튼으로 설문 링크 & 과거 내역 접근

---

## 🛠️ 기술 스택

- **Frontend**: HTML, CSS, Vanilla JS (단일 파일 구조, 빌드 없음)
- **인증**: Firebase Authentication (Google OAuth)
- **DB**: Firebase Firestore (실시간 동기화)
- **배포**: Vercel
- **PWA**: Web App Manifest + Service Worker

---

## 📁 파일 구조

```
ILLL/
├── index.html       # 메인 HTML (UI 구조 + 모달)
├── style.css        # 전체 스타일
├── script.js        # 앱 로직 (Firebase, 드래그, 렌더링)
├── manifest.json    # PWA 설정
├── sw.js            # Service Worker
├── icon.png         # 앱 아이콘
└── README.md        # 이 파일
```

---

## 🚀 로컬 실행

별도 빌드 과정 없이 `index.html`을 브라우저에서 열면 됩니다.

```bash
open index.html
# 또는 VS Code Live Server 사용
```

---

## 👨‍💻 개발자

- GBS 2학년 재학생을 위해 제작
- 문의: GitHub Issues 또는 앱 내 설문 링크 활용
