@echo off
cd /d "%~dp0"

start "clipdat backend" cmd /k "cd backend && venv\Scripts\activate && python main.py"
timeout /t 2 /nobreak >nul
start "clipdat frontend" cmd /k "cd frontend && npm run dev"