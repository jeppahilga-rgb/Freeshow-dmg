#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
if (![Environment]::Is64BitProcess) { throw 'Camera installation requires 64-bit PowerShell. Run the updated FreeShow installer.' }
$cameraDestination = Join-Path $env:ProgramData 'FreeShowVirtualCamera'
New-Item -ItemType Directory -Path $cameraDestination -Force | Out-Null
foreach ($cameraComponentName in @('FreeShowVirtualCamera.dll','FreeShowCameraTool.exe')) {
    $cameraSourcePath = Join-Path $PSScriptRoot $cameraComponentName
    $cameraInstalledPath = Join-Path $cameraDestination $cameraComponentName
    if ((Test-Path -LiteralPath $cameraInstalledPath) -and
        (Get-FileHash -LiteralPath $cameraSourcePath).Hash -eq (Get-FileHash -LiteralPath $cameraInstalledPath).Hash) {
        Write-Host "$cameraComponentName is already current; reusing it."
        continue
    }
    try { Copy-Item -LiteralPath $cameraSourcePath -Destination $cameraInstalledPath -Force }
    catch { throw "Cannot update $cameraComponentName. Close apps using FreeShow Virtual Camera and retry. If Windows still holds it open, restart Windows and run Setup before opening camera apps. Details: $_" }
}
$cameraUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach ($cameraFileName in @('frame.bin','producer.lock')) {
    $cameraFilePath = Join-Path $cameraDestination $cameraFileName
    if (!(Test-Path -LiteralPath $cameraFilePath)) { [IO.File]::WriteAllBytes($cameraFilePath,[byte[]]::new(0)) }
    if ($cameraFileName -eq 'frame.bin' -and (Get-Item -LiteralPath $cameraFilePath).Length -ne 7372864) { $cameraFile = [IO.File]::OpenWrite($cameraFilePath);try {$cameraFile.SetLength(7372864)} finally {$cameraFile.Dispose()} }
    $cameraAcl = Get-Acl -LiteralPath $cameraFilePath
    $cameraAcl.SetAccessRuleProtection($true,$false)
    foreach ($cameraRule in @(@('S-1-5-18','FullControl'),@('S-1-5-32-544','FullControl'),@($cameraUserSid,'Modify'),@('S-1-5-19','Read'))) {
        $cameraIdentity = [Security.Principal.SecurityIdentifier]::new($cameraRule[0])
        $cameraAccessRule = [Security.AccessControl.FileSystemAccessRule]::new($cameraIdentity,$cameraRule[1],'Allow')
        $cameraAcl.AddAccessRule($cameraAccessRule)
    }
    Set-Acl -LiteralPath $cameraFilePath -AclObject $cameraAcl
}
$cameraClassKey = 'HKLM:\SOFTWARE\Classes\CLSID\{48323401-52A7-4CD0-92B4-684B62D1FAE9}\InprocServer32'
New-Item -Path $cameraClassKey -Force | Out-Null
Set-Item -Path $cameraClassKey -Value (Join-Path $cameraDestination 'FreeShowVirtualCamera.dll')
New-ItemProperty -Path $cameraClassKey -Name 'ThreadingModel' -Value 'Both' -PropertyType String -Force | Out-Null
# Clean up the incorrect 32-bit registration left by the first installer.
$oldCameraKey = 'HKLM:\SOFTWARE\Classes\WOW6432Node\CLSID\{48323401-52A7-4CD0-92B4-684B62D1FAE9}'
if (Test-Path -LiteralPath $oldCameraKey) { Remove-Item -LiteralPath $oldCameraKey -Recurse }
& (Join-Path $cameraDestination 'FreeShowCameraTool.exe') --install
if ($LASTEXITCODE -ne 0) { throw 'Camera registration failed. Check Windows camera privacy permissions.' }
Write-Host 'FreeShow Virtual Camera installed. Restart receiving apps to refresh their camera list.'
