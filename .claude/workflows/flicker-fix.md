# Workflow: UI 깜빡임 / 멈춤 수정 (flicker-fix)

UI 스레드에서 동기 I/O 가 호출되어 발생하는 깜빡거림/멈춤 증상을 표준 절차대로 진단·수정·검증하기 위한 재사용 플레이북.
PyQt5/PyQt6/PySide2/PySide6 모두 동일 패턴으로 적용 가능합니다.

---

## 1. 언제 적용하는가 (증상 체크리스트)

다음 중 **하나 이상** 해당하면 본 워크플로우 진입:

- [ ] 윈도우/위젯이 주기적으로 깜빡이거나 리프레시될 때 화면이 한 번 검게/하얗게 그려진 뒤 다시 그려짐
- [ ] 버튼 클릭 직후 0.2~3 초 동안 UI 가 멈춤 (Windows 의 "응답 없음" 표시 포함)
- [ ] `QTimer` / `QThread.msleep` / `time.sleep` 가 UI 슬롯 내부에 존재
- [ ] `urllib.request.urlopen`, `requests.get`, `subprocess.run(['tasklist', ...])`, `socket.connect` 가 UI 슬롯 또는 `QTimer.timeout` 핸들러에서 직접 호출됨
- [ ] 폴링 주기가 짧음 (interval ≤ 300ms) 이고 매 tick 마다 동기 I/O 수행
- [ ] CPU 점유율은 낮은데 GUI 만 멈추는 패턴 (이벤트 루프 블로킹의 전형적 신호)

---

## 2. 진단 절차 (Senior Architect Mode)

### 2.1 Problem Definition (문제 정의)
- 증상을 사용자 표현 그대로 1~2 문장으로 적기. (예: "리스트 새로고침할 때 창이 깜빡인다")
- 재현 시나리오: 어떤 액션 → 몇 초 후 → 어떤 화면 변화.
- 영향 범위: 어떤 윈도우, 어떤 위젯, 모든 OS 인지 특정 OS 인지.

### 2.2 Direct Cause (직접 원인)
- 스택 추적 또는 `cProfile` / `QElapsedTimer` 로 **UI 스레드에서 ≥ 50ms 점유하는 콜** 식별.
- 후보: `urlopen`, `requests.*`, `subprocess.run`, `socket.*`, 파일 시스템 스캔, 큰 JSON 파싱, `time.sleep`.
- "이 한 줄이 메인 스레드에서 실행되는가?" 를 질문해 답이 YES 면 직접 원인.

### 2.3 Structural Cause (구조 원인)
- 왜 그 호출이 UI 스레드에 있는가? 폴링 루프? 슬롯-함수 직접 결합? 콜백을 invokeMethod 로 마샬링하는 표준이 없어서?
- 동일 패턴이 다른 슬롯에도 존재하는지 grep 으로 확인 (섹션 5 참고).

### 2.4 Mandatory Checks (필수 점검 항목)
- [ ] 모든 외부 I/O 호출이 워커 스레드 또는 비동기 진입점을 거치는가
- [ ] `_async_check` 진입점이 단일 (canonical) 인가 — 사본/변종이 없는가
- [ ] 워커에서 발생한 예외가 silently 삼켜지지 않는가 (`failed` 시그널 또는 로그)
- [ ] 폴링 주기가 적절한가 (250ms 미만은 거의 항상 과도함; 600~1000ms 권장)
- [ ] 같은 위젯에 대해 중복 폴링 타이머가 떠 있지 않은가
- [ ] 윈도우 close 시 모든 워커/타이머가 정리되는가 (메모리·핸들 누수 방지)

---

## 3. 패치 템플릿

아래 코드를 그대로 복사하여 대상 파일 상단(혹은 `app/util/async_probe.py` 같은 별도 모듈)에 배치합니다.
PyQt5 import 줄만 PyQt6 / PySide6 로 바꾸면 동일하게 동작합니다.

