Video Automation Run Package — README
=====================================

Execution
---------
Recommended:
  python .\run.py

Requirements
------------
- Python 3.x
- FFmpeg on PATH
- pip install -r requirements.txt
  (or: pip install PySide6 opencv-python numpy openai-whisper yt-dlp)

Main entry
----------
- run.py — single-file desktop app (PySide6): local video OR YouTube URL workflow,
  Whisper subtitles, Smart Frame Search, One-Click Process.
- Video source: use Browse, or type/paste a local file path, or paste a YouTube URL
  in the same field (Enter checks URL metadata or applies local path).

Included references (optional)
------------------------------
- app_p2.py / app_p1.py — archived copies when present.

Automation scripts (project root)
---------------------------------
- python scripts\backup_run.py --phase <NAME>
- python scripts\verify_imports.py
- python scripts\phase_gate.py --phase <PHASE>
- python scripts\generate_acceptance_bundle.py  (phase PASS reports bundle)
- python scripts\final_acceptance_gate.py       (14-condition final check)
- python scripts\smoke_launch.py                (GUI 5s smoke; needs display)

Static snapshots (S1–S5)
------------------------
After selecting a video (or completing Generate), use "Run Static Snapshot".
Outputs go to <project_root>\static_snapshots\run_<timestamp>\
(full JPG, body crop JPG, static_index.json). "Open Snapshots Folder" opens
that parent folder when it exists.

Reports
-------
- reports\phase_reports\ — phase markdown reports
- reports\final\FINAL_ACCEPTANCE_REPORT.md — gate summary when PASS

Workspace (master prompt)
-------------------------
See prompts\GPT_00_CURSOR_MASTER_PROMPT_YOUTUBE_MOVIE.md for full phase order.
