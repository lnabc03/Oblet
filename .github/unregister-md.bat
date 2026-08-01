@echo off
rem Oblet — 卸载 .md 文件关联（撤销 register-md.bat 的全部改动）

setlocal

reg delete "HKCU\Software\Classes\Oblet.md" /f >nul 2>&1
reg delete "HKCU\Software\Classes\.md\OpenWithProgids" /v "Oblet.md" /f >nul 2>&1
reg delete "HKCU\Software\Oblet" /f >nul 2>&1
reg delete "HKCU\Software\RegisteredApplications" /v "Oblet" /f >nul 2>&1

echo.
echo [完成] Oblet 的 .md 文件关联已移除。
echo 若此前已将 Oblet 设为默认应用，请在其他编辑器上重新选择默认打开方式。
echo.
pause