```python
# --- UI 스레드 격리 워커 (canonical) ---------------------------------
# PyQt5 / PyQt6 / PySide2 / PySide6 동일 패턴.
# UI 스레드에서 동기 I/O (urlopen, subprocess.run, requests.get, time.sleep) 를
# 직접 호출하지 않기 위한 단일 진입점.

from PyQt5.QtCore import QObject, QRunnable, QThreadPool, pyqtSignal, pyqtSlot
# PyQt6:    from PyQt6.QtCore  import QObject, QRunnable, QThreadPool, pyqtSignal, pyqtSlot
# PySide6:  from PySide6.QtCore import QObject, QRunnable, QThreadPool, Signal as pyqtSignal, Slot as pyqtSlot


class _ProbeSignals(QObject):
    done = pyqtSignal(object)    # 성공 결과
    failed = pyqtSignal(object)  # 예외 객체


class _AsyncProbe(QRunnable):
    """
    UI 스레드에서 절대 동기 I/O 를 호출하지 않게 하는 워커.
    fn 은 인자 없는 callable. on_done / on_error 는 메인 스레드에서 호출됨.
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
        except Exception as exc:
            self.signals.failed.emit(exc)
            return
        self.signals.done.emit(result)


def _async_check(fn, on_done, on_error=None):
    """
    UI 슬롯에서 호출하는 표준 진입점.
    예) self._async_check(lambda: urllib.request.urlopen(url, timeout=2).status,
                           on_done=self._on_url_ready,
                           on_error=self._on_url_failed)
    """
    probe = _AsyncProbe(fn)
    probe.signals.done.connect(on_done)
    if on_error is not None:
        probe.signals.failed.connect(on_error)
    QThreadPool.globalInstance().start(probe)
# --- end async probe -------------------------------------------------
```

### 3.1 호출부 마이그레이션 예시

Before (UI 스레드 블로킹):

```python
def _url_ready(self, url: str) -> bool:
    try:
        return urllib.request.urlopen(url, timeout=2).status == 200
    except Exception:
        return False

def refresh_status(self):
    if self._url_ready(self.api_url):     # <-- 메인 스레드 블로킹
        self.label.setText("OK")
```

After (`_async_check` 사용):

```python
def refresh_status(self):
    self._async_check(
        lambda: urllib.request.urlopen(self.api_url, timeout=2).status == 200,
        on_done=self._on_url_ready,
        on_error=lambda exc: self._on_url_ready(False),
    )

def _on_url_ready(self, ok: bool):
    self.label.setText("OK" if ok else "DOWN")
```

### 3.2 폴링 주기 조정
- `_poll_until` / `QTimer.start(...)` 인터벌을 250ms → **600ms 이상**으로 상향.
- "체감 즉시성"은 첫 tick 의 즉시 실행으로 확보 (`QTimer.singleShot(0, callback)`).

---

## 4. 검증 절차

### 4.1 pytest 템플릿 (`tests/test_async_probe.py`)

```python
import time
import pytest
from PyQt5.QtCore import QCoreApplication
from PyQt5.QtTest import QSignalSpy

from app.util.async_probe import _AsyncProbe, _async_check  # 실제 위치로 변경

@pytest.fixture(scope="module")
def qapp():
    app = QCoreApplication.instance() or QCoreApplication([])
    yield app


def test_async_probe_done(qapp):
    probe = _AsyncProbe(lambda: 42)
    spy = QSignalSpy(probe.signals.done)
    probe.run()
    assert spy.count() == 1
    assert spy[0][0] == 42


def test_async_probe_failed(qapp):
    def boom():
        raise RuntimeError("nope")
    probe = _AsyncProbe(boom)
    spy = QSignalSpy(probe.signals.failed)
    probe.run()
    assert spy.count() == 1
    assert isinstance(spy[0][0], RuntimeError)


def test_async_check_callbacks(qapp):
    results = []
    _async_check(lambda: "ok", on_done=results.append)
    deadline = time.time() + 2.0
    while not results and time.time() < deadline:
        qapp.processEvents()
        time.sleep(0.01)
    assert results == ["ok"]
```

### 4.2 syntax / import 체크 명령

