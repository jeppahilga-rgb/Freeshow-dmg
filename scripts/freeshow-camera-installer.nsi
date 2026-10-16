Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
Name "FreeShow+"
Icon "..\src-tauri\icons\icon.ico"
UninstallIcon "..\src-tauri\icons\icon.ico"
!ifndef FREESHOW_SETUP_FILENAME
!define FREESHOW_SETUP_FILENAME "FreeShow-Plus-Setup.exe"
!endif
OutFile "..\..\output\${FREESHOW_SETUP_FILENAME}"
InstallDir "$PROGRAMFILES64\FreeShow+"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "This build requires 64-bit Windows 11."
    Abort
  ${EndIf}
  SetRegView 64
  ReadRegStr $1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeShowTauriCamera" "InstallLocation"
  ${If} $1 != ""
    StrCpy $INSTDIR $1
  ${EndIf}
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  ${If} $0 < 22000
    MessageBox MB_ICONSTOP "FreeShow Virtual Camera requires Windows 11."
    Abort
  ${EndIf}
FunctionEnd
Section "FreeShow+ and Virtual Camera"
  SetRegView 64
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "Preflight-FreeShow.ps1"
  check_running:
  nsExec::ExecToStack '$\"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe$\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $\"$PLUGINSDIR\Preflight-FreeShow.ps1$\" -InstallPath $\"$INSTDIR$\"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$1" IDRETRY check_running
    Abort
  ${EndIf}
  SetOutPath "$INSTDIR"
  File /oname=FreeShow.exe "..\..\output\FreeShow-Virtual-Camera\FreeShow-Tauri-Virtual-Camera.exe"
  File "..\..\output\FreeShow-Virtual-Camera\FreeShowPlus.ico"
  File "..\..\output\FreeShow-Virtual-Camera\FreeShowVirtualCamera.dll"
  File "..\..\output\FreeShow-Virtual-Camera\FreeShowCameraTool.exe"
  File "..\..\output\FreeShow-Virtual-Camera\Install-FreeShowCamera.ps1"
  File "..\..\output\FreeShow-Virtual-Camera\Uninstall-FreeShowCamera.ps1"
  File "..\..\output\FreeShow-Virtual-Camera\LICENSE-Microsoft.txt"
  File "..\..\output\FreeShow-Virtual-Camera\LICENSE-WIL.txt"
  File "..\..\output\FreeShow-Virtual-Camera\LICENSE-MediaMTX.txt"
  File "..\..\output\FreeShow-Virtual-Camera\LICENSE-FreeShow.txt"
  File "..\..\output\FreeShow-Virtual-Camera\MediaMTX-UPSTREAM.json"
  File "..\..\output\FreeShow-Virtual-Camera\README.txt"
  File "..\..\output\FreeShow-Virtual-Camera\APP-AUDIT-REPAIRS.md"
  File "..\..\output\FreeShow-Virtual-Camera\AUDIT-FIXES-2026-10-15.md"
  File "..\..\output\FreeShow-Virtual-Camera\EDITOR-DRAG-REPAIR.md"
  File "..\..\output\FreeShow-Virtual-Camera\LYRICS-SEARCH-REPAIR.md"
  File "..\..\output\FreeShow-Virtual-Camera\EDITOR-ZOOM-REPAIR.md"
  File "..\..\output\FreeShow-Virtual-Camera\LICENSE-DOMPurify.txt"
  File "..\..\output\FreeShow-Virtual-Camera\LICENSE-Svelte.txt"
  File "..\..\output\FreeShow-Virtual-Camera\BUNDLED-FONTS.md"
  File "..\..\output\FreeShow-Virtual-Camera\UPSTREAM-1.6.7-BETA-PORT.md"
  File "..\..\output\FreeShow-Virtual-Camera\WINDOWS-CAPTURE-QUALITY.md"
  File "..\..\output\FreeShow-Virtual-Camera\OUTPUT-ESCAPE-REPAIR.md"
  SetOutPath "$INSTDIR\runtime"
  File /r "..\..\output\FreeShow-Virtual-Camera\runtime\*.*"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeShowTauriCamera" "DisplayName" "FreeShow+"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeShowTauriCamera" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeShowTauriCamera" "DisplayIcon" "$INSTDIR\FreeShowPlus.ico"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeShowTauriCamera" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeShowTauriCamera" "DisplayVersion" "1.6.7-beta.1"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeShowTauriCamera" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeShowTauriCamera" "NoRepair" 1
  SetShellVarContext current
  Delete "$DESKTOP\FreeShow Tauri Preview.lnk"
  Delete "$SMPROGRAMS\FreeShow Tauri Preview\FreeShow.lnk"
  RMDir "$SMPROGRAMS\FreeShow Tauri Preview"
  CreateDirectory "$SMPROGRAMS\FreeShow+"
  CreateShortcut "$SMPROGRAMS\FreeShow+\FreeShow+.lnk" "$INSTDIR\FreeShow.exe" "" "$INSTDIR\FreeShowPlus.ico"
  CreateShortcut "$DESKTOP\FreeShow+.lnk" "$INSTDIR\FreeShow.exe" "" "$INSTDIR\FreeShowPlus.ico"
  DetailPrint "Allowing RTMP camera input on private networks..."
  nsExec::ExecToLog '$\"$SYSDIR\netsh.exe$\" advfirewall firewall delete rule name=$\"FreeShow RTMP camera input$\"'
  Pop $0
  nsExec::ExecToLog '$\"$SYSDIR\netsh.exe$\" advfirewall firewall add rule name=$\"FreeShow RTMP camera input$\" dir=in action=allow profile=private protocol=ANY program=$\"$LOCALAPPDATA\app.freeshow.tauri.preview\rtmp-input\v1.21.2\mediamtx.exe$\" enable=yes'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Could not create the private-network firewall rule. Allow MediaMTX through Windows Firewall when starting RTMP input."
  ${EndIf}
  DetailPrint "Registering FreeShow Virtual Camera..."
  ${DisableX64FSRedirection}
  nsExec::ExecToLog '$\"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe$\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $\"$INSTDIR\Install-FreeShowCamera.ps1$\"'
  ${EnableX64FSRedirection}
  Pop $0
  ${If} $0 != 0
    SetErrorLevel 1
    MessageBox MB_ICONSTOP "FreeShow was copied, but camera registration failed (code $0). Close camera apps and check Windows camera privacy settings, then run Setup again. The uninstaller is available in Installed Apps."
    Abort
  ${EndIf}
