@echo off
setlocal
cd /d "%~dp0"

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

set "TARGET_VBS=%PROJECT_DIR%\start_silent.vbs"
set "WORKING_DIR=%PROJECT_DIR%\server"
set "SHORTCUT_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AntigravityBrowserBridge.lnk"

echo [Antigravity] 正在设置浏览器桥接后台服务开机静默自启...

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%TARGET_VBS%'; $s.WorkingDirectory = '%WORKING_DIR%'; $s.Description = 'Antigravity Browser Bridge Service'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo.
    echo ========================================================
    echo  [成功] 已将浏览器桥接后台服务添加到 Windows 开机自启！
    echo  开机后服务将在后台静默常驻，无黑框弹出。
    echo ========================================================
) else (
    echo.
    echo [提示] 创建快捷方式失败，请手动将 start_silent.vbs 发送到启动目录。
)

echo.
pause
