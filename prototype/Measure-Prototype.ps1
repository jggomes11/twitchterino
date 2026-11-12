[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$RootProcessId,
  [ValidateRange(0,86400)][int]$WarmupSeconds=600,
  [ValidateRange(5,172800)][int]$DurationSeconds=1800,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$csvPath=Join-Path $OutputDirectory 'processes.csv'
$summaryPath=Join-Path $OutputDirectory 'summary.json'
if (Test-Path $csvPath) { throw 'Use uma pasta nova para não misturar rodadas.' }
$logicalProcessors=[Environment]::ProcessorCount
$os=Get-CimInstance Win32_OperatingSystem
@{ startedUtc=[DateTime]::UtcNow.ToString('o'); rootProcessId=$RootProcessId; sampleSeconds=5; warmupSeconds=$WarmupSeconds; durationSeconds=$DurationSeconds; logicalProcessors=$logicalProcessors; windows=$os.Caption; windowsVersion=$os.Version; physicalMemoryBytes=[long]$os.TotalVisibleMemorySize*1024; gpuMeasured=$false; networkMeasured=$false; credentialsRead=$false } | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'environment.json')
$warmupEnd=[DateTime]::UtcNow.AddSeconds($WarmupSeconds)
while ([DateTime]::UtcNow -lt $warmupEnd) {
  if (-not (Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue)) { throw 'O aplicativo encerrou durante a estabilização.' }
  Start-Sleep -Seconds ([Math]::Min(5,[Math]::Max(1,($warmupEnd-[DateTime]::UtcNow).TotalSeconds)))
}
$end=[DateTime]::UtcNow.AddSeconds($DurationSeconds)
$previous=@{}
$lastTime=$null
$totals=[Collections.Generic.List[object]]::new()
$endedEarly=$false
while ([DateTime]::UtcNow -lt $end) {
  $sampleTime=[DateTime]::UtcNow
  $inventory=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)
  $ids=[Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($RootProcessId)
  do {
    $added=$false
    foreach ($entry in $inventory) { if ($ids.Contains([int]$entry.ParentProcessId) -and $ids.Add([int]$entry.ProcessId)) { $added=$true } }
  } while ($added)
  $rows=[Collections.Generic.List[object]]::new()
  [long]$privateBytes=0
  [double]$cpuDelta=0
  foreach ($processId in $ids) {
    $process=Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    try {
      $cpu=[double]$process.TotalProcessorTime.TotalSeconds
      $creation=$process.StartTime.ToUniversalTime().Ticks
      $key="$processId/$creation"
      if ($null -ne $lastTime) { $cpuDelta += if ($previous.ContainsKey($key)) { [Math]::Max(0,$cpu-$previous[$key]) } else { $cpu } }
      $previous[$key]=$cpu
      $privateBytes+=$process.PrivateMemorySize64
      $parent=($inventory | Where-Object ProcessId -eq $processId | Select-Object -First 1).ParentProcessId
      $rows.Add([pscustomobject]@{ utc=$sampleTime.ToString('o'); processId=$processId; parentProcessId=$parent; name=$process.ProcessName; privateBytes=$process.PrivateMemorySize64; workingSetBytes=$process.WorkingSet64; cpuSeconds=$cpu })
    } catch { continue }
  }
  if ($rows.Count -eq 0 -or -not (Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue)) { $endedEarly=$true; break }
  $rows | Export-Csv -Path $csvPath -Append -NoTypeInformation -Encoding utf8
  $cpuPercent=if ($null -eq $lastTime) { $null } else { 100*$cpuDelta/($sampleTime-$lastTime).TotalSeconds/$logicalProcessors }
  $totals.Add([pscustomobject]@{ utc=$sampleTime.ToString('o'); privateBytes=$privateBytes; cpuPercent=$cpuPercent; processes=$rows.Count })
  $lastTime=$sampleTime
  Start-Sleep -Seconds 5
}
function Statistics($Values) {
  $ordered=@($Values | Where-Object { $null -ne $_ } | Sort-Object)
  if ($ordered.Count -eq 0) { return $null }
  @{ median=$ordered[[Math]::Floor(($ordered.Count-1)*0.5)]; p95=$ordered[[Math]::Ceiling(($ordered.Count-1)*0.95)]; peak=$ordered[-1] }
}
@{ samples=$totals.Count; endedEarly=$endedEarly; sampleSeconds=5; privateBytes=(Statistics @($totals | ForEach-Object privateBytes)); cpuPercentOfMachine=(Statistics @($totals | ForEach-Object cpuPercent)); workingSet='per-process only, shared pages may overlap'; gpu=$null; network=$null; realPoints='record per channel manually'; statistics='nearest-rank approximation, median lower central observation' } | ConvertTo-Json -Depth 5 | Set-Content $summaryPath
$totals | Export-Csv (Join-Path $OutputDirectory 'totals.csv') -NoTypeInformation -Encoding utf8
Write-Host "Medição salva em $OutputDirectory. Confirme os pontos por live separadamente."
