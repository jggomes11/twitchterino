[CmdletBinding()]
param([switch]$CheckOnly)
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
if ($CheckOnly) { Write-Host 'Windows validation bundle integrity checks passed.'; exit 0 }
$ValidationProfile = Join-Path $env:LOCALAPPDATA ('ChannelClientValidation\' + $Manifest.repository + '\' + $Manifest.sourceSha.Substring(0, 12))
New-Item -ItemType Directory -Path $ValidationProfile -Force | Out-Null
$Config = Join-Path $ValidationProfile 'config.json'
if (-not (Test-Path -LiteralPath $Config)) {
    Copy-Item -LiteralPath (Join-Path $Root 'validation-defaults.json') -Destination $Config
}
[Environment]::SetEnvironmentVariable($Manifest.profileVariable, $ValidationProfile, 'Process')
Write-Host ('Source commit: ' + $Manifest.sourceSha)
Write-Host ('Isolated validation profile: ' + $ValidationProfile)
Write-Host 'Sign in only in the official platform window. No credentials or browser profile are uploaded.'
Write-Host 'Close the application from its tray menu when the test is complete.'
Start-Process -FilePath (Join-Path $AppRoot $Manifest.executable) -WorkingDirectory $AppRoot -Wait

