# Four independent Twitch accounts on Windows

The user selected four independent windows. Each persistent profile represents one Twitch account for one PokeIdle account. Keep the existing token/session security, account reporting and verified automatic bonus-chest behavior. Each window defaults to two live players, with the existing priority/rotation policy; opening more players does not promise more credited channels. Credentials are entered only in the official Twitch window.

## Approach

Complete the existing release/v0.1.3 four-launcher distribution (selected). It isolates the entire Electron userData directory and reuses the tested single-account application. An integrated four-account UI was considered and declined because it would require isolating the currently global account/session/controller state. No duplicated application folders or changes to authentication are required.

## Delivery contract

- Directory-portable ZIP, four stable launchers Abrir-Conta-1.cmd through Abrir-Conta-4.cmd, profiles under LOCALAPPDATA/Twitchterino-Profiles/Conta-N. A different launcher must not reuse another profile's cookies or reports.
- Four app windows coexist. Closing/restarting one preserves the others. Reopening an already running profile must not create a second writer to its browser data.
- Defaults stay watchAll=false, maxWatchers=2, rotation=true, farming=true, autoChest=true. Update distribution instructions accordingly; preserve existing local user settings.
- Keep dependencies pinned, MIT attribution, disabled automatic updates and existing installer identity. No inclusion of PR3 telemetry/retry experiment.
- Native Windows CI validates empty independent profile storage, first use, duplicate profile launch and independent shutdown. No credentials, real account login or point awards are claimed by CI.
- Diagnose the existing native duplicate-launch timeout from actual evidence before product changes. A transient packaging504 is distinct from a product regression.
- Preserve the local pending preview warning. An old failed preview is never represented as stable. A stable release requires successful native validation of the delivered source and verified assets. Earlier user authorization covers implementation, PR updates, merge and release without renewed confirmations.
