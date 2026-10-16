param([int]$AppProcessId = 0, [switch]$Json)
$processList = Get-CimInstance Win32_Process
if (-not $AppProcessId) {
    $targetApp = $processList | Where-Object Name -eq 'freeshow-tauri.exe' | Select-Object -First 1
    if (-not $targetApp) { throw 'Start FreeShow Tauri before measuring.' }
    $AppProcessId = $targetApp.ProcessId
}
$selectedIds = [System.Collections.Generic.HashSet[int]]::new()
[void]$selectedIds.Add($AppProcessId)
do {
    $countBefore = $selectedIds.Count
    foreach ($entry in $processList) {
        if ($selectedIds.Contains([int]$entry.ParentProcessId)) { [void]$selectedIds.Add([int]$entry.ProcessId) }
    }
} while ($selectedIds.Count -ne $countBefore)
$rows = foreach ($selectedId in $selectedIds) {
    $entry = Get-Process -Id $selectedId -ErrorAction SilentlyContinue
    if ($entry) { [PSCustomObject]@{ Name=$entry.ProcessName; Id=$entry.Id; WorkingSetMB=[math]::Round($entry.WorkingSet64 / 1MB, 1); PrivateMB=[math]::Round($entry.PrivateMemorySize64 / 1MB, 1) } }
}
$totals = [PSCustomObject]@{ Processes=$rows.Count; TotalWorkingSetMB=[math]::Round(($rows | Measure-Object WorkingSetMB -Sum).Sum, 1); TotalPrivateMB=[math]::Round(($rows | Measure-Object PrivateMB -Sum).Sum, 1) }
if ($Json) { @{totals=$totals;processes=$rows} | ConvertTo-Json -Depth 5 }
else { $rows | Format-Table -AutoSize; $totals }
