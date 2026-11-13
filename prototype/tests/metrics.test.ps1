[CmdletBinding()]
param([string]$ProofPath)
$ErrorActionPreference = 'Stop'
$collector = Join-Path $PSScriptRoot '../Measure-Prototype.ps1'
$sandbox = Join-Path ([IO.Path]::GetTempPath()) ('terino-metrics-' + [guid]::NewGuid())
$helperDirectory = Join-Path $sandbox 'executable with spaces'
New-Item -ItemType Directory -Force $helperDirectory | Out-Null
$helperPath = Join-Path $helperDirectory 'metrics-helper.exe'
Copy-Item (Join-Path $env:WINDIR 'System32/ping.exe') $helperPath
$helpers = [Collections.Generic.List[object]]::new()
function Start-Helper {
  $process = Start-Process -FilePath $helperPath -ArgumentList '-n','120','127.0.0.1' -WindowStyle Hidden -PassThru
  $helpers.Add($process)
  return $process
}
function Assert-Collection($Directory, $ExpectedId) {
  $environment = Get-Content (Join-Path $Directory 'environment.json') -Raw | ConvertFrom-Json
  $summary = Get-Content (Join-Path $Directory 'summary.json') -Raw | ConvertFrom-Json
  $rows = @(Import-Csv (Join-Path $Directory 'processes.csv'))
  if ($environment.rootProcessId -ne $ExpectedId -or $ExpectedId -le 0) { throw 'Wrong root process recorded' }
  if ($summary.samples -lt 1 -or $summary.endedEarly -or $null -eq $summary.privateBytes) { throw 'No valid process metrics collected' }
  if (-not ($rows | Where-Object { [int]$_.processId -eq $ExpectedId })) { throw 'Selected executable missing from metrics' }
}
function Assert-Rejected($Arguments, $OutputPath, $Message) {
  $failure = $null
  try { & $collector @Arguments -WarmupSeconds 0 -DurationSeconds 5 -OutputDirectory $OutputPath } catch { $failure = $_ }
  if ($null -eq $failure -or $failure.Exception.Message -notmatch $Message) { throw "Expected rejection matching $Message; got $failure" }
  if (Test-Path $OutputPath) { throw 'Rejected selection wrote measurement files' }
}
try {
  $helper = Start-Helper
  $byPath = Join-Path $sandbox 'by-path'
  & $collector -ExecutablePath $helperPath -WarmupSeconds 0 -DurationSeconds 5 -OutputDirectory $byPath
  Assert-Collection $byPath $helper.Id
  Write-Host 'PASS: existing executable selected by exact path with spaces'

  $byId = Join-Path $sandbox 'by-id'
  & $collector -RootProcessId $helper.Id -WarmupSeconds 0 -DurationSeconds 5 -OutputDirectory $byId
  Assert-Collection $byId $helper.Id
  Write-Host 'PASS: explicit PID remains supported'

  $second = Start-Helper
  Assert-Rejected @{ExecutablePath=$helperPath} (Join-Path $sandbox 'ambiguous') 'Mais de um'
  Write-Host 'PASS: ambiguous executable rejected before writing output'
  foreach ($process in $helpers) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; [void]$process.WaitForExit(5000) }

  Assert-Rejected @{ExecutablePath=$helperPath} (Join-Path $sandbox 'closed') 'Abra'
  Write-Host 'PASS: closed executable produces actionable error'
  Assert-Rejected @{RootProcessId=0} (Join-Path $sandbox 'zero') 'RootProcessId'
  Write-Host 'PASS: missing variable converted to zero is rejected without output'
  if ($ProofPath) {
    @{passed=$true; shell=$PSVersionTable.PSVersion.ToString(); pathSelection=$true; explicitPid=$true; ambiguousRejected=$true; closedRejected=$true; zeroRejected=$true; measuredApplication=$false} | ConvertTo-Json | Set-Content $ProofPath
  }
} finally {
  foreach ($process in $helpers) {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; [void]$process.WaitForExit(5000) }
  }
  Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}