SectionEnd
Section "Uninstall"
  SetRegView 64
  ${DisableX64FSRedirection}
  nsExec::ExecToLog '$\"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe$\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $\"$INSTDIR\Uninstall-FreeShowCamera.ps1$\"'
  ${EnableX64FSRedirection}
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Camera removal failed. Close camera apps and retry. Installed files were preserved."
    SetErrorLevel 1
    Abort
  ${EndIf}
  SetShellVarContext current
  Delete "$DESKTOP\FreeShow+.lnk"
  Delete "$SMPROGRAMS\FreeShow+\FreeShow+.lnk"
  RMDir "$SMPROGRAMS\FreeShow+"
  Delete "$DESKTOP\FreeShow Tauri Preview.lnk"
  Delete "$SMPROGRAMS\FreeShow Tauri Preview\FreeShow.lnk"
  RMDir "$SMPROGRAMS\FreeShow Tauri Preview"
  nsExec::ExecToLog '$\"$SYSDIR\netsh.exe$\" advfirewall firewall delete rule name=$\"FreeShow RTMP camera input$\"'
  Pop $0
  Delete "$INSTDIR\FreeShow.exe"
  Delete "$INSTDIR\FreeShowPlus.ico"
  Delete "$INSTDIR\FreeShowVirtualCamera.dll"
  Delete "$INSTDIR\FreeShowCameraTool.exe"
  Delete "$INSTDIR\Install-FreeShowCamera.ps1"
  Delete "$INSTDIR\Uninstall-FreeShowCamera.ps1"
  Delete "$INSTDIR\LICENSE-Microsoft.txt"
  Delete "$INSTDIR\LICENSE-WIL.txt"
  Delete "$INSTDIR\LICENSE-MediaMTX.txt"
  Delete "$INSTDIR\LICENSE-FreeShow.txt"
  Delete "$INSTDIR\MediaMTX-UPSTREAM.json"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\APP-AUDIT-REPAIRS.md"
  Delete "$INSTDIR\AUDIT-FIXES-2026-10-15.md"
  Delete "$INSTDIR\EDITOR-DRAG-REPAIR.md"
  Delete "$INSTDIR\LYRICS-SEARCH-REPAIR.md"
  Delete "$INSTDIR\EDITOR-ZOOM-REPAIR.md"
  Delete "$INSTDIR\LICENSE-DOMPurify.txt"
  Delete "$INSTDIR\LICENSE-Svelte.txt"
  Delete "$INSTDIR\BUNDLED-FONTS.md"
  Delete "$INSTDIR\UPSTREAM-1.6.7-BETA-PORT.md"
  Delete "$INSTDIR\WINDOWS-CAPTURE-QUALITY.md"
  Delete "$INSTDIR\OUTPUT-ESCAPE-REPAIR.md"
  !include "tauri-runtime-uninstall.nsh"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\FreeShowTauriCamera"
SectionEnd
