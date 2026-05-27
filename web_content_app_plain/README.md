# TubeGen Plain

React/Vite 없이 동작하는 HTML/JS 콘텐츠 자동화 프런트엔드입니다.

## 실행

통합 런처에서 `콘텐츠 웹 앱`을 누르면 이 폴더가 Python 정적 서버로 실행됩니다.

수동 실행:

```powershell
cd D:\program\youtube_unified\web_content_app_plain
python -m http.server 3000
```

브라우저:

```text
http://localhost:3000/
```

**ES 모듈**(`type="module"`)을 사용하므로 `file://`로 열지 말고 반드시 로컬 HTTP 서버로 열어야 합니다.

## 포함 기능

- 자세한 사용법: `MANUAL.md`
- API 키·모델: Gemini(텍스트/이미지), ElevenLabs, FAL — 모두 `localStorage`에만 저장
- 주제 또는 수동 대본 → Gemini 스토리보드 생성, 수동 씬 분할
- 씬별 편집(나레이션·이미지 프롬프트) 및 에셋 미리보기
- **Gemini 이미지 생성** (`gemini-2.5-flash-image`, 화풍 프리셋/커스텀)
- **ElevenLabs TTS** (with-timestamps, 선택 시 Gemini로 자막 의미 단위 분리)
- **FAL PixVerse v5.5** 이미지→영상 (앞 N씬 일괄)
- **MP4 또는 WebM 내보내기**: Canvas + `MediaRecorder` (브라우저가 MP4 미지원 시 WebM)
- 프로젝트 저장/불러오기/삭제(JSON에 에셋 포함), JSON/CSV 내보내기

## 모듈 구조

- `app.js` — UI 및 파이프라인 조립
- `services/config.js` — 저장소 키·기본값
- `services/prompts.js` — 이미지용 최종 프롬프트
- `services/geminiImage.js` — Gemini REST 이미지 생성
- `services/geminiSubtitle.js` — 자막 의미 분리(선택)
- `services/elevenLabs.js` — ElevenLabs TTS
- `services/fal.js` — FAL 업로드 + PixVerse
- `services/videoExport.js` — 미디어 레코더 렌더링

## 참고

- API 키는 브라우저에 노출됩니다. 로컬·개인용 전제입니다.
- ElevenLabs **음성 목록 API**는 CORS로 브라우저에서 막힐 수 있어 Voice ID를 직접 입력합니다.
