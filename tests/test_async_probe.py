"""
test_async_probe.py
====================
Tests for the P0 patch (2026-05-05) applied to ``unified_launcher_window.py``.

The patch introduced two helpers near the top of the module:

  * ``_AsyncProbeSignals(QObject)`` — a Signal container exposing
    ``result = Signal(bool)``.
  * ``_AsyncProbe(QRunnable)``     — runs a synchronous callable ``fn`` on a
    QThreadPool worker thread and emits the boolean result via
    ``signals.result``. Exceptions raised inside ``fn`` MUST be swallowed and
    reported as ``False`` (no propagation to the worker / main thread).

This module covers the worker contract only; it does not require a real
network, GUI, or LauncherWindow instance. ``fn`` is mocked directly.

Cases covered
-------------
A. ``_AsyncProbe.run()`` invokes ``fn`` and emits ``True`` for a truthy result.
B. ``_AsyncProbe.run()`` emits ``False`` when ``fn`` raises (no propagation).
C. ``_AsyncProbe.run()`` emits ``False`` when ``fn`` returns a falsy value.
D. The signal payload is always ``bool`` (the worker casts via ``bool(...)``).

The tests use ``QSignalSpy`` from ``PySide6.QtTest`` to assert emissions.
We invoke ``run()`` synchronously on the calling thread (rather than going
through ``QThreadPool.start()``) to make the assertions deterministic — the
worker contract under test is strictly inside ``_AsyncProbe.run``.
"""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

import pytest

# Make the project root importable so we can `import unified_launcher_window`.
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# Skip the whole module gracefully if PySide6 isn't installed in this env.
PySide6 = pytest.importorskip("PySide6")
from PySide6.QtTest import QSignalSpy  # noqa: E402

from unified_launcher_window import _AsyncProbe, _AsyncProbeSignals  # noqa: E402


def spy_len(spy: QSignalSpy) -> int:
    return spy.count() if hasattr(spy, "count") else len(spy)


def spy_payload(spy: QSignalSpy, index: int = 0):
    row = spy.at(index) if hasattr(spy, "at") else spy[index]
    return row[0]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def probe_factory(qapp):
    """Return a factory that builds an ``_AsyncProbe`` plus a connected spy.

    Using ``qapp`` ensures a QCoreApplication exists (required for QObject
    signal/slot machinery, even when we invoke ``run`` synchronously).
    """

    def _make(fn):
        probe = _AsyncProbe(fn)
        spy = QSignalSpy(probe.signals.result)
        return probe, spy

    return _make


# ---------------------------------------------------------------------------
# Sanity: signals container surface
# ---------------------------------------------------------------------------


def test_signals_container_is_qobject(qapp):
    """``_AsyncProbeSignals`` must be a QObject exposing a ``result`` signal."""
    sig = _AsyncProbeSignals()
    # The result attribute must be a bound Signal, callable to emit.
    assert hasattr(sig, "result"), "result signal missing on _AsyncProbeSignals"
    # Connecting a no-op slot must not raise — confirms it is a real Qt Signal.
    sig.result.connect(lambda _ok: None)


# ---------------------------------------------------------------------------
# (A) truthy result -> True emitted
# ---------------------------------------------------------------------------


def test_run_emits_true_when_fn_returns_truthy(probe_factory):
    fn = MagicMock(return_value=True)
    probe, spy = probe_factory(fn)

    probe.run()

    fn.assert_called_once_with()
    assert spy_len(spy) == 1, "result signal should have been emitted exactly once"
    payload = spy_payload(spy)
    assert payload is True


def test_run_emits_true_for_other_truthy_values(probe_factory):
    """Non-bool truthy values (e.g. a non-empty string) still emit True."""
    fn = MagicMock(return_value="ok")
    probe, spy = probe_factory(fn)

    probe.run()

    assert spy_len(spy) == 1
    assert spy_payload(spy) is True


# ---------------------------------------------------------------------------
# (B) exception -> False, no propagation
# ---------------------------------------------------------------------------


def test_run_emits_false_when_fn_raises(probe_factory):
    fn = MagicMock(side_effect=RuntimeError("boom"))
    probe, spy = probe_factory(fn)

    # Must NOT propagate the exception out of run().
    probe.run()

    fn.assert_called_once_with()
    assert spy_len(spy) == 1
    assert spy_payload(spy) is False


def test_run_swallows_base_exception_subclasses(probe_factory):
    """Common I/O errors (urllib / subprocess) must be reduced to False."""
    fn = MagicMock(side_effect=OSError("network unreachable"))
    probe, spy = probe_factory(fn)

    probe.run()  # must not raise

    assert spy_len(spy) == 1
    assert spy_payload(spy) is False


# ---------------------------------------------------------------------------
# (C) falsy result -> False
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("falsy_value", [False, 0, "", None, [], {}])
def test_run_emits_false_when_fn_returns_falsy(probe_factory, falsy_value):
    fn = MagicMock(return_value=falsy_value)
    probe, spy = probe_factory(fn)

    probe.run()

    assert spy_len(spy) == 1
    assert spy_payload(spy) is False


# ---------------------------------------------------------------------------
# (D) payload type is bool (cast via bool(...))
# ---------------------------------------------------------------------------


def test_payload_is_strict_bool_for_truthy(probe_factory):
    """Even when fn returns a truthy non-bool, payload must be a real bool."""
    fn = MagicMock(return_value=42)  # truthy int, not a bool
    probe, spy = probe_factory(fn)

    probe.run()

    assert spy_len(spy) == 1
    payload = spy_payload(spy)
    assert isinstance(payload, bool), f"expected bool, got {type(payload).__name__}"
    assert payload is True


def test_payload_is_strict_bool_for_falsy(probe_factory):
    fn = MagicMock(return_value=0)  # falsy int, not a bool
    probe, spy = probe_factory(fn)

    probe.run()

    assert spy_len(spy) == 1
    payload = spy_payload(spy)
    assert isinstance(payload, bool), f"expected bool, got {type(payload).__name__}"
    assert payload is False


def test_payload_is_strict_bool_when_exception(probe_factory):
    fn = MagicMock(side_effect=ValueError("bad"))
    probe, spy = probe_factory(fn)

    probe.run()

    assert spy_len(spy) == 1
    payload = spy_payload(spy)
    assert isinstance(payload, bool)
    assert payload is False
