# Windows validation

This is a source-pinned test build from the maintenance PR, not a signed release. The automated Windows job verifies the application UI and IPC with an empty temporary browser profile. It does not authenticate an account or prove live point accrual.

## Download and launch

1. Open the Windows validation workflow run linked from the PR, and download its `windows-validation` artifact for the expected source commit.
2. Extract the archive completely. Keep the `app` folder, `build-info.json`, `validation-defaults.json` and launcher together.
3. In PowerShell, open the extracted folder and run `& .\Start-WindowsValidation.ps1`. The launcher checks the packaged file hashes, uses an isolated profile under `%LOCALAPPDATA%\ChannelClientValidation\<project>\<commit>`, and starts the application without installing it. It does not use the original application's browser profile.
4. If Windows or the script execution policy blocks the launch, record the exact message. Do not change system security settings to complete this test.

The launcher does not enable remote debugging, upload logs, collect passwords or export browser sessions. Hash checks compare the extracted files with the build manifest; they are not a digital publisher signature.

## Real login

1. Click the platform login button. Confirm that the address is the official Twitch or Kick login page.
2. Enter your credentials and verification code directly in that window. Do not send passwords, cookies or tokens in chat.
3. Return to the client, refresh, and confirm that it recognizes the logged-in account and loads balances.
4. Close the app using its tray menu, start it again using the launcher, and confirm that the session persists in the isolated test profile.

## Real point accrual

1. Use one eligible channel that is currently live and has channel points enabled. Close other streams for the same platform account while measuring.
2. For a single-channel baseline, turn off **Todas as lives online**, keep the simultaneous-live setting at 1 and rotation off. Then enable all-live mode to compare balances per channel. For Twitch, leave automatic bonus-chest collection off so it does not confuse the measurement.
3. Enable viewing/point collection and confirm that the video is progressing; resolve any age-confirmation prompt manually.
4. Record the balance before the measurement and after approximately 15 minutes. Do not redeem rewards during this period.
5. Record whether the balance increased, the elapsed time and any client error. A running video alone does not prove that the platform awarded points.

## Interface and logout

- Check that the channel list, point panel, settings and message input are visible and usable at your Windows display scale.
- Change the simultaneous-live setting between 1 and 2 and verify that it returns to 1.
- Open and close a points store; do not purchase a reward for this test.
- Log out and confirm that account data is cleared and no queued store reopens.
- Close through the tray menu. Closing the main window alone normally leaves the client in the tray.

## Report results

Return only the source commit, Windows version/display scale, whether login and session persistence worked, whether the interface worked, and balances/time before and after the point test. Include a short error message if a step failed. Account names, credentials, cookies and browser profile files are unnecessary.

Automated evidence under `evidence/` contains screenshots and a JSON report from the empty CI profile. It must not be described as a successful real login or a real points test.


## Session continuity and automatic all-live mode

To reuse an existing local test login, supply the previous profile's 12-character commit prefix, for example `& .\Start-WindowsValidation.ps1 -ProfileCommit 92cc2da5780e`. The profile must already exist under this repository's isolated validation-profile root. The launcher still verifies the current application files first; it does not copy or upload credentials.

Enable **Todas as lives online** in settings, then **Juntar pontos**. The fixed count is disabled in this mode. Selecting a channel changes the chat; **Mostrar player** only reveals the running stream. Newly live channels are picked up on the next poll. Test new arrivals and leaving/revealing a player without losing the recognized account. Age-confirmation prompts still require the user to confirm on the official page.

The new bundle starts paused with all-live mode selected. CI explicitly starts with fixed-count settings and separately exercises all-live mode with an empty anonymous profile, recording video state/progress as diagnostic evidence. This is not a real account or points test.

## Paired diagnostics for a channel without credits

This build adds local observations while retaining the existing playback and recovery policy. It is not a demonstrated fix for missing credits. For this investigation keep all currently earning streams enabled; use this procedure instead of the single-channel baseline above.

1. When ready to switch builds, exit the previous Twitchterino from its tray menu, extract the new bundle into its own folder, and launch `& .\Start-WindowsValidation.ps1 -ProfileCommit 92cc2da5780e` to reuse the existing isolated test login. The profile ID selects local data; the build manifest identifies the application source.
2. Keep **Todas as lives online** and **Juntar pontos** enabled. Let the app run normally for about10 minutes, with Rodil and the other channels present. Do not toggle collection or manually reload players during this measurement.
3. In another PowerShell window in the extracted bundle folder, run `& .\Collect-PointsDiagnostics.ps1 -ProfileCommit 92cc2da5780e -Channels rodil -IncludeWatching -Samples 2` and copy the resulting JSON. `C1` is Rodil; the remaining aliases cover other currently opened players. Without `-IncludeWatching`, `-Channels` retains its explicit channel-filter behavior. The command only reads the point history and bundle manifest; it does not modify files or upload anything.

The local history includes current-balance availability, API-error boolean, page visibility/login-prompt observations, sample time, manual-player state and recovery flags/attempt timestamps. Version2 observes the official page's existing `SendEvents`/`sendSpadeEvents` requests to `gql.twitch.tv/gql`, with `GZIP_B64` event arrays, as well as legacy first-party `/track`. Version1 observed only the legacy endpoint and cannot establish whether the current client emitted watch events. Compressed input and output, event count, pending associations and concurrent response reads are bounded. The debugger cache is limited to2MiB per resource/8MiB total, and only up to64KiB of identified response data is processed. No events are generated or replayed.

Watch metadata is reduced to counters/booleans for login, live/ad/gated/muted state, and matches to the runtime's verified account and expected public channel. IDs and names are compared transiently and never written to diagnostic output. The observer records HTTP and `sendSpadeEvents.statusCode` separately, with a fixed error category rather than server messages. It discards obsolete-navigation results and uses a3sec read deadline. Raw URLs, request IDs, headers, bodies, event properties, account identifiers, cookies and tokens are not exported.

`networkEnabled`/`debuggerAttached` false, unclassified payloads, unavailable responses or stale page sample timestamps limit conclusions. Login/account-match metadata describes what the page transmitted; it is not independent proof of identity. An accepted event batch, HTTP200/204 or advancing video does not establish credited watch time. Counters accumulate per player window and disappear when that window is destroyed. Existing history rotates at5MiB. The exporter skips malformed lines, aliases channels and accepts only typed scalar values in documented fields; unexpected leaf values become null. Its `source` is the bundle's source, while each sample's `diagnosticsVersion` identifies the running diagnostic format. A batch with multiple telemetry operations reports the first rejection instead of hiding it behind a later success.
