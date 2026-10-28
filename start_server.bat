@echo off
title Browser Bridge
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\BrowserBridge.ps1" status
pause
