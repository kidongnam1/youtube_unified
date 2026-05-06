# YouTube Unified

`youtube_movie`와 `youtube_auto`를 한 폴더에서 관리하기 위한 통합 작업 폴더입니다.

원본 폴더는 수정하지 않았습니다.

- 원본 1: `D:\program\youtube_movie`
- 원본 2: `D:\program\youtube_auto`
- 통합 폴더: `D:\program\youtube_unified`

## 폴더 구조

- `desktop_app/`
  - 기존 `youtube_movie\VideoAutomation_RunPackage`의 PySide6 데스크톱 영상 자동화 앱입니다.
  - 주요 실행 파일: `desktop_app\run.py`

- `web_content_app/`
  - 기존 `youtube_auto`의 React/Vite 콘텐츠 자동화 앱 보존본입니다.

- `web_content_app_plain/`
  - React 없이 동작하는 HTML/JS 콘텐츠 자동화 앱입니다. ES 모듈(`services/*.js`)을 쓰므로 **반드시 로컬 HTTP로 연다** (`file://` 불가).
  - 포함: Gemini 스토리보드·이미지 생성, ElevenLabs TTS, FAL(PixVerse) 이미지→영상, Canvas + MediaRecorder **MP4 또는 WebM** 내보내기.
  - 상세·폴더 구조: `web_content_app_plain\README.md`
  - 실행 예: `python -m http.server 3000 --bind 127.0.0.1` 후 브라우저에서 `http://127.0.0.1:3000/`

- `tools/`
  - 보조 도구 모음입니다.
  - 현재 포함: `u_scrp.py` 유튜브 자막 추출 Tkinter 도구

## 빠른 실행

루트 폴더에서 아래 파일을 실행합니다. 이제 콘솔 메뉴가 아니라 데스크톱 런처 UI가 열립니다.

```powershell
.\RUN_MENU.ps1
```

또는 Windows에서 `RUN_MENU.bat`을 더블클릭해도 됩니다.

## 사전 준비

### 데스크톱 영상 자동화 앱

```powershell
cd D:\program\youtube_unified\desktop_app
pip install -r requirements.txt
python run.py
```

추가로 FFmpeg가 Windows PATH에 등록되어 있어야 합니다.

### 웹 콘텐츠 자동화 앱 (`web_content_app_plain`)

```powershell
cd D:\program\youtube_unified\web_content_app_plain
python -m http.server 3000 --bind 127.0.0.1
```

브라우저에서 `http://127.0.0.1:3000/` 로 접속합니다.

Gemini·ElevenLabs·FAL 등 API 키와 모델은 앱의 **API 설정**에서 저장합니다. 값은 **브라우저 localStorage에만** 남으며, 운영 배포용이 아닌 로컬·개인 사용 전제입니다.

### 유튜브 자막 추출 도구

```powershell
cd D:\program\youtube_unified\tools
pip install youtube-transcript-api
python u_scrp.py
```

## 통합 원칙

이 통합본은 1차 정리본입니다. 서로 다른 기술 스택을 억지로 한 코드베이스에 섞지 않고, 하나의 루트 폴더와 실행 메뉴에서 관리하도록 구성했습니다.

추가로 할 수 있는 작업 예시:

1. 데스크톱 앱 안에 웹 앱 실행 버튼 추가
2. React 앱(`web_content_app`) 결과물을 데스크톱 앱 폴더로 내보내기 연결
3. 자막 추출 도구(`tools/u_scrp.py`)를 데스크톱 앱 UI로 흡수
4. API 키·설정을 공통 `settings/` 등으로 정리(현재는 웹 앱이 브라우저 저장소 사용)
