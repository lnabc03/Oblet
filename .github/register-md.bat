@echo off
rem Oblet — 注册 .md 文件关联（绿色版，免管理员，仅当前用户）
rem 双击运行一次即可。之后在 .md 文件上右键 → 打开方式 → 选择默认应用 → Oblet。
rem 本脚本自动定位同目录下的 oblet.exe，无需手动改路径；移动文件夹后重新运行一次即可。

setlocal
set "EXE=%~dp0oblet.exe"
set "ICO=%~dp0md.ico"
if not exist "%ICO%" set "ICO=%EXE%"

if not exist "%EXE%" (
    echo [错误] 未找到 %EXE%
    echo 请把本脚本放在 oblet.exe 同一目录下再运行。
    pause
    exit /b 1
)

rem 1. ProgID：Oblet 的 .md 文件类型
reg add "HKCU\Software\Classes\Oblet.md" /ve /d "Markdown 文件" /f >nul
reg add "HKCU\Software\Classes\Oblet.md\DefaultIcon" /ve /d "\"%ICO%\",0" /f >nul
reg add "HKCU\Software\Classes\Applications\oblet.exe\DefaultIcon" /ve /d "\"%ICO%\",0" /f >nul
reg add "HKCU\Software\Classes\Oblet.md\shell\open\command" /ve /d "\"%EXE%\" \"%%1\"" /f >nul

rem 2. .md 的打开方式列表中加入 Oblet.md
reg add "HKCU\Software\Classes\.md\OpenWithProgids" /v "Oblet.md" /t REG_NONE /f >nul

rem 3. 注册应用能力声明（让 Oblet 出现在「选择默认应用」列表中）
reg add "HKCU\Software\Oblet\Capabilities" /v "ApplicationName" /d "Oblet" /f >nul
reg add "HKCU\Software\Oblet\Capabilities" /v "ApplicationDescription" /d "Lightweight standalone Markdown editor" /f >nul
reg add "HKCU\Software\Oblet\Capabilities\FileAssociations" /v ".md" /d "Oblet.md" /f >nul
reg add "HKCU\Software\RegisteredApplications" /v "Oblet" /d "Software\Oblet\Capabilities" /f >nul

rem 4. 顶层右键菜单：文件夹空白处右键 →「新建 Markdown 文档」→ 启动 Oblet 命名并创建打开
reg add "HKCU\Software\Classes\Directory\Background\shell\Oblet.newmd" /ve /d "新建 Markdown 文档" /f >nul
reg add "HKCU\Software\Classes\Directory\Background\shell\Oblet.newmd" /v "Icon" /d "\"%ICO%\",0" /f >nul
reg add "HKCU\Software\Classes\Directory\Background\shell\Oblet.newmd\command" /ve /d "\"%EXE%\" --new \"%%V\"" /f >nul

echo.
echo [完成] Oblet 已注册到 .md 的打开方式列表与右键「新建」菜单。
echo 还差一步（Windows 规定默认应用必须由用户手动选择）：
echo   在任意 .md 文件上右键 → 打开方式 → 选择其他应用 → 选中 Oblet → 勾选「始终」。
echo.
echo 右键新建：文件夹空白处右键 →「新建 Markdown 文档」命名创建并打开。
echo.
pause
