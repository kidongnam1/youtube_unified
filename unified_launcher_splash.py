"""로딩 전용 — 최소 위젯만 import (메인 UI 모듈보다 먼저 표시하기 위함)."""

from __future__ import annotations

from PySide6.QtCore import QTimer, Qt
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import QDialog, QLabel, QProgressBar, QVBoxLayout


class LoadingDialog(QDialog):
    """검은 빈 화면 대신 짧게 보이는 테마색 로딩 화면."""

    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("loadingDialog")
        self.setWindowTitle("YouTube Unified")
        self.setModal(True)
        self.setFixedSize(480, 188)
        self.setWindowFlags(
            Qt.WindowType.Dialog
            | Qt.WindowType.FramelessWindowHint
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, False)

        title = QLabel("YouTube Unified")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet("font-size: 24px; font-weight: 900; color: #ffffff;")

        hint = QLabel("불러오는 중... 잠시만 기다려 주세요.")
        hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hint.setStyleSheet("font-size: 17px; font-weight: 600; color: #ffffff;")

        bar = QProgressBar()
        bar.setRange(0, 0)
        bar.setTextVisible(True)
        bar.setFormat("준비 중")
        bar.setStyleSheet(
            """
            QProgressBar {
                border: 1px solid #881337;
                border-radius: 8px;
                background: #120a10;
                height: 26px;
                text-align: center;
                color: #ffffff;
                font-size: 15px;
                font-weight: 700;
            }
            QProgressBar::chunk {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #fb7185, stop:1 #be123c);
                border-radius: 6px;
            }
            """
        )

        lay = QVBoxLayout(self)
        lay.setContentsMargins(28, 26, 28, 26)
        lay.setSpacing(14)
        lay.addWidget(title)
        lay.addWidget(bar)
        lay.addWidget(hint)

        self._hint = hint
        self._bar = bar
        self._base_message = "불러오는 중"
        self._dot_step = 0
        self._anim_timer = QTimer(self)
        self._anim_timer.timeout.connect(self._tick_loading_text)
        # 과도한 재페인트로 인한 깜빡임을 줄이기 위해 갱신 주기를 완만하게 유지
        self._anim_timer.start(600)
        self.unsetCursor()

        self.setStyleSheet(
            """
            QDialog#loadingDialog {
                background: #0c1526;
                border: 1px solid #be123c;
                border-radius: 14px;
            }
            """
        )

    def showEvent(self, event) -> None:
        super().showEvent(event)
        screen = QGuiApplication.primaryScreen()
        if screen is None:
            return
        fg = screen.availableGeometry()
        g = self.frameGeometry()
        g.moveCenter(fg.center())
        self.move(g.topLeft())

    def closeEvent(self, event) -> None:
        self._anim_timer.stop()
        super().closeEvent(event)

    def set_message(self, message: str) -> None:
        self._base_message = message.strip() or "불러오는 중"
        self._tick_loading_text()

    def _tick_loading_text(self) -> None:
        dots = "." * (self._dot_step % 4)
        self._dot_step += 1
        self._bar.setFormat(f"{self._base_message}{dots}")
        self._hint.setText(f"{self._base_message}{dots}  잠시만 기다려 주세요.")
