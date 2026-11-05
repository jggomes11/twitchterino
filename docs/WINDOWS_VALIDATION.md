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
2. Keep the simultaneous-live setting at 1 and rotation off. For Twitch, leave automatic bonus-chest collection off so it does not confuse the measurement.
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

