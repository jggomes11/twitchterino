$ErrorActionPreference = 'Stop'
$ExporterSource = Join-Path $PSScriptRoot 'Collect-PointsDiagnostics.ps1'
if (-not (Test-Path -LiteralPath $ExporterSource)) { throw 'Read-only points exporter has not been implemented' }
$FixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('points-diagnostics-' + [guid]::NewGuid().ToString('N'))
$PreviousLocalAppData = $env:LOCALAPPDATA
try {
    $env:LOCALAPPDATA = Join-Path $FixtureRoot 'local'
    $Bundle = Join-Path $FixtureRoot 'bundle'
    $ProfileId = 'abcdef123456'
    $Profile = Join-Path $env:LOCALAPPDATA ('ChannelClientValidation/twitchterino/' + $ProfileId)
    New-Item -ItemType Directory -Path $Bundle, $Profile -Force | Out-Null
    Copy-Item -LiteralPath $ExporterSource -Destination $Bundle
    $Exporter = Join-Path $Bundle 'Collect-PointsDiagnostics.ps1'
    $SourceSha = '0123456789abcdef0123456789abcdef01234567'
    @{sourceSha=$SourceSha;username='SECRET_MANIFEST'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Bundle 'build-info.json') -Encoding UTF8
    $Target = @{live=$true;watching=$true;points=300;earning='idle';username='SECRET_ACCOUNT';video=@{paused=$false;time=100;height=360;ready=4;url='SECRET_VIDEO'};
        diagnostics=@{balanceAvailable=$true;apiError=$false;pointsEnabled=$true;manualPlayer=$false;playerSampleAt=1000;
            page=@{visibility='visible';focused=$false;loginPromptVisible=$false;muted=$true;volume=1;token='SECRET_PAGE'};
            recovery=@{awaitingInitialCredit=$false;attempts=0;lastAttemptAt=$null;token='SECRET_RECOVERY'};
            tracking=@{debuggerAttached=$true;networkEnabled=$true;requests=3;minuteWatchedEvents=2;lastStatus=204;headers='SECRET_AUTH'}}}
    $Control = @{live=$true;watching=$true;points=4610;earning='earning';diagnostics=@{tracking=@{minuteWatchedEvents=4}}}
    $Log = Join-Path $Profile 'points-log.jsonl'
    foreach ($Minute in 0,1) {
        $Control.points = 4610 + $Minute * 10
        @{t=('2026-11-06T03:0' + $Minute + ':00Z');diagnosticsVersion=1;loggedIn=$true;sessionChecking=$false;farming=$true;watchAll=$true;
            username='SECRET_LOGIN';token='SECRET_TOKEN';channels=@{rodil=$Target;faturetosl=$Control;unselected=@{points=999}}} |
            ConvertTo-Json -Depth 10 -Compress | Add-Content -LiteralPath $Log -Encoding UTF8
    }
    Add-Content -LiteralPath $Log -Value '{"partial":' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $Profile 'Cookies') -Value 'SECRET_COOKIE_FILE'
    $OutputText = (& $Exporter -ProfileCommit $ProfileId -Channels @('rodil','faturetosl') -Samples 10 | Out-String).Trim()
    if ($OutputText -match 'SECRET|rodil|faturetosl|unselected|Cookies|Authorization') { throw 'Diagnostic export disclosed non-allowlisted content' }
    $Report = $OutputText | ConvertFrom-Json
    if ($Report.error) { throw ('Diagnostic exporter returned ' + $Report.error) }
    if ($Report.schema -ne 1 -or $Report.source -ne $SourceSha -or $Report.profile -ne $ProfileId) { throw 'Diagnostic report identity mismatch' }
    if (@($Report.samples).Count -ne 2) { throw 'Malformed final line was not skipped correctly' }
    if ($Report.samples[0].channels.C1.points -ne 300 -or $Report.samples[1].channels.C2.points -ne 4620) { throw 'Paired channel order or balances mismatch' }
    if (@($Report.samples[0].channels.PSObject.Properties).Count -ne 2) { throw 'Unselected channel exported' }
    if ($Report.samples[0].channels.C1.diagnostics.tracking.minuteWatchedEvents -ne 2) { throw 'Watch-event evidence missing' }
    if ($Report.samples[0].channels.C1.diagnostics.recovery.awaitingInitialCredit -ne $false) { throw 'Recovery evidence missing' }
    $Missing = (& $Exporter -ProfileCommit '000000000000' | Out-String) | ConvertFrom-Json
    if ($Missing.error -ne 'profile-log-not-found') { throw 'Missing profile was not reported safely' }
    $Newest = (& $Exporter -Samples 10 | Out-String) | ConvertFrom-Json
    if ($Newest.profile -ne $ProfileId) { throw 'Automatic profile discovery failed' }
    # Recognized leaf names must not allow objects, arrays or arbitrary strings.
    $Target.points = @{token='SECRET_NESTED_POINTS';url='https://private.example'}
    $Target.watching = 'SECRET_BOOLEAN'
    $Target.earning = 'SECRET_ENUM'
    $Target.video.time = @('SECRET_ARRAY')
    $Target.diagnostics.page.visibility = @{token='SECRET_VISIBILITY'}
    $Target.diagnostics.tracking.lastStatus = @{token='SECRET_STATUS'}
    $Target.diagnostics.recovery.attempts = 'SECRET_NUMBER'
    @{t=@{token='SECRET_TIMESTAMP'};loggedIn=@{token='SECRET_LOGIN_OBJECT'};channels=@{rodil=$Target}} |
        ConvertTo-Json -Depth 10 -Compress | Set-Content -LiteralPath $Log -Encoding UTF8
    $HostileText = (& $Exporter -ProfileCommit $ProfileId -Channels rodil | Out-String).Trim()
    if ($HostileText -match 'SECRET|private.example|"token"|"url"') { throw 'Recognized leaves disclosed unexpected nested values' }
    $Hostile = $HostileText | ConvertFrom-Json
    if ($Hostile.error -or @($Hostile.samples).Count -ne 1) { throw 'Invalid leaf types should be redacted without losing the sample' }
    if ($null -ne $Hostile.samples[0].channels.C1.points -or $null -ne $Hostile.samples[0].loggedIn) { throw 'Invalid scalar values were not replaced with null' }
    @{sourceSha=@($SourceSha,'SECRET_MANIFEST_ARRAY')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Bundle 'build-info.json') -Encoding UTF8
    $BadManifestText = (& $Exporter -ProfileCommit $ProfileId | Out-String).Trim()
    if ($BadManifestText -match 'SECRET') { throw 'Manifest source disclosed unexpected array values' }
    $BadManifest = $BadManifestText | ConvertFrom-Json
    if ($null -ne $BadManifest.source) { throw 'Malformed manifest source must be null' }
    Write-Host 'Points diagnostic exporter: paired aliases, privacy, malformed final line, missing profile and discovery passed.'
} finally {
    $env:LOCALAPPDATA = $PreviousLocalAppData
    if (Test-Path -LiteralPath $FixtureRoot) { Remove-Item -LiteralPath $FixtureRoot -Recurse -Force }
}
