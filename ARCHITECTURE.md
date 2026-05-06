# YouTube Unified — 아키텍처 문서

> 작성일: 2026-05-05
> 대상: YouTube Unified 런처 프로젝트 (PySide6 기반 통합 진입점)
> 운영 책임: 남기동 (CEO)

---

## 1. 프로젝트 개요

YouTube Unified 는 영상 제작 워크플로우의 여러 도구를 **하나의 창**에서 제어하기 위한 데스크톱 런처입니다. 사용자(주로 비개발자)는 런처에서 한 번의 클릭으로 다음 작업을 시작할 수 있습니다.

| 액션 | 무엇을 하는가 |
|------|---------------|
| 통합 웹 앱 (추천) | FastAPI 백엔드(8000) + 정적 웹 서버(3000) 기동 후 브라우저 자동 오픈 |
| 레거시 영상 만들기 | PySide6 기반 데스크톱 자동화 앱 (`desktop_app/run.py`) 실행 |
| 레거시 웹 편집 | 정적 HTML 서버(`web_content_app_plain/`) 시작 후 브라우저 오픈 |
| 자막 도구 | Tkinter 독립 도구 (`tools/u_scrp.py`) 실행 |

런처는 자식 프로세스 PID 추적, 헬스체크 (`http://localhost:3000/`), 비정상 종료 시 1회 자동 재시도, 종료 시 모든 자식 프로세스 정리를 책임집니다.

---

## 2. 모듈 구조 (high-level)

```
youtube_unified/
├── integrated_launcher.py        # 진입점 (Qt 애플리케이션 부트스트랩)
├── unified_launcher_window.py    # LauncherWindow (UI + 프로세스 오케스트레이션)
├── backend/                      # FastAPI 백엔드 (uvicorn 으로 기동)
│   └── main.py                   # ASGI 앱
├── desktop_app/                  # 레거시 PySide6 영상 자동화 앱
│   └── run.py
├── web_content_app_plain/        # 정적 웹 콘텐츠 (http.server 로 서빙)
│   └── vite-dev.pid              # 런처가 기록하는 PID 파일
├── tools/                        # 보조 도구 (자막 추출 등)
│   └── u_scrp.py
├── launcher_crash.log            # 런처 자체 디버그 로그
├── launcher_child.log            # 자식 프로세스 stdout/stderr 통합 로그
└── ARCHITECTURE.md               # (이 문서)
```

| 모듈 | 책임 | 비고 |
|------|------|------|
| `integrated_launcher.py` | `QApplication` 생성, `LauncherWindow` 표시 | 가벼운 부트스트랩 |
| `unified_launcher_window.py` | UI, 상태 폴링, 프로세스 관리, 비동기 헬퍼 | **본 문서의 핵심 대상** |
| `backend/` | REST/WS API 제공 (uvicorn `--port 8000`) | 통합 웹 앱 모드에서만 사용 |
| `desktop_app/` | 영상 편집 GUI (레거시) | 별도 프로세스로 GUI 기동 |
| `web_content_app_plain/` | 정적 웹 자산 | `python -m http.server 3000` |
| `tools/` | 단발성 보조 GUI | Tkinter 등 자체 메인루프 |

---

## 3. UI 스레드 격리 규칙 (가장 중요)

### 3.1 한 줄 요약

> **UI 스레드에서는 절대로 블로킹 I/O 를 호출하지 않는다.** I/O 가 필요하면 반드시 `LauncherWindow._async_check(fn, on_done)` 진입점을 통해 워커 풀에서 실행한다.

### 3.2 왜 그래야 하는가 (14살도 알아들을 비유)

운전을 한다고 상상해 봅시다.
- **UI 스레드 = 운전자의 두 손**: 핸들을 잡고 화면을 매 프레임 다시 그려야 합니다.
- **블로킹 I/O = 문자 보내기**: 시간이 얼마나 걸릴지 모릅니다(0.2초~1.2초).

> **한 손으로 운전하면서 문자를 보낼 수는 없습니다.**
> 문자를 쓰는 동안 차는 그냥 직진하다가 신호를 못 보고 멈춥니다 — 이게 바로 "UI 가 깜빡이고 멈추는" 현상입니다.

해결책은 단순합니다. **조수석에 친구(워커 스레드)를 태워서 문자를 시키고**, 답이 오면 운전자에게 한마디로 알려달라고 합니다(시그널). 운전자는 계속 두 손으로 운전만 합니다.

코드에서 친구 = `_AsyncProbe(QRunnable)`, 한마디 알림 = `Signal(bool)`, 진입점 = `_async_check(fn, on_done)`.

### 3.3 왜 2026-05-05 P0 패치가 필요했는가

패치 전 동작 (`unified_launcher_window.py` 코드 주석 참조):

