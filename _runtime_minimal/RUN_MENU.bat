@echo off
setlocal
cd /d "%~dp0"
set "VBS=%~dp0RUN_MENU_HIDDEN.vbs"
wscript.exe "%VBS%"
:END
endlocal
