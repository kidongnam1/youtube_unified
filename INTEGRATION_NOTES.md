# Integration Notes

## 기준 판단

`youtube_movie`는 PySide6 기반 단일 파일 데스크톱 앱과 검증/리포트 스크립트가 이미 있어 운영 기준 폴더로 삼았습니다.

`youtube_auto`는 React/Vite 콘텐츠 생성 앱과 별도 Tkinter 자막 추출 도구가 있어 기능 모듈로 통합했습니다.

## 제외한 항목

- zip 압축 파일
- 스크린샷
- 로그와 과거 리포트 산출물
- 중복 중첩 폴더
- `.env.local` API 키 파일
- 외부 도구 전체 배포본 예: Snipaste

## 가져온 항목

- `desktop_app`: `run.py`, `requirements.txt`, `scripts`, `templates`, 실행 안내 문서
- `web_content_app`: React/Vite 기준 앱 소스, components, services, utils, package 파일
- `tools`: `u_scrp.py`

## 다음 구현 후보

- `desktop_app/run.py` 안에 자막 추출 기능 직접 통합
- `desktop_app/run.py` 안에 웹 콘텐츠 앱 실행 버튼 추가
- 공통 설정 폴더 생성: API 키 템플릿, 출력 경로, 프로젝트 기본값
- 빌드/패키징 자동화: Python venv 생성, npm install, smoke check