```bash
# 구문 검사
python -m py_compile unified_launcher_window.py

# 임포트 검사 (사이드이펙트 없이)
python -c "import importlib, sys; importlib.import_module('unified_launcher_window')"

# 테스트 실행
pytest tests/test_async_probe.py -v
```

### 4.3 수동 검증
- 앱 실행 → 평소 깜빡이던 액션 반복 5회 → 깜빡임/멈춤 사라졌는지 육안 확인.
- 네트워크가 느린 환경 (예: `tc qdisc add dev ... delay 2000ms` / 핫스팟 끊기) 에서도 UI 가 응답하는지.

---

## 5. 횡단 감사 grep 패턴

다른 파일/프로젝트에 같은 안티패턴이 있는지 스캔:

```bash
# UI 슬롯에서 호출되면 위험한 동기 I/O
rg -n "urllib\.request\.urlopen"        --type py
rg -n "subprocess\.run.*tasklist"       --type py
rg -n "subprocess\.(run|check_output|call)\(" --type py
rg -n "requests\.(get|post|put|delete|head)\(" --type py
rg -n "\btime\.sleep\("                 --type py
rg -n "socket\.(connect|create_connection)\(" --type py

# QTimer 짧은 인터벌 (잠재적 폴링 폭주)
rg -n "QTimer.*start\(\s*([0-9]{1,3})\s*\)" --type py

# 이미 _async_check 가 도입된 파일 (중복/변종 방지)
rg -n "_async_check\(|_AsyncProbe\(" --type py
```

발견 시 처리 원칙:
1. 호출 위치가 UI 슬롯/타이머 콜백/페인트 이벤트 안인지 확인.
2. 그렇다면 `_async_check` 로 마이그레이션 (`_async_check` 모듈이 없으면 섹션 3 의 캐노니컬 코드 복사).
3. ARCHITECTURE.md 체크리스트에 신규 케이스 추가.

---

## 6. 다음 단계 (P1 / P2 / P3 후속 작업 템플릿)

수정 직후 GitHub Issue / TODO 로 등록할 항목 템플릿. 각 항목 앞의 `- [ ]` 를 그대로 복사 사용.

### P1 — 즉시 (당일/다음 PR)
- [ ] `_AsyncProbe` / `_async_check` 를 단일 모듈(`app/util/async_probe.py`)로 추출하고 `from ... import _async_check` 로 통일
- [ ] `tests/test_async_probe.py` 추가 및 CI 에 포함
- [ ] `ARCHITECTURE.md` 에 "UI 스레드 격리 규칙" 섹션 + 코드 리뷰 체크리스트 추가
- [ ] `_poll_until` 인터벌 600ms 이상으로 변경

### P2 — 이번 스프린트
- [ ] 횡단 감사 (섹션 5 grep) 결과 발견된 모든 호출부 마이그레이션
- [ ] 워커 예외 로깅 표준화: `logging.getLogger("async_probe").exception(...)`
- [ ] 윈도우 close 시 미완료 워커 cancel/대기 정책 명문화
- [ ] 비동기화한 호출에 timeout 명시 (urlopen/requests 모두 `timeout=` 필수)

### P3 — 백로그 / 리팩터
- [ ] 공통 베이스 위젯 (`AsyncAwareWindow`) 도입 — `_async_check` / 워커 정리 / 에러 토스트 통합
- [ ] 장시간 작업용 `QThread + Worker` 레인 분리 (현재 `_AsyncProbe` 는 짧은 probe 용)
- [ ] pre-commit 훅: 섹션 5 의 grep 패턴이 새로 추가된 PR diff 에 등장하면 경고
- [ ] `pytest-qt` 도입 여부 검토 (현재는 `QSignalSpy` + `processEvents` 로 충분)

---

(이 워크플로우는 `debugging-history.md` 의 항목과 함께 갱신하세요. 동일 증상이 다시 보고되면 본 문서를 먼저 참조한 뒤 진단 → 패치 → 검증 → 문서화 순서를 그대로 적용합니다.)
