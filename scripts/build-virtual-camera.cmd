@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
cd /d "%~dp0..\src-tauri\virtual-camera"
if not exist build mkdir build
cl /nologo /LD /O2 /MT /EHsc /std:c++17 /DUNICODE /D_UNICODE /DWINAPI_PARTITION_SYSTEM=1 /Ideps\wil\include *.cpp /Fobuild\ /link /DEF:VirtualCameraMediaSource.def /OUT:build\FreeShowVirtualCamera.dll ole32.lib advapi32.lib propsys.lib cfgmgr32.lib
if errorlevel 1 exit /b %errorlevel%
cl /nologo /O2 /MT /EHsc /std:c++17 /DUNICODE /D_UNICODE /DWINAPI_PARTITION_SYSTEM=1 tools\CameraTool.cpp /Fobuild\ /Febuild\FreeShowCameraTool.exe /link ole32.lib mf.lib mfplat.lib mfuuid.lib mfreadwrite.lib mfsensorgroup.lib
if errorlevel 1 exit /b %errorlevel%
cl /nologo /O2 /MT /EHsc /std:c++17 tools\TransportTest.cpp /Fobuild\ /Febuild\TransportTest.exe
exit /b %errorlevel%
