#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
if (![Environment]::Is64BitProcess) { throw 'Camera removal requires 64-bit PowerShell.' }
$cameraDestination = Join-Path $env:ProgramData 'FreeShowVirtualCamera'
& (Join-Path $cameraDestination 'FreeShowCameraTool.exe') --remove
if ($LASTEXITCODE -ne 0) { throw 'Camera removal failed; registry and files were preserved.' }
Remove-Item -LiteralPath 'HKLM:\SOFTWARE\Classes\CLSID\{48323401-52A7-4CD0-92B4-684B62D1FAE9}' -Recurse
Write-Host 'Camera removed. Component files were kept for reinstalling.'
