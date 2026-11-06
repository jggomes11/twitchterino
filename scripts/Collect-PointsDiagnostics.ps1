[CmdletBinding()]
param(
    [ValidatePattern('^[0-9a-f]{12}$')][string]$ProfileCommit,
    [ValidatePattern('^[a-zA-Z0-9_]{2,25}$')][string[]]$Channels = @(),
    [ValidateRange(1,120)][int]$Samples = 20
)
$ErrorActionPreference = 'Stop'
function Select-Fields($Source, [string[]]$Names) {
    if ($null -eq $Source) { return $null }
    $Selected = [ordered]@{}
    foreach ($Name in $Names) {
        $Property = $Source.PSObject.Properties[$Name]
        $Selected[$Name] = if ($Property) { $Property.Value } else { $null }
    }
    return [pscustomobject]$Selected
}
function Write-SafeError([string]$Code) {
    [pscustomobject]@{schema=1;error=$Code} | ConvertTo-Json -Compress
}
try {
    $Root = Join-Path $env:LOCALAPPDATA 'ChannelClientValidation/twitchterino'
    if ($ProfileCommit) {
        $Log = Get-Item -LiteralPath (Join-Path $Root ($ProfileCommit + '/points-log.jsonl')) -ErrorAction SilentlyContinue
    } else {
        $Log = Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^[0-9a-f]{12}$' } |
            ForEach-Object { Get-Item -LiteralPath (Join-Path $_.FullName 'points-log.jsonl') -ErrorAction SilentlyContinue } |
            Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    }
    if (-not $Log -or $Log.PSIsContainer) { Write-SafeError 'profile-log-not-found'; return }
    $Source = $null
    $ManifestPath = Join-Path $PSScriptRoot 'build-info.json'
    if (Test-Path -LiteralPath $ManifestPath) {
        $Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($Manifest.sourceSha -match '^[0-9a-f]{40}$') { $Source = $Manifest.sourceSha }
    }
    $Wanted = @($Channels | ForEach-Object { $_.ToLowerInvariant() } | Select-Object -Unique)
    $Aliases = @{}
    foreach ($Name in $Wanted) { $Aliases[$Name] = 'C' + ($Aliases.Count + 1) }
    $Rows = @()
    foreach ($Line in Get-Content -LiteralPath $Log.FullName -Tail $Samples -Encoding UTF8) {
        try { $Record = $Line | ConvertFrom-Json -ErrorAction Stop } catch { continue }
        if (-not $Record.channels) { continue }
        $SelectedChannels = [ordered]@{}
        foreach ($Property in $Record.channels.PSObject.Properties) {
            $Name = $Property.Name.ToLowerInvariant()
            if ($Wanted.Count -and $Name -notin $Wanted) { continue }
            if (-not $Aliases.ContainsKey($Name)) { $Aliases[$Name] = 'C' + ($Aliases.Count + 1) }
            $Channel = $Property.Value
            $Entry = Select-Fields $Channel @('live','watching','points','earning','gate','watchedMin')
            $Entry | Add-Member -NotePropertyName video -NotePropertyValue (Select-Fields $Channel.video @('paused','time','height','ready'))
            $Diagnostic = Select-Fields $Channel.diagnostics @('balanceAvailable','apiError','pointsEnabled','manualPlayer','playerSampleAt')
            if ($Diagnostic) {
                $Diagnostic | Add-Member -NotePropertyName page -NotePropertyValue (Select-Fields $Channel.diagnostics.page @('visibility','focused','loginPromptVisible','muted','volume'))
                $Diagnostic | Add-Member -NotePropertyName recovery -NotePropertyValue (Select-Fields $Channel.diagnostics.recovery @('awaitingInitialCredit','attempts','lastAttemptAt','nextAttemptAt','watchStartedAt','lastGainAt','globalNextAttemptAt'))
                $Diagnostic | Add-Member -NotePropertyName tracking -NotePropertyValue (Select-Fields $Channel.diagnostics.tracking @('debuggerAttached','networkEnabled','requests','minuteWatchedEvents','unclassifiedRequests','responses','httpErrors','networkFailures','lastStatus','lastRequestAt','lastMinuteWatchedAt','lastResponseAt','navigations','lastNavigationAt','pendingRequests'))
            }
            $Entry | Add-Member -NotePropertyName diagnostics -NotePropertyValue $Diagnostic
            $SelectedChannels[$Aliases[$Name]] = $Entry
        }
        $Row = Select-Fields $Record @('t','diagnosticsVersion','loggedIn','sessionChecking','farming','watchAll','maxWatchers')
        $Row | Add-Member -NotePropertyName channels -NotePropertyValue ([pscustomobject]$SelectedChannels)
        $Rows += $Row
    }
    [pscustomobject]@{schema=1;source=$Source;profile=$Log.Directory.Name;samples=$Rows} | ConvertTo-Json -Depth 10 -Compress
} catch { Write-SafeError 'diagnostic-read-failed' }
