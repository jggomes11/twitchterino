[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [ValidatePattern('^[0-9a-f]{12}$')][string]$ProfileCommit,
    [switch]$Measure,
    [switch]$Diagnostics,
    [ValidateRange(0,86400)][int]$WarmupSeconds=600,
    [ValidateRange(5,172800)][int]$DurationSeconds=1800,
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Manifest = Get-Content -LiteralPath (Join-Path $Root 'build-info.json') -Raw | ConvertFrom-Json
if ($Manifest.repository -notin @('twitchterino', 'kickterino')) { throw 'Invalid repository.' }
$ExpectedVariable = if ($Manifest.repository -eq 'twitchterino') { 'TWITCHTERINO_DATA' } else { 'KICKTERINO_DATA' }
$ExpectedExecutable = if ($Manifest.repository -eq 'twitchterino') { 'Twitchterino.exe' } else { 'Kickterino.exe' }
if ($Manifest.profileVariable -ne $ExpectedVariable -or $Manifest.executable -ne $ExpectedExecutable) { throw 'Invalid application identity.' }
if ($Manifest.sourceSha -notmatch '^[0-9a-f]{40}$') { throw 'Invalid source commit.' }
if ($Manifest.executable -notmatch '^[A-Za-z0-9._-]+\.exe$') { throw 'Invalid executable name.' }
$AppRoot = [IO.Path]::GetFullPath((Join-Path $Root 'app'))
$ActualFiles = @(Get-ChildItem -LiteralPath $AppRoot -Recurse -File -Force)
if ($ActualFiles.Count -ne @($Manifest.files).Count) { throw 'Unexpected or missing files in the application folder.' }
foreach ($Entry in $Manifest.files) {
    $File = [IO.Path]::GetFullPath((Join-Path $AppRoot $Entry.path))
    if (-not $File.StartsWith($AppRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid manifest path.' }
    $Hash = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Hash -ne $Entry.sha256) { throw ('File integrity check failed: ' + $Entry.path) }
}
$ProfileId = if ($ProfileCommit) { $ProfileCommit.ToLowerInvariant() } else { $Manifest.sourceSha.Substring(0, 12) }
$ValidationProfile = Join-Path $env:LOCALAPPDATA ('ChannelClientValidation\' + $Manifest.repository + '\' + $ProfileId)
if ($ProfileCommit -and -not (Test-Path -LiteralPath $ValidationProfile -PathType Container)) { throw 'The requested isolated validation profile does not exist.' }
if ($CheckOnly) { Write-Host 'Windows validation bundle integrity checks passed.'; exit 0 }
New-Item -ItemType Directory -Path $ValidationProfile -Force | Out-Null
$Configs=@((Join-Path $ValidationProfile 'config.json'))
foreach($Slot in 2..4){$Configs+=Join-Path $ValidationProfile ('accounts\account-'+$Slot+'\config.json')}
foreach($Config in $Configs){
    if (-not (Test-Path -LiteralPath $Config)) {
        New-Item -ItemType Directory -Force (Split-Path -Parent $Config) | Out-Null
        Copy-Item -LiteralPath (Join-Path $Root 'validation-defaults.json') -Destination $Config
    }
}
$PreviousProfileVariable=[Environment]::GetEnvironmentVariable($Manifest.profileVariable,'Process')
$DiagnosticsVariable=$ExpectedVariable -replace '_DATA$','_DIAGNOSTICS'
$PreviousDiagnostics=[Environment]::GetEnvironmentVariable($DiagnosticsVariable,'Process')
[Environment]::SetEnvironmentVariable($Manifest.profileVariable, $ValidationProfile, 'Process')
if($Diagnostics){[Environment]::SetEnvironmentVariable($DiagnosticsVariable,'1','Process')}
Write-Host ('Source commit: ' + $Manifest.sourceSha)
Write-Host ('Isolated validation profile: ' + $ValidationProfile)
Write-Host 'Sign in only in the official platform window. No credentials or browser profile are uploaded.'
Write-Host 'Close the application from its tray menu when the test is complete.'
try {
    $TestApplication=Start-Process -FilePath (Join-Path $AppRoot $Manifest.executable) -WorkingDirectory $AppRoot -PassThru
    if($Measure){
        if($null -eq $TestApplication -or $TestApplication.Id -lt 1){throw 'The application did not return a valid process ID.'}
        if($TestApplication.WaitForExit(1000)){throw ('The launched application exited before measurement. Exit code: '+$TestApplication.ExitCode+'. Close any existing instance of this test profile before trying again.')}
        if(-not $OutputDirectory){$OutputDirectory=Join-Path $Root ('medicao-'+$Manifest.repository+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))}
        & (Join-Path $Root 'Measure-Application.ps1') -RootProcessId $TestApplication.Id -WarmupSeconds $WarmupSeconds -DurationSeconds $DurationSeconds -OutputDirectory $OutputDirectory
    }else{$TestApplication.WaitForExit()}
}finally{
    [Environment]::SetEnvironmentVariable($Manifest.profileVariable,$PreviousProfileVariable,'Process')
    [Environment]::SetEnvironmentVariable($DiagnosticsVariable,$PreviousDiagnostics,'Process')
}

