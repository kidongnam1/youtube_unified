# 디버깅 히스토리 (Debugging History)

이 파일은 `youtube_unified` 및 관련 프로젝트에서 수행한 주요 디버깅 세션의 누적 로그입니다.
각 항목은 증상 → 근본 원인 → 해결 → 검증 → 문서화 → 재발 방지의 순서로 기록되며, 새 세션이 시작될 때
"같은 증상을 본 적 있는가?"를 빠르게 확인할 수 있도록 최신 항목이 맨 위에 위치합니다.

작성 규칙:
- 날짜는 ISO 8601 (YYYY-MM-DD) 형식.
- 증상은 사용자 관점의 표현 그대로 (예: "깜빡거림", "멈춤") 보존.
- 근본 원인은 한 줄로, 해결책은 도입한 패턴 이름과 진입점 함수를 명시.
- 파일/라인은 패치 직후 시점 기준으로 기록 (이후 코드가 이동하더라도 추적용 앵커).
- 재발 방지 항목은 ARCHITECTURE.md 또는 코드 리뷰 체크리스트로 연결.

---

## 2026-05-05 — UI 스레드 블로킹 (깜빡임/멈춤)

**프로젝트:** youtube_unified
**증상:** GUI 깜빡거림 + 클릭 후 멈춤
**근본 원인:** `_url_ready` / `_pid_alive` 가 UI 스레드에서 동기 실행 (urllib.request.urlopen, subprocess.run 호출이 QTimer 폴링 루프 안에서 직접 수행됨)
**해결:** `_AsyncProbe(QRunnable)` 워커 풀 + `_async_check(fn, on_done)` 진입점 도입, `_poll_until` interval 250→600ms 로 완화
**검증:** `pytest tests/test_async_probe.py` (QSignalSpy 로 `done` 시그널 수신 검증)
**문서:** `ARCHITECTURE.md` (UI 스레드 격리 규칙 섹션 추가)
**파일:** `unified_launcher_window.py` (lines 13, 42-78, 165-201, `refresh_status`)
**재발 방지:** `ARCHITECTURE.md` 코드 리뷰 체크리스트 — "UI 슬롯 안에서 urllib / subprocess / requests / time.sleep 직접 호출 금지" 항목 신설

### 캐노니컬 패치 코드 (`_AsyncProbe`)

```python
# unified_launcher_window.py — UI 스레드 격리 워커
# PyQt5 / PyQt6 동일 패턴으로 동작합니다.
from PyQt5.QtCore import QObject, QRunnable, QThreadPool, pyqtSignal, pyqtSlot

class _ProbeSignals(QObject):
    done = pyqtSignal(object)   # 결과 객체 (성공/실패 모두 전달)
    failed = pyqtSignal(object) # 예외 객체

class _AsyncProbe(QRunnable):
    """
    UI 스레드에서 동기 I/O (urlopen, subprocess.run, requests.get, time.sleep) 를
    절대 호출하지 않기 위한 단일 진입 워커.
    fn 은 인자 없는 callable 이어야 하며, on_done(result) 는 메인 스레드에서 호출됨.
    """
    def __init__(self, fn):
        super().__init__()
        self.fn = fn
        self.signals = _ProbeSignals()
        self.setAutoDelete(True)

    @pyqtSlot()
    def run(self):
        try:
            result = self.fn()
        except Exception as exc:  # 워커에서 예외를 삼키지 말 것
            self.signals.failed.emit(exc)
            return
        self.signals.done.emit(result)


def _async_check(fn, on_done, on_error=None):
    """UI 슬롯에서 호출하는 표준 진입점. 결과/에러 콜백은 메인 스레드에서 수행됨."""
    probe = _AsyncProbe(fn)
    probe.signals.done.connect(on_done)
    if on_error is not None:
        probe.signals.failed.connect(on_error)
    QThreadPool.globalInstance().start(probe)
```

---

(다음 세션부터 새 항목을 위에 추가하세요)
