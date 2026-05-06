# 영상 작업 만들기 — 사용 설명서

통합 런처의 **「① 영상 만들기」**에서 실행하는 **`desktop_app\run.py`** (Video Automation, PySide6 데스크톱 앱) 기준 안내입니다.

---

## 1. 이 기능이 하는 일

- **로컬 영상 파일** 또는 **YouTube URL**을 입력받습니다.
- 프로젝트 폴더를 만들고, **프레임 캡처 · 오디오 추출 · 로컬 Whisper 자막 · 간단 편집(트림·볼륨 등) · 스마트 프레임 검색 · 썸네일**까지 한 흐름으로 처리합니다.
- **최종 영상 · 자막 · 로그** 등을 프로젝트 폴더에 남기는 **단일 창 데스크톱 앱**입니다.

---

## 2. 시작 전 준비

| 항목 | 내용 |
|------|------|
| Python | 3.x |
| 패키지 | `desktop_app` 폴더에서 `pip install -r requirements.txt` (PySide6, opencv-python, numpy, openai-whisper, **yt-dlp** 등) |
| FFmpeg | **반드시 설치 후 PATH에 등록** (오디오·영상 처리에 필요) |
| 실행 | 통합 런처에서 **「영상 작업 시작하기」** 또는 `desktop_app`에서 `python run.py` |

---

## 3. 런처에서 여는 방법

1. `RUN_MENU.bat` / `RUN_MENU.ps1` 또는 `YouTube_Unified_Launcher.py` 실행  
2. **「① 영상 만들기」** 카드의 **「영상 작업 시작하기」** 클릭  
3. 별도 콘솔 창과 함께 **영상 자동화 앱 창**이 열립니다.

---

## 4. 화면 구성 (위에서 아래 · 좌→우)

### Dashboard (상단)

| 요소 | 설명 |
|------|------|
| **Run Preflight Check** | 환경·경로 등 사전 점검 |
| **One-Click Process** | 입력·설정을 바탕으로 **여러 단계를 연속 자동 실행** (프리플라이트 통과 후) |
| **Generate** | 메인 **생성·처리** 실행 (프리셋·옵션 반영) |
| **Total Processed / Last Status / Error Count** | 처리 횟수·마지막 상태·에러 횟수 |

### Input (왼쪽 위)

- **Browse…** — 로컬 비디오 파일 선택  
- **텍스트 필드** — 로컬 **전체 경로** 입력 후 **Enter**, 또는 **YouTube watch URL** 붙여넣기  
- **Select Project Root** — 프로젝트를 둘 **상위 출력 폴더** 선택  
- 그 아래 읽기 전용 필드 — 현재 **프로젝트 루트** (기본은 `video_projects`와 연동)

### YouTube (Input과 같은 영상 경로 필드 사용)

- **Check URL** — URL 메타데이터 확인  
- **Download and Prepare** — **yt-dlp**로 내려받은 뒤 이후 파이프라인과 동일하게 준비  
- **Source** 라벨 — 출처 정보 표시

### Static Info Snapshot (선택)

- 영상의 **정적 구간** 등을 분석해 스냅샷·JSON을 뽑는 보조 기능  
- **Run Static Snapshot** — 실행  
- **Open Snapshots Folder** — 결과 폴더 열기  
- **Diff threshold** — 정적 판정 민감도 (낮을수록 엄격)  
- **Config key** — 선택 값이 `static_index.json` 등에 기록될 수 있음

### Minimal Editing

- **Trim Start / End (sec)** — 앞·뒤 자르기  
- **Volume** — 슬라이더 배율 (예: `1.00x`)  
- **Capture Times** — 고정 시점 프레임 추출 시각 (예: `3,10,20`)

### Smart Frame Search

- **Search Mode**  
  - **Auto Best Frames** — 좋은 프레임 후보 자동 탐색  
  - **Guided Range Search** — **Target Time · Search Window** 등으로 구간 지정 후 **Refine by Range**  
- **Result Count, Sampling Interval, Min Frame Gap, Target Time, Search Window** — 검색 세부 옵션  
- **Find Best Frames** / **Refine by Range** — 모드에 맞게 실행

### Processing (가운데)

- 진행률 막대, **Processing Status**  
- **Smart Results** 목록 + **미리보기** — 추출된 대표 프레임(썸네일 후보)

### Subtitle and Logs (오른쪽)

- **Subtitle Preview** — 자막 텍스트 표시·편집  
- **Apply Subtitle Changes** — 편집 반영(TXT/SRT 등 갱신)  
- **Save Selected Thumbnail** — 선택 프레임을 썸네일로 저장  
- **Preset** — `Standard`, `Smart Frames Only`, `Subtitle First`, `Quick Preview` (처리 순서·강조 단계 차이)  
- **Open Output Folder** / **Export** — 결과 폴더 열기 · 내보내기 요약  
- **로그** — 실행 로그

---

## 5. 권장 작업 순서 (처음 사용자)

1. **FFmpeg·의존성** 설치 후 **Run Preflight Check**  
2. **Select Project Root**로 출력 위치 확인  
3. **소스 선택**  
   - 로컬: **Browse** 또는 경로 입력 후 Enter  
   - YouTube: URL 입력 → **Check URL** → **Download and Prepare**  
4. 필요 시 **Minimal Editing** · **Smart Frame Search** 조정  
5. **Preset** 선택 후 **Generate**, 또는 한 번에 **One-Click Process**  
6. **썸네일 선택·저장**, 자막 수정 후 **Apply**, **Open Output Folder**로 결과 확인  

---

## 6. 결과물 위치

- 기본적으로 **`desktop_app` 실행 시 작업 디렉터리 기준 `video_projects`** 아래에 프로젝트 폴더가 생성됩니다. (**Select Project Root**로 변경 가능)  
- Static Snapshot: `<프로젝트 루트>\static_snapshots\run_<타임스탬프>\` 등 (앱·README_run_package 설명과 동일)

---

## 7. 주의·제한

- **Whisper**는 로컬 실행 — GPU/CPU·모델에 따라 소요 시간이 클 수 있음  
- **YouTube** — **yt-dlp** 설치, 네트워크, 사이트 정책의 영향  
- 작업 중 창을 닫을 때 **실행 중이면** 종료 확인 대화상자가 뜰 수 있음  

---

## 8. 관련 파일

| 파일 | 용도 |
|------|------|
| `run.py` | 데스크톱 앱 본체 |
| `README_RUN_PACKAGE.txt` | 실행·스냅샷·스크립트 요약 |
| `RELEASE_NOTES.md` | 버전·의존성·변경 요약 |
| `requirements.txt` | Python 패키지 목록 |
