param([Parameter(Mandatory=$true)][string]$InstallPath)
$ErrorActionPreference = 'Stop'
try {
    $targetRoot = [IO.Path]::GetFullPath($InstallPath).TrimEnd('\','/')
    $targetExe = Join-Path $targetRoot 'FreeShow.exe'
    $runtimeRoot = (Join-Path $targetRoot 'runtime') + [IO.Path]::DirectorySeparatorChar
    $busy = Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and ($_.ExecutablePath.Equals($targetExe,[StringComparison]::OrdinalIgnoreCase) -or
        ($_.Name -eq 'node.exe' -and $_.ExecutablePath.StartsWith($runtimeRoot,[StringComparison]::OrdinalIgnoreCase)))
    }
    if ($busy) { Write-Output 'Close FreeShow before updating its executable and integration runtime.'; exit 1 }
    exit 0
} catch { Write-Output 'Could not verify whether FreeShow is running. Close it and retry Setup.'; exit 2 }
