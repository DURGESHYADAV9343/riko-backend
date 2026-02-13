@echo off
title JARVIS AI Assistant - Setup
color 0B
echo.
echo  ============================================
echo    JARVIS AI ASSISTANT - Auto Setup
echo    Hindi Speaking ^| VRM Avatar ^| Memory
echo  ============================================
echo.

cd /d "%~dp0"

REM Check Python
echo [1/4] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    py --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Python not found! Install Python 3.10+ first.
        pause
        exit /b 1
    )
)
echo       Python found!

REM Create venv if not exists
if not exist "venv" (
    echo [2/4] Creating virtual environment...
    python -m venv venv
)
echo       Virtual environment ready!

REM Install dependencies
echo [3/4] Installing dependencies...
call venv\Scripts\activate.bat
pip install -r requirements.txt --quiet
echo       Dependencies installed!

REM Create models directory
echo [4/4] Setting up files...
if not exist "public\models" mkdir public\models

REM Create .env if not exists
if not exist ".env" (
    copy .env.example .env >nul
    echo       Created .env file
)

echo.
echo  ============================================
echo    Setup Complete! Starting Jarvis...
echo  ============================================
echo.
echo    Open: http://localhost:8000
echo.

REM Start server
call venv\Scripts\activate.bat
python server.py

pause
