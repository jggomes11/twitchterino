[CmdletBinding(DefaultParameterSetName='ById')]
param(
  [Parameter(Mandatory=$true,ParameterSetName='ById')][ValidateRange(1,2147483647)][int]$RootProcessId,
  [Parameter(Mandatory=$true,ParameterSetName='ByPath')][ValidateNotNullOrEmpty()][string]$ExecutablePath,
  [ValidateRange(0,86400)][int]$WarmupSeconds=600,
  [ValidateRange(5,172800)][int]$DurationSeconds=1800,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference='Stop'
if ($PSCmdlet.ParameterSetName -eq 'ByPath') {
  $executable = Get-Item -LiteralPath $ExecutablePath -ErrorAction Stop
  if ($executable -isnot [IO.FileInfo]) { throw 'Informe o caminho do arquivo executável.' }
  $candidateProcesses = @(Get-Process | Where-Object {
    try { [string]::Equals($_.Path, $executable.FullName, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
  })
  if ($candidateProcesses.Count -eq 0) { throw 'Abra o aplicativo pelo .exe desta pasta e execute a medição novamente.' }
  if ($candidateProcesses.Count -gt 1) { throw 'Mais de um processo usa esse executável. Informe -RootProcessId com o PID desejado.' }
  $RootProcessId = $candidateProcesses[0].Id
}
$rootStarted=(Get-Process -Id $RootProcessId -ErrorAction Stop).StartTime.ToUniversalTime().Ticks
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$csvPath=Join-Path $OutputDirectory 'processes.csv'
$summaryPath=Join-Path $OutputDirectory 'summary.json'
if (Test-Path $csvPath) { throw 'Use uma pasta nova para não misturar rodadas.' }
$logicalProcessors=[Environment]::ProcessorCount
$os=Get-CimInstance Win32_OperatingSystem
$graphics=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion)
@{ startedUtc=[DateTime]::UtcNow.ToString('o'); rootProcessId=$RootProcessId; sampleSeconds=5; warmupSeconds=$WarmupSeconds; durationSeconds=$DurationSeconds; logicalProcessors=$logicalProcessors; windows=$os.Caption; windowsVersion=$os.Version; physicalMemoryBytes=[long]$os.TotalVisibleMemorySize*1024; graphics=$graphics; gpuMeasured=$false; networkMeasured=$false; credentialsRead=$false } | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'environment.json')
Write-Host "Aplicativo encontrado: PID $RootProcessId. Estabilização: $WarmupSeconds s; medição: $DurationSeconds s. Mantenha este PowerShell aberto."
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
  $resident=@{}
  try { Get-CimInstance Win32_PerfRawData_PerfProc_Process -OperationTimeoutSec 3 | ForEach-Object { if ($null -ne $_.WorkingSetPrivate) { $resident[[int]$_.IDProcess]=[long]$_.WorkingSetPrivate } } } catch {}
  $rows=[Collections.Generic.List[object]]::new()
  [long]$residentBytes=0
  $residentComplete=$true
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
      $privateResident=if ($resident.ContainsKey($processId)) { $resident[$processId] } else { $residentComplete=$false; $null }
      if ($null -ne $privateResident) { $residentBytes+=$privateResident }
      $parent=($inventory | Where-Object ProcessId -eq $processId | Select-Object -First 1).ParentProcessId
      $rows.Add([pscustomobject]@{ utc=$sampleTime.ToString('o'); processId=$processId; parentProcessId=$parent; name=$process.ProcessName; privateBytes=$process.PrivateMemorySize64; residentPrivateBytes=$privateResident; workingSetBytes=$process.WorkingSet64; cpuSeconds=$cpu })
    } catch { continue }
  }
  if ($rows.Count -eq 0 -or -not (Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue) -or (Get-Process -Id $RootProcessId).StartTime.ToUniversalTime().Ticks -ne $rootStarted) { $endedEarly=$true; break }
  $rows | Export-Csv -Path $csvPath -Append -NoTypeInformation -Encoding utf8
  $cpuPercent=if ($null -eq $lastTime) { $null } else { 100*$cpuDelta/($sampleTime-$lastTime).TotalSeconds/$logicalProcessors }
  $totals.Add([pscustomobject]@{ utc=$sampleTime.ToString('o'); privateBytes=$privateBytes; residentPrivateBytes=$(if ($residentComplete) { $residentBytes } else { $null }); cpuPercent=$cpuPercent; processes=$rows.Count })
  $lastTime=$sampleTime
  Start-Sleep -Seconds 5
}
function Statistics($Values) {
  $ordered=@($Values | Where-Object { $null -ne $_ } | Sort-Object)
  if ($ordered.Count -eq 0) { return $null }
  @{ median=$ordered[[Math]::Floor(($ordered.Count-1)*0.5)]; p95=$ordered[[Math]::Ceiling(($ordered.Count-1)*0.95)]; peak=$ordered[-1] }
}
@{ samples=$totals.Count; endedEarly=$endedEarly; sampleSeconds=5; privateBytes=(Statistics @($totals | ForEach-Object privateBytes)); residentPrivateBytes=(Statistics @($totals | ForEach-Object residentPrivateBytes)); residentCompleteSamples=@($totals | Where-Object { $null -ne $_.residentPrivateBytes }).Count; cpuPercentOfMachine=(Statistics @($totals | ForEach-Object cpuPercent)); workingSet='per-process only, shared pages may overlap'; gpu=$null; network=$null; realPoints='record per channel manually'; statistics='median: floor((n-1)*0.5); p95: ceil((n-1)*0.95); peak: maximum' } | ConvertTo-Json -Depth 5 | Set-Content $summaryPath
$totals | Export-Csv (Join-Path $OutputDirectory 'totals.csv') -NoTypeInformation -Encoding utf8
Write-Host "Medição salva em $OutputDirectory. Confirme os pontos por live separadamente."
