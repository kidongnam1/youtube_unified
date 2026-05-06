"""YouTube Unified 런처 진입점."""

from __future__ import annotations

import atexit
import os
from pathlib import Path
import sys
import traceback

ROOT = Path(__file__).resolve().parent
LOCK_FILE = ROOT / ".launcher.lock"
CRASH_LOG = ROOT / "launcher_crash.log"


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _acquire_single_instance_lock() -> bool:
    if LOCK_FILE.exists():
        try:
            old_pid = int(LOCK_FILE.read_text(encoding="ascii").strip())
            if _pid_alive(old_pid):
                return False
        except Exception:
            pass
    LOCK_FILE.write_text(str(os.getpid()), encoding="ascii")
    atexit.register(lambda: LOCK_FILE.unlink(missing_ok=True))
    return True


def _write_crash_log(exc: BaseException) -> None:
    try:
        _append_runtime_log("FATAL", "런처 예외 발생")
        with CRASH_LOG.open("a", encoding="utf-8") as f:
            f.write("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
            f.write("\n")
    except Exception:
        pass


def _append_runtime_log(level: str, message: str) -> None:
    ts = "unknown-time"
    try:
        from datetime import datetime

        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        ts = "unknown-time"
    try:
        with CRASH_LOG.open("a", encoding="utf-8") as f:
            f.write(f"[{ts}] [{level}] {message}\n")
    except Exception:
        pass


def main() -> int:
    from PySide6.QtCore import Qt
    from PySide6.QtWidgets import QApplication, QMessageBox

    _append_runtime_log("INFO", f"런처 시작 요청 pid={os.getpid()}")
    if not _acquire_single_instance_lock():
        _append_runtime_log("WARN", "중복 실행 차단: 이미 실행 중인 인스턴스가 있음")
        return 0

    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )
    app = QApplication(sys.argv)
    app.setStyle("Fusion")

    try:
        from unified_launcher_window import LauncherWindow

        window = LauncherWindow()

        _append_runtime_log("INFO", "메인 윈도우 생성 완료")
        window.show()
        app.processEvents()
        code = app.exec()
        _append_runtime_log("INFO", f"런처 정상 종료 code={code}")
        return code
    except Exception as exc:
        _write_crash_log(exc)
        QMessageBox.critical(
            None,
            "YouTube Unified",
            "런처가 비정상 종료되었습니다.\n\n"
            f"오류 로그: {CRASH_LOG}",
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