| 함수 | UI 스레드 블로킹 시간 | 호출 빈도 |
|------|----------------------|-----------|
| `_url_ready()` | 최대 1.2초 (`urllib.urlopen`) | 250ms 폴링 → 매번 |
| `_pid_alive()` | 0.2~0.6초 (`subprocess.run("tasklist")`) | 250ms 폴링 → 매번 |

→ 결과: **창이 250ms 마다 멈췄다 깨어났다**를 반복하면서 시각적으로 "깜빡임" 발생.

패치 후:
- 두 함수 모두 `QThreadPool.globalInstance()` 위에서 실행.
- 결과는 `Signal(bool)` 로 메인 스레드에 전달.
- 폴링 간격 기본값 250ms → 600ms 로 상향 (UI 부하 추가 감소).
- `refresh_status()` 는 setText/style 만 만지므로 페인트가 막히지 않음.

---

## 4. 비동기 패턴 사용 가이드 (BAD vs GOOD)

### 4.1 BAD — UI 스레드에서 직접 블로킹 호출

```python
# 절대 이렇게 쓰지 말 것 (UI 스레드에서 최대 1.2초 + 0.6초 = 1.8초 멈춤)
def refresh_status(self) -> None:
    if self._url_ready(WEB_URL, timeout=1.2):       # 블로킹!
        self.web_status.setText("실행 중")
    else:
        pid = self._read_pid()
        if pid and self._pid_alive(pid):            # 블로킹!
            self.web_status.setText("시작 중")
        else:
            self.web_status.setText("대기")
```

증상:
- 창이 매번 멈췄다 다시 그려짐 → 깜빡임.
- 사용자가 버튼을 눌러도 클릭 이벤트가 큐에 쌓여 "한참 뒤" 처리됨.
- Windows 가 "응답 없음" 으로 인식할 수도 있음.

### 4.2 GOOD — `_async_check` 로 워커 풀에서 실행

```python
# 패치된 실제 구현 (unified_launcher_window.py:371)
def refresh_status(self) -> None:
    pid = self._read_pid()  # 파일 read 1회는 매우 빠르므로 OK

    def apply_state(text: str, state: str) -> None:
        # 상태 변화가 있을 때만 repaint → 추가 깜빡임 방지
        if (text != self._last_web_status_text
                or state != self._last_web_status_state):
            self.web_status.setText(text)
            self.web_status.setProperty("state", state)
            self.web_status.style().unpolish(self.web_status)
            self.web_status.style().polish(self.web_status)
            self._last_web_status_text = text
            self._last_web_status_state = state

    def on_pid_check(alive: bool) -> None:
        apply_state("시작 중" if alive else "대기", "idle")

    def on_web_check(web_ok: bool) -> None:
        if web_ok:
            apply_state("실행 중", "ok")
            return
        if pid is None:
            apply_state("대기", "idle")
            return
        # tasklist 도 워커 풀로
        self._async_check(lambda p=pid: self._pid_alive(p), on_pid_check)

    # urllib 호출을 워커 풀로
    self._async_check(self._web_ready, on_web_check)
```

핵심 패턴:
1. **블로킹 함수는 `fn` 으로 캡슐화** (인자가 필요하면 `lambda` 로 바인딩).
2. **`self._async_check(fn, on_done)` 호출** — 결과는 메인 스레드 콜백 `on_done(ok: bool)` 으로.
3. **콜백 안에서 위젯 업데이트** — Qt 위젯은 메인 스레드에서만 만져야 함.
4. **상태가 바뀔 때만 repaint** — `_last_web_status_*` 캐시로 무용한 paint 방지.

### 4.3 폴링이 필요하면 `_poll_until` 사용

```python
self._poll_until(
    condition=self._web_ready,           # 블로킹 OK — 내부에서 _async_check 사용
    on_ok=lambda: self.open_web_app(),
    on_timeout=lambda: self.log("지연", level="warn"),
    timeout_ms=10000,
    interval_ms=300,                     # 250 미만으로 내리지 말 것
)
```

`_poll_until` 은 내부에서 `_async_check` 를 사용하므로 UI 스레드를 차단하지 않습니다.

---

## 5. 코드 리뷰 체크리스트

PR 리뷰 시 다음 항목을 **반드시** 확인합니다. 하나라도 위반되면 머지 금지.

### 5.1 UI 스레드 보호 (P0)

- [ ] **UI 스레드에서 `subprocess.run(...)` 직접 호출 금지** — `_async_check` 또는 `Popen` 으로 비동기화.
  - 예외: `closeEvent` 의 `taskkill` (이미 종료 중이라 멈춤이 보이지 않음).
