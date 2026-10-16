@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
cd /d "%~dp0..\src-tauri\virtual-camera"
cl /nologo /O2 /MT /EHsc /std:c++17 /DUNICODE /D_UNICODE /DWINAPI_PARTITION_SYSTEM=1 tools\CameraTool.cpp /Fobuild\ /Febuild\FreeShowCameraTool.exe /link ole32.lib mf.lib mfplat.lib mfuuid.lib mfreadwrite.lib mfsensorgroup.lib
