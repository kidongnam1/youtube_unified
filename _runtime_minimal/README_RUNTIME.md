# YouTube Unified Minimal Runtime

This folder contains only the files needed to run the current launcher and its bundled local apps.

Run:

```powershell
.\RUN_MENU.ps1
```

Or double-click:

```text
RUN_MENU.bat
```

Included:

- `YouTube_Unified_Launcher.py`, `unified_launcher_window.py`
- `backend/`
- `desktop_app/run.py`
- `web_content_app_plain/`
- `tools/u_scrp.py`
- launcher scripts and requirements files

Excluded:

- `node_modules/`
- tests, Playwright artifacts, reports, docs, logs, caches
- backup files and old launcher copies

Note: `backend/.env` was copied because the backend loads environment variables from it.
