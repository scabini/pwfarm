@echo off
setlocal
set HERE=%~dp0
start "" "%HERE%.venv\Scripts\pythonw.exe" "%HERE%app.py"
endlocal
