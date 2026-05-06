from __future__ import annotations

import html
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import QObject, QRunnable, Qt, QThreadPool, QTimer, Signal, Slot
from PySide6.QtGui import QColor, QPalette
from PySide6.QtWidgets import (
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QApplication,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

ROOT = Path(__file__).resolve().parent
DESKTOP_APP_DIR = ROOT / "desktop_app"
WEB_APP_DIR = ROOT / "web_content_app_plain"
TOOLS_DIR = ROOT / "tools"
VITE_PID_FILE = WEB_APP_DIR / "vite-dev.pid"
WEB_URL = "http://localhost:3000/"
DEBUG_LOG_FILE = ROOT / "launcher_crash.log"
CHILD_LOG_FILE = ROOT / "launcher_child.log"


def now_text() -> str:
    return datetime.now().strftime("%H:%M:%S")


# ===========================================================================
# [P0 PATCH 2026-05-05] UI 스레드 분리용 비동기 프로브 (깜빡임/멈춤 해결)
# ---------------------------------------------------------------------------
# 기존 문제:
#   * _url_ready() : urllib.urlopen 호출이 UI 스레드에서 최대 1.2초 블로킹
#   * _pid_alive() : subprocess.run("tasklist") 가 0.2~0.6초 블로킹
#   * _poll_until() 가 위 두 함수를 250ms 간격으로 반복 호출 -> "멈춤·재개" 반복
# 해결:
#   * QThreadPool 워커에서 실행 -> 결과는 Qt Signal 로 메인스레드 콜백
#   * polling interval_ms 기본값 250 -> 600 (UI 부하 추가 감소)
# ===========================================================================


class _AsyncProbeSignals(QObject):
    """QRunnable 에서 메인 스레드로 결과를 전달하는 Signal 컨테이너."""

    result = Signal(bool)


class _AsyncProbe(QRunnable):
    """동기 함수(fn)를 백그라운드 스레드에서 실행 후 결과를 시그널로 emit.
    UI 스레드 차단을 방지하기 위한 헬퍼.
    """

    def __init__(self, fn) -> None:
        super().__init__()
        self.fn = fn
        self.signals = _AsyncProbeSignals()

    @Slot()
    def run(self) -> None:
        try:
            ok = bool(self.fn())
        except Exception:
            # 워커 내부 예외는 False 로 환원 (메인 스레드에서 실패로 동등 처리).
            ok = False
        try:
            self.signals.result.emit(ok)
        except RuntimeError:
            # 창 종료 중 QObject가 먼저 정리된 경우. 종료 경로에서는 결과가 필요 없다.
            pass


class LauncherWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("YouTube Unified")
        self.setMinimumSize(980, 680)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setAutoFillBackground(True)
        pal = self.palette()
        pal.setColor(QPalette.ColorRole.Window, QColor("#0c1526"))
        self.setPalette(pal)

        self._processes: list[subprocess.Popen] = []
        self._spawn_meta: dict[int, dict] = {}
        self._child_log_streams = []
        self._busy_inline_label: QLabel | None = None
        self._busy_progress: QProgressBar | None = None
        self._last_web_status_text: str | None = None
        self._last_web_status_state: str | None = None
        self._action_buttons: list[QPushButton] = []
        self._action_active = False
        self._active_action_label: str | None = None
        self._active_probes: list[_AsyncProbe] = []
        self._busy_progress_value = 0
        # [P0 PATCH] UI 스레드 차단 방지용 워커 풀 (글로벌 풀 공유).
        self._pool = QThreadPool.globalInstance()
        # 이전 버전의 커서 복원 콜백이 남아 있어도 안전하게 무시하기 위한 토큰.
        self._cursor_revert_token: int = 0

        self.web_status = QLabel()
        self.web_status.setObjectName("pill")
        self.web_status.setText("확인 중")
        self.web_status.setProperty("state", "idle")
        self.web_status.setToolTip("웹 콘텐츠 서버 상태입니다. 실행 중이면 브라우저에서 localhost:3000 접속이 가능합니다.")
        self._last_web_status_text = "확인 중"
        self._last_web_status_state = "idle"

        self.desktop_status = QLabel("대기")
        self.desktop_status.setObjectName("pill")
        self.desktop_status.setToolTip("레거시 데스크톱 영상 자동화 앱 상태입니다.")

        self.log_view = QTextEdit()
        self.log_view.setReadOnly(True)
        self.log_view.setAcceptRichText(True)
        self.log_view.setObjectName("log")

        root_layout = QHBoxLayout()
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)
        root_layout.addWidget(self._sidebar())
        root_layout.addWidget(self._content(), stretch=1)

        container = QWidget()
        container.setLayout(root_layout)
        self.setCentralWidget(container)
        self._apply_theme()
        self.log("준비 완료 — 아래에서 시작할 작업을 고르세요.")
        self._append_debug("INFO", "LauncherWindow 초기화 완료")
        QTimer.singleShot(150, self.refresh_status)

        # 주기 갱신은 화면 깜빡임 이슈가 있는 환경에서 부담이 될 수 있어 기본 비활성.
        # 상태는 실행 액션 이후 즉시 refresh_status()로 갱신한다.
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh_status)

    def _append_debug(self, level: str, message: str) -> None:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            with DEBUG_LOG_FILE.open("a", encoding="utf-8") as f:
                f.write(f"[{ts}] [{level}] {message}\n")
        except Exception:
            pass

    def _open_child_log_stream(self):
        stream = CHILD_LOG_FILE.open("a", encoding="utf-8")
        self._child_log_streams.append(stream)
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        stream.write(f"\n[{ts}] ==== child process session ====\n")
        stream.flush()
        return stream

    def _set_action_buttons_enabled(self, enabled: bool) -> None:
        for button in self._action_buttons:
            button.setEnabled(enabled)

    def _force_arrow_cursor(self) -> None:
        try:
            while QApplication.overrideCursor() is not None:
                QApplication.restoreOverrideCursor()
            QApplication.setOverrideCursor(Qt.CursorShape.ArrowCursor)
            self.setCursor(Qt.CursorShape.ArrowCursor)
        except Exception:
            pass

    def _release_forced_cursor(self) -> None:
        try:
            while QApplication.overrideCursor() is not None:
                QApplication.restoreOverrideCursor()
            self.unsetCursor()
        except Exception:
            pass

    def _begin_action(self, label: str) -> bool:
        if self._action_active:
            running = self._active_action_label or "이전 작업"
            self.log(f"{running} 처리 중입니다. 완료 후 다시 눌러 주세요.", level="warn")
            return False
        self._action_active = True
        self._active_action_label = label
        self._busy_progress_value = 0
        self._set_action_buttons_enabled(False)
        self._force_arrow_cursor()
        return True

    def _end_action(self) -> None:
        self._action_active = False
        self._active_action_label = None
        self._set_action_buttons_enabled(True)
        self._release_forced_cursor()

    def _show_busy(self, message: str, progress: int | None = None) -> None:
        """[P1 PATCH 2026-05-06] 진행 상태를 인라인 라벨로 표시한다.
        작업 중에는 버튼 비활성 + 상태 라벨로 피드백을 주고, 마우스 커서는
        기본 커서로 유지한다. 긴 폴링 중 모래시계가 계속 보여 사용자가
        앱 멈춤으로 오해하는 문제를 피하기 위함이다.
        """
        if self._busy_inline_label is not None:
            self._busy_inline_label.setText(f"진행 상태: {message}")
            self._busy_inline_label.show()
        if self._busy_progress is not None:
            if progress is None:
                progress = min(92, self._busy_progress_value + 18)
            progress = max(self._busy_progress_value, progress)
            self._busy_progress_value = max(0, min(100, progress))
            self._busy_progress.setRange(0, 100)
            self._busy_progress.setValue(self._busy_progress_value)
            self._busy_progress.setFormat(f"{message}  %p%")
            self._busy_progress.show()
        self._force_arrow_cursor()
        # 이전 버전에서 예약된 커서 복원 콜백을 무효화.
        self._cursor_revert_token += 1

    def _auto_revert_cursor(self, token: int) -> None:
        """이전 버전에서 예약된 커서 복원 콜백이 들어와도 기본 커서를 유지한다."""
        if token == self._cursor_revert_token:
            self._force_arrow_cursor()

    def _hide_busy(self) -> None:
        """[P1 PATCH] 진행 라벨 숨김 + 커서 복원 + 토큰 무효화."""
        # 토큰을 무효화하여 진행 중인 _auto_revert_cursor 콜백을 무력화.
        self._cursor_revert_token += 1
        self._force_arrow_cursor()
        if self._busy_inline_label is not None:
            self._busy_inline_label.hide()
        if self._busy_progress is not None:
            self._busy_progress.setValue(100)
            self._busy_progress.hide()
        self._busy_progress_value = 0
        self._end_action()

    def _busy_for(self, message: str, hold_ms: int) -> None:
        self._show_busy(message)
        QTimer.singleShot(max(500, hold_ms), self._hide_busy)

    def _async_check(self, fn, on_done) -> None:
        """[P0 PATCH] 동기 fn 을 워커 풀에서 실행 후 결과를 메인 스레드 콜백으로 전달.
        _url_ready / _pid_alive 처럼 블로킹 I/O 가 있는 함수를 안전하게 호출하는
        단일 진입점이다.
        """
        probe = _AsyncProbe(fn)
        self._active_probes.append(probe)

        def finish(ok: bool, p=probe) -> None:
            try:
                on_done(ok)
            finally:
                try:
                    self._active_probes.remove(p)
                except ValueError:
                    pass

        probe.signals.result.connect(finish)
        self._pool.start(probe)

    def _poll_until(
        self,
        condition,
        on_ok,
        on_timeout,
        timeout_ms: int = 8000,
        interval_ms: int = 600,
    ) -> None:
        """[P0 PATCH] 폴링 시 condition 을 워커 풀에서 실행 -> UI 스레드 비차단.
        interval_ms 기본값 250 -> 600 으로 상향 (시각적 깜빡임 추가 감소).
        """
        elapsed = {"ms": 0}

        def tick() -> None:
            def handle(ok: bool) -> None:
                if ok:
                    on_ok()
                    return
                elapsed["ms"] += interval_ms
                if elapsed["ms"] >= timeout_ms:
                    on_timeout()
                    return
                QTimer.singleShot(interval_ms, tick)

            # 핵심: condition 을 UI 스레드가 아닌 워커 풀에서 실행한다.
            self._async_check(condition, handle)

        tick()

    def _sidebar(self) -> QWidget:
        sidebar = QFrame()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(250)

        title = QLabel("YouTube\nUnified")
        title.setObjectName("brand")
        caption = QLabel("영상 제작 흐름을 한 창에서 제어")
        caption.setObjectName("caption")
        caption.setWordWrap(True)

        tips = QLabel(
            "시작 방법\n"
            "① 작업 카드를 선택\n"
            "② 초록색 버튼 클릭\n"
            "③ 상단 상태 확인"
        )
        tips.setObjectName("sidebarTips")
        tips.setWordWrap(True)

        layout = QVBoxLayout()
        layout.setContentsMargins(24, 28, 24, 24)
        layout.setSpacing(14)
        layout.addWidget(title)
        layout.addWidget(caption)
        layout.addSpacing(10)
        layout.addWidget(tips)
        layout.addStretch(1)
        sidebar.setLayout(layout)
        return sidebar

    def _status_strip(self) -> QFrame:
        strip = QFrame()
        strip.setObjectName("statusStrip")
        web_lbl = QLabel("웹 콘텐츠 서버")
        web_lbl.setObjectName("mutedInline")
        desk_lbl = QLabel("영상 자동화 앱")
        desk_lbl.setObjectName("mutedInline")
        self._busy_inline_label = QLabel("진행 상태: 대기")
        self._busy_inline_label.setObjectName("busyInline")
        self._busy_inline_label.hide()
        self._busy_progress = QProgressBar()
        self._busy_progress.setObjectName("busyProgress")
        self._busy_progress.setRange(0, 100)
        self._busy_progress.setValue(0)
        self._busy_progress.setTextVisible(True)
        self._busy_progress.setFixedWidth(260)
        self._busy_progress.hide()

        row = QHBoxLayout()
        row.setContentsMargins(16, 12, 16, 12)
        row.setSpacing(12)
        row.addWidget(web_lbl)
        row.addWidget(self.web_status)
        row.addSpacing(20)
        row.addWidget(desk_lbl)
        row.addWidget(self.desktop_status)
        row.addSpacing(18)
        row.addWidget(self._busy_inline_label)
        row.addWidget(self._busy_progress)
        row.addStretch(1)
        strip.setLayout(row)
        return strip

    def _content(self) -> QWidget:
        content = QWidget()
        title = QLabel("무엇을 하시겠어요?")
        title.setObjectName("pageTitle")
        subtitle = QLabel("처음이시면 아래 세 가지 중 하나를 선택하세요.")
        subtitle.setObjectName("pageSubtitle")

        cards = QGridLayout()
        cards.setHorizontalSpacing(14)
        cards.setVerticalSpacing(14)
        cards.addWidget(
            self._action_card(
                "★ 통합 웹 앱 (추천)",
                "백엔드 + 웹 서버 + 브라우저 자동 실행",
                "통합 앱 실행하기",
                self.run_unified_web_app,
            ),
            0,
            0,
        )
        cards.addWidget(
            self._action_card(
                "① [레거시] 영상 만들기",
                "PySide6 데스크톱 앱",
                "데스크톱 앱 열기",
                self.run_desktop_app,
            ),
            0,
            1,
        )
        cards.addWidget(
            self._action_card(
                "② [레거시] 웹으로 편집",
                "정적 HTML 서버 방식",
                "기존 웹 열기",
                self.start_and_open_web_app,
            ),
            1,
            0,
        )
        cards.addWidget(
            self._action_card(
                "③ [레거시] 자막만 저장",
                "Tkinter 독립 도구",
                "자막 도구 열기",
                self.run_transcript_tool,
            ),
            1,
            1,
        )

        layout = QVBoxLayout()
        layout.setContentsMargins(28, 26, 28, 24)
        layout.setSpacing(14)
        layout.addWidget(title)
        layout.addWidget(subtitle)
        layout.addWidget(self._status_strip())
        layout.addLayout(cards, stretch=2)
        layout.addWidget(self.log_view, stretch=1)
        content.setLayout(layout)
        return content

    def _primary_button(self, text: str, handler) -> QPushButton:
        button = QPushButton(text)
        button.setObjectName("primaryButton")
        button.setCursor(Qt.CursorShape.ArrowCursor)
        def _wrapped_click() -> None:
            if not self._begin_action(text):
                return
            self._append_debug("ACTION", f"버튼 클릭: {text}")
            try:
                handler()
            except Exception as exc:
                self.log(f"작업 시작 중 오류: {exc}", level="error")
                self._append_debug("ERROR", f"{text} handler exception: {exc!r}")
                self._hide_busy()

        button.clicked.connect(_wrapped_click)
        self._action_buttons.append(button)
        tooltip_map = {
            "통합 앱 실행하기": "백엔드(8000) + 웹 서버(3000) 실행 후 브라우저를 자동으로 엽니다.",
            "데스크톱 앱 열기": "레거시 PySide6 영상 자동화 앱(run.py)을 실행합니다.",
            "기존 웹 열기": "정적 웹 서버를 시작/확인한 뒤 기본 브라우저로 엽니다.",
            "자막 도구 열기": "YouTube 자막 추출 Tkinter 도구(u_scrp.py)를 실행합니다.",
        }
        if text in tooltip_map:
            button.setToolTip(tooltip_map[text])
        return button

    def _action_card(self, title: str, description: str, button_text: str, handler) -> QFrame:
        card = QFrame()
        card.setObjectName("card")
        title_label = QLabel(title)
        title_label.setObjectName("cardTitle")
        desc_label = QLabel(description)
        desc_label.setObjectName("cardDesc")
        desc_label.setWordWrap(True)
        button = self._primary_button(button_text, handler)

        layout = QVBoxLayout()
        layout.setContentsMargins(20, 18, 20, 18)
        layout.setSpacing(12)
        layout.addWidget(title_label)
        layout.addWidget(desc_label)
        layout.addStretch(1)
        layout.addWidget(button)
        card.setLayout(layout)
        return card

    def log(self, message: str, level: str = "info") -> None:
        t = now_text()
        esc = html.escape(message)
        colors = {"info": "#ffffff", "ok": "#6ee7b7", "warn": "#fbbf24", "error": "#fda4af"}
        mc = colors.get(level, colors["info"])
        self.log_view.insertHtml(
            f'<p style="margin:7px 0;line-height:1.6;"><span style="color:#fff;font-weight:700;">[{t}]</span> '
            f'<span style="color:{mc};font-weight:600;">{esc}</span></p>'
        )
        sb = self.log_view.verticalScrollBar()
        sb.setValue(sb.maximum())
        self._append_debug(level.upper(), message)

    def refresh_status(self) -> None:
        """[P0 PATCH] 상태 체크(_web_ready, _pid_alive)를 워커 풀에서 비동기 실행.
        UI 스레드는 setText/style 업데이트만 수행하므로 깜빡임이 발생하지 않는다.
        """
        pid = self._read_pid()

        def apply_state(text: str, state: str) -> None:
            # 상태가 바뀔 때만 repaint 하여 주기적 깜빡임을 방지.
            if (
                text != self._last_web_status_text
                or state != self._last_web_status_state
            ):
                self.web_status.setText(text)
                self.web_status.setProperty("state", state)
                self.web_status.style().unpolish(self.web_status)
                self.web_status.style().polish(self.web_status)
                self._last_web_status_text = text
                self._last_web_status_state = state

        def on_pid_check(alive: bool) -> None:
            if alive:
                apply_state("시작 중", "idle")
            else:
                apply_state("대기", "idle")

        def on_web_check(web_ok: bool) -> None:
            if web_ok:
                apply_state("실행 중", "ok")
                return
            if pid is None:
                apply_state("대기", "idle")
                return
            # PID alive 체크도 비동기 (tasklist 호출 0.2~0.6초 블로킹 방지).
            self._async_check(lambda p=pid: self._pid_alive(p), on_pid_check)

        # HTTP 헬스체크를 워커 풀에서 실행 (UI 스레드 비차단).
        self._async_check(self._web_ready, on_web_check)

    def _read_pid(self) -> int | None:
        if not VITE_PID_FILE.exists():
            return None
        try:
            return int(VITE_PID_FILE.read_text(encoding="ascii").strip())
        except ValueError:
            return None

    def _pid_alive(self, pid: int) -> bool:
        if os.name == "nt":
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}"],
                check=False,
                capture_output=True,
                text=True,
            )
            return str(pid) in result.stdout
        return False

    def _web_ready(self) -> bool:
        return self._url_ready(WEB_URL, timeout=0.45)

    def _url_ready(self, url: str, timeout: float = 1.2) -> bool:
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                return 200 <= response.status < 400
        except Exception:
            return False

    def _start_background_process(self, args: list[str], cwd: Path, label: str) -> subprocess.Popen:
        # 백엔드/웹서버처럼 콘솔성 프로세스는 숨김 + 로그 리다이렉트로 실행
        child_log = self._open_child_log_stream()
        proc = subprocess.Popen(
            args,
            cwd=str(cwd),
            stdout=child_log,
            stderr=child_log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        self._processes.append(proc)
        self._spawn_meta[proc.pid] = {
            "label": label,
            "args": list(args),
            "cwd": str(cwd),
            "started_at": time.time(),
            "retried": False,
            "kind": "background",
        }
        self.log(f"{label} 실행됨. PID: {proc.pid}")
        self._append_debug("PROC", f"{label} 시작 pid={proc.pid} cmd={args}")
        QTimer.singleShot(
            2000,
            lambda p=proc, n=label: self._check_process_alive_after_start(p, n),
        )
        return proc

    def _start_gui_process(self, args: list[str], cwd: Path, label: str) -> subprocess.Popen:
        # GUI 앱은 CREATE_NO_WINDOW/stdio 리다이렉트를 쓰지 않아야 안정적인 경우가 있다.
        proc = subprocess.Popen(
            args,
            cwd=str(cwd),
            creationflags=0,
        )
        self._processes.append(proc)
        self._spawn_meta[proc.pid] = {
            "label": label,
            "args": list(args),
            "cwd": str(cwd),
            "started_at": time.time(),
            "retried": False,
            "kind": "gui",
        }
        self.log(f"{label} 실행됨. PID: {proc.pid}")
        self._append_debug("PROC", f"{label} 시작(pid={proc.pid}) GUI cmd={args}")
        QTimer.singleShot(
            3000,
            lambda p=proc, n=label: self._check_process_alive_after_start(p, n),
        )
        return proc

    def _check_process_alive_after_start(self, proc: subprocess.Popen, label: str) -> None:
        code = proc.poll()
        if code is not None:
            meta = self._spawn_meta.get(proc.pid, {})
            elapsed = time.time() - float(meta.get("started_at", time.time()))
            retried = bool(meta.get("retried", False))
            args = meta.get("args", [])
            cwd = Path(meta.get("cwd", str(ROOT)))

            # GUI 앱이 10초 이내 code=0으로 조기 종료하면 1회 자동 재시도.
            if (
                meta.get("kind") == "gui"
                and code == 0
                and elapsed < 10.0
                and not retried
                and args
            ):
                self._append_debug("WARN", f"{label} 조기 종료(code=0) → 1회 자동 재시도")
                self.log(f"{label}이(가) 빠르게 종료되어 자동 재시도합니다...", level="warn")
                retry_args = list(args)
                # pythonw 경로였다면 python 콘솔 인터프리터로 한 번 재시도
                if retry_args and str(retry_args[0]).lower().endswith("pythonw.exe"):
                    retry_args[0] = str(Path(retry_args[0]).with_name("python.exe"))
                new_proc = self._start_gui_process(retry_args, cwd, f"{label} (재시도)")
                self._spawn_meta[new_proc.pid]["retried"] = True
                return

            level = "error" if code != 0 else "warn"
            msg = (
                f"{label} 프로세스가 종료되었습니다. 종료코드={code}"
                if code == 0
                else f"{label} 프로세스가 비정상 종료되었습니다. 종료코드={code} (원인: launcher_child.log 확인)"
            )
            self.log(msg, level=level)
            self._append_debug(level.upper(), f"{label} 종료 code={code}, elapsed={elapsed:.1f}s")

    def run_unified_web_app(self) -> None:
        self._append_debug("FLOW", "통합 웹 앱 실행 시작")
        self._show_busy("백엔드/웹 서버 동시 시작 중...", 10)
        self.log("통합 웹 앱 시작 중...")
        backend_dir = ROOT / "backend"
        if not (backend_dir / "main.py").exists():
            self.log("오류: backend/main.py를 찾을 수 없습니다.", level="error")
            self._hide_busy()
            return

        ready = {"backend": False, "web": False, "opened": False, "failed": False}

        def maybe_open() -> None:
            if ready["failed"] or ready["opened"]:
                return
            if ready["backend"] and ready["web"]:
                ready["opened"] = True
                self._show_busy("브라우저 연결 중...", 90)
                self.open_web_app()
                self.log("통합 환경 준비 완료. 브라우저를 확인하세요.", level="ok")
                QTimer.singleShot(500, self._hide_busy)

        def mark_failed(message: str) -> None:
            if ready["failed"] or ready["opened"]:
                return
            ready["failed"] = True
            self.log(message, level="warn")
            self._hide_busy()

        def start_web_side() -> None:
            self._show_busy("웹 콘텐츠 서버 시작/확인 중...", 30)
            self._ensure_web_app_running(
                lambda: self._poll_until(
                    self._web_ready,
                    lambda: (ready.__setitem__("web", True), self._show_busy("웹 콘텐츠 서버 준비 완료", 65), maybe_open()),
                    lambda: mark_failed("웹 서버 준비가 지연되고 있습니다. 수동으로 열기를 시도하세요."),
                    timeout_ms=8000,
                    interval_ms=350,
                )
            )

        def start_backend() -> None:
            self._start_background_process(
                [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", "8000", "--host", "127.0.0.1"],
                ROOT,
                "통합 백엔드 서버",
            )
            self._poll_until(
                lambda: self._url_ready("http://127.0.0.1:8000/", timeout=0.45),
                lambda: (ready.__setitem__("backend", True), self._show_busy("백엔드 서버 준비 완료", 75), maybe_open()),
                lambda: mark_failed("백엔드 시작이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."),
                timeout_ms=8000,
                interval_ms=350,
            )

        def backend_checked(already_ready: bool) -> None:
            if already_ready:
                self.log("통합 백엔드 서버가 이미 실행 중입니다.")
                ready["backend"] = True
                self._show_busy("백엔드 서버 확인 완료", 45)
                maybe_open()
                return
            start_backend()

        start_web_side()
        self._async_check(
            lambda: self._url_ready("http://127.0.0.1:8000/", timeout=0.45),
            backend_checked,
        )

    def run_desktop_app(self) -> None:
        self._append_debug("FLOW", "레거시 데스크톱 앱 실행 시작")
        self._show_busy("데스크톱 앱 실행 중...", 20)
        self.desktop_status.setText("실행됨")
        self.desktop_status.setProperty("state", "ok")
        self.desktop_status.style().unpolish(self.desktop_status)
        self.desktop_status.style().polish(self.desktop_status)
        proc = self._start_gui_process([sys.executable, "run.py"], DESKTOP_APP_DIR, "영상 자동화 앱")
        self._poll_until(
            lambda: self._pid_alive(proc.pid),
            lambda: self._show_busy("데스크톱 앱 확인 완료", 95) or QTimer.singleShot(400, self._hide_busy),
            self._hide_busy,
            timeout_ms=5000,
            interval_ms=250,
        )

    def run_transcript_tool(self) -> None:
        self._append_debug("FLOW", "자막 도구 실행 시작")
        self._show_busy("자막 도구 실행 중...", 20)
        proc = self._start_gui_process([sys.executable, "u_scrp.py"], TOOLS_DIR, "자막 추출 도구")
        self._poll_until(
            lambda: self._pid_alive(proc.pid),
            lambda: self._show_busy("자막 도구 확인 완료", 95) or QTimer.singleShot(400, self._hide_busy),
            self._hide_busy,
            timeout_ms=5000,
            interval_ms=250,
        )

    def _start_web_server_process(self) -> None:
        proc = self._start_background_process(
            [sys.executable, "-m", "http.server", "3000", "--bind", "127.0.0.1"],
            WEB_APP_DIR,
            "웹 콘텐츠 서버",
        )
        VITE_PID_FILE.write_text(str(proc.pid), encoding="ascii")
        QTimer.singleShot(1200, self.refresh_status)

    def _ensure_web_app_running(self, on_checked) -> None:
        def start_new() -> None:
            self._start_web_server_process()
            on_checked()

        def after_pid_check(existing: int, alive: bool) -> None:
            if alive:
                self.log(f"웹 서버가 이미 실행 중입니다. PID: {existing}")
                self.refresh_status()
                on_checked()
                return
            start_new()

        def after_web_check(web_ok: bool) -> None:
            if web_ok:
                self.log("웹 앱이 이미 실행 중입니다.")
                self.refresh_status()
                on_checked()
                return
            existing = self._read_pid()
            if existing:
                self._async_check(
                    lambda p=existing: self._pid_alive(p),
                    lambda alive, p=existing: after_pid_check(p, alive),
                )
                return
            start_new()

        self._async_check(self._web_ready, after_web_check)

    def run_web_app(self) -> None:
        self._ensure_web_app_running(lambda: None)

    def start_and_open_web_app(self) -> None:
        self._append_debug("FLOW", "레거시 웹 앱 실행 시작")
        self._show_busy("로컬 웹 서버 시작/확인 중...", 20)

        def web_ready() -> None:
            self._show_busy("브라우저 연결 중...", 82)
            self.open_web_app()
            QTimer.singleShot(500, self._hide_busy)

        def web_timeout() -> None:
            self.log("웹 서버 준비가 지연되고 있습니다. 잠시 후 다시 시도해 주세요.", level="warn")
            self._hide_busy()

        self._ensure_web_app_running(
            lambda: self._poll_until(
                self._web_ready,
                web_ready,
                web_timeout,
                timeout_ms=9000,
                interval_ms=500,
            )
        )

    def open_web_app(self) -> None:
        try:
            if os.name == "nt":
                subprocess.Popen(
                    ["cmd", "/c", "start", "", WEB_URL],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
            else:
                webbrowser.open(WEB_URL)
        except Exception:
            webbrowser.open(WEB_URL)
        self.log(f"웹 앱 열기: {WEB_URL}")

    def closeEvent(self, event) -> None:
        self._append_debug("INFO", "LauncherWindow 종료")
        self._request_spawned_process_termination()
        for stream in self._child_log_streams:
            try:
                stream.close()
            except Exception:
                pass
        self._child_log_streams.clear()
        event.accept()
        super().closeEvent(event)

    def _request_spawned_process_termination(self) -> None:
        # 종료 버튼은 즉시 반응해야 한다. taskkill 완료를 UI 스레드에서 기다리지 않고
        # 백그라운드 프로세스로 요청만 보낸 뒤 창 닫힘을 계속 진행한다.
        live_pids: list[int] = []
        for proc in self._processes:
            try:
                if proc.poll() is not None:
                    continue
                live_pids.append(proc.pid)
                proc.terminate()
                if os.name == "nt":
                    subprocess.Popen(
                        ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        creationflags=subprocess.CREATE_NO_WINDOW,
                    )
            except Exception:
                pass
        if os.name == "nt" and live_pids:
            self._start_windows_cleanup_helper(live_pids)
        self._processes.clear()
        VITE_PID_FILE.unlink(missing_ok=True)
        self._append_debug("INFO", "하위 프로세스 종료 요청 완료")

    def _start_windows_cleanup_helper(self, pids: list[int]) -> None:
        helper = (
            "import subprocess, sys, time\n"
            "pids = [p for p in sys.argv[1:] if p.isdigit()]\n"
            "time.sleep(0.2)\n"
            "for pid in pids:\n"
            "    subprocess.run(['taskkill', '/PID', pid, '/T', '/F'], "
            "stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)\n"
        )
        try:
            subprocess.Popen(
                [sys.executable, "-c", helper, *[str(pid) for pid in pids]],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except Exception:
            pass

    def stop_web_server(self) -> None:
        pid = self._read_pid()
        if not pid:
            self.log("종료할 웹 서버 PID가 없습니다.", level="warn")
            self.refresh_status()
            return
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        VITE_PID_FILE.unlink(missing_ok=True)
        self.log(f"웹 서버 종료 요청 완료. PID: {pid}", level="warn")
        self.refresh_status()

    def _apply_theme(self) -> None:
        self.setStyleSheet(
            """
            QMainWindow, QWidget { background: #0F172A; color: #E5E7EB; font-family: "Segoe UI", "Malgun Gothic"; font-size: 15px; }
            QFrame#sidebar { background: #0B1220; border-right: 1px solid #334155; }
            QLabel#brand { color: #F59E0B; font-size: 32px; font-weight: 900; line-height: 1.05; }
            QLabel#caption { color: #94A3B8; font-size: 15px; }
            QLabel#sidebarTips { color: #E5E7EB; font-size: 14px; padding: 12px; background: #111827; border: 1px solid #F59E0B; border-radius: 10px; }
            QFrame#statusStrip { background: #111827; border: 1px solid #334155; border-radius: 12px; }
            QLabel#mutedInline { color: #94A3B8; font-size: 14px; font-weight: 700; }
            QLabel#busyInline {
                color: #93C5FD;
                background: #0B1B33;
                border: 1px solid #1D4ED8;
                border-radius: 999px;
                padding: 5px 12px;
                font-size: 13px;
                font-weight: 700;
            }
            QProgressBar#busyProgress {
                background: #0B1220;
                border: 1px solid #2563EB;
                border-radius: 7px;
                color: #DBEAFE;
                font-size: 12px;
                font-weight: 800;
                height: 18px;
                text-align: center;
            }
            QProgressBar#busyProgress::chunk {
                background: #3B82F6;
                border-radius: 6px;
                margin: 2px;
            }
            QLabel#pageTitle { color: #F8FAFC; font-size: 28px; font-weight: 900; }
            QLabel#pageSubtitle { color: #94A3B8; font-size: 16px; }
            QFrame#card { background: #111827; border: 1px solid #334155; border-radius: 14px; }
            QLabel#cardTitle { color: #F8FAFC; font-size: 18px; font-weight: 900; }
            QLabel#cardDesc { color: #94A3B8; font-size: 15px; }
            QLabel#pill { background: #1E293B; color: #E5E7EB; border: 1px solid #334155; border-radius: 999px; padding: 6px 12px; font-weight: 800; font-size: 13px; }
            QLabel#pill[state="ok"] { background: #064E3B; color: #D1FAE5; border: 1px solid #10B981; }
            QLabel#pill[state="idle"] { background: #1E293B; color: #94A3B8; border: 1px solid #334155; }
            QPushButton#primaryButton { background: #10B981; color: #0F172A; border: none; border-radius: 10px; padding: 11px 14px; font-weight: 800; font-size: 15px; }
            QPushButton#primaryButton:hover { background: #34D399; }
            QPushButton#primaryButton:disabled { background: #334155; color: #94A3B8; }
            QTextEdit#log { background: #0B1220; color: #E5E7EB; border: 1px solid #334155; border-radius: 12px; padding: 12px 14px; font-family: "Cascadia Code", "Consolas", monospace; font-size: 14px; }
            """
        )
