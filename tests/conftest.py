"""
conftest.py
============
Shared pytest fixtures for the youtube_unified test suite.

Ensures a single QCoreApplication exists for the whole test session so that
QThreadPool / QObject / Signal-based tests (e.g. test_async_probe.py) can
run headlessly without spinning up a full GUI.
"""
from __future__ import annotations

import sys

import pytest


@pytest.fixture(scope="session")
def qapp():
    """Provide a process-wide QCoreApplication for Qt-based tests.

    A QCoreApplication (or QApplication) is required for QObject signal
    delivery and for QThreadPool workers to post results back to the main
    thread. We reuse a single instance across the session because Qt does
    not allow more than one QCoreApplication per process.
    """
    # Import lazily so tests that don't need Qt can still be collected
    # if PySide6 is missing (they will be skipped at use time).
    from PySide6.QtCore import QCoreApplication

    app = QCoreApplication.instance()
    if app is None:
        app = QCoreApplication(sys.argv or ["pytest"])
    yield app
    # Do not call app.quit() here: Qt singletons live until interpreter exit.
