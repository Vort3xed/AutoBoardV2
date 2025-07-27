@echo off
echo autoboard
echo ============================================
echo.

REM lets check if python is available
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo using python to start server...
    echo Opening browser to http://localhost:8000
    echo.
    echo press Ctrl+C to stop the server when done.
    echo.
    start http://localhost:8000
    python -m http.server 8000
) else (
    echo python not found 🥀. please install python or use an alternative method:
    echo.
    echo 1. install python from https://python.org
    echo 2. use node.js: npm install -g http-server, then run: http-server -p 8000
    echo 3. use vscode live server extension
    echo 4. deploy to any web hosting service
    echo.
    echo the application requires httsps for camera/microphone access.
    echo.
    pause
)