- [ ] **UI 스레드에서 `urllib.request.urlopen` / `requests.get` 등 HTTP 직접 호출 금지** — `_async_check` 경유.
- [ ] **UI 스레드에서 `time.sleep` 금지** — 지연이 필요하면 `QTimer.singleShot(ms, callback)`.
- [ ] **UI 스레드에서 `proc.wait()` / `proc.communicate()` 금지** — 완료 확인은 `QTimer` + `proc.poll()` 폴링.
- [ ] **UI 스레드에서 큰 파일 read/write 금지** — 100ms 넘게 걸릴 수 있는 작업은 모두 워커.

### 5.2 Qt 사용 규칙

- [ ] 워커 스레드(`QRunnable.run` 안)에서 **위젯을 직접 만지지 말 것**. 결과는 `Signal` 로 emit 후 메인 스레드 슬롯에서 위젯 갱신.
- [ ] 위젯 속성(state 등) 변경 후 `unpolish/polish` 가 필요한지 확인.
- [ ] 폴링 `interval_ms` 는 **300ms 이상** (UI 부하 고려). 빠른 반응이 필요하면 이벤트 기반으로 재설계.

### 5.3 프로세스 관리

- [ ] `Popen` 호출 시 `_spawn_meta` 에 메타데이터 등록 (label/args/cwd/started_at).
- [ ] 새 프로세스는 `closeEvent` 에서 정리되도록 `self._processes` 에 추가.
- [ ] PID 파일을 만들면 `closeEvent` 에서 `unlink(missing_ok=True)`.

### 5.4 로깅

- [ ] 사용자 행동/상태 변화는 `self.log(..., level=...)` 로 화면 로그에.
- [ ] 디버그성 정보는 `self._append_debug("LEVEL", "msg")` 로 `launcher_crash.log` 에.
- [ ] 자식 프로세스 stdout/stderr 는 `_open_child_log_stream` 으로 `launcher_child.log` 에 리다이렉트.

---

## 6. 향후 개선 후보

### P1 — 다음 스프린트 (안정성)

- **`refresh_status` 를 더 정리**: 현재 `_read_pid()` 는 파일 I/O 1회로 빠르지만, 향후 PID 파일이 네트워크 드라이브로 옮겨질 가능성 대비 워커로 격리.
- **`run_web_app` 내부의 `self._web_ready()` / `self._pid_alive(existing)` 동기 호출 제거**: 현재 사용자 액션 직후 1회뿐이지만, 동일한 비동기 패턴으로 통일하면 일관성 향상.
- **타이머 자동 활성화 옵션**: 현재 `self.timer.timeout.connect(...)` 만 연결되어 있고 `start()` 가 호출되지 않음. 설정으로 켜고 끌 수 있게.

### P2 — 분기 내 (이식성/유지보수)

- **`tasklist` → `psutil` 마이그레이션**: `_pid_alive` 와 `_terminate_spawned_processes` 의 `taskkill` 을 `psutil.pid_exists` / `psutil.Process(pid).terminate()` 로 교체. 크로스플랫폼 + 외부 프로세스 호출 제거(블로킹 시간 추가 감소).
- **헬스체크 캐싱**: `_web_ready` 결과를 1~2초 TTL 로 캐시 → 워커 호출 빈도 추가 감소.
- **상태 페일오버**: 백엔드/웹서버 둘 다 죽으면 사용자에게 모달로 안내 + 1-클릭 재시작 버튼.

### P3 — 장기 (구조 개선)

- **예외 처리 정리**: 현재 `_AsyncProbe.run` 은 모든 예외를 `False` 로 환원. 네트워크 에러 vs 비정상 상태를 구분할 수 있도록 `Result(ok: bool, error: Optional[str])` 형태로 시그널 페이로드 확장.
- **상태 머신화**: `idle / starting / ready / error` 4-state FSM 으로 분리하면 `apply_state` 분기가 단순해짐.
- **백엔드 / 데스크톱 / 웹 / 자막 모드를 플러그인 인터페이스로 추상화**: 새 도구 추가 시 카드 1개만 등록하면 끝나도록.

---

## 7. 변경 이력 (Changelog)

- **2026-05-05: P0 patch — UI thread async isolation (Ruby)**
  - `_AsyncProbe(QRunnable)` + `_AsyncProbeSignals(QObject)` 도입.
  - `LauncherWindow._async_check(fn, on_done)` 단일 진입점 추가.
  - `refresh_status()`, `_poll_until()` 내부의 `_url_ready` / `_pid_alive` 호출을 워커 풀로 이전.
  - 폴링 기본 간격 250ms → 600ms (UI 부하 감소).
  - `refresh_status` 에 상태 변화 캐시(`_last_web_status_text`/`_last_web_status_state`) 추가, 무용한 repaint 제거.
  - 결과: 메인 창 깜빡임/멈춤 현상 제거.
