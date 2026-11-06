# Local diagnostics for missing watch credits

The user confirmed source63ab71a, farming/all-live mode enabled, and a stalled Rodil balance in both the app and Firefox. The same-profile control earns periodic points. Rodil's public settings enable points. A controlled reload of Rodil alone did not restore credits; the control continued earning. The cause of missing credits remains unknown.

The user authorized implementation/PR updates in this session without further confirmations. This is diagnostic work within that authorization, using the existing isolated late-live branch. It does not change playback, scheduling, authentication, request blocking, rewards or release behavior.

## Approach

Further reload policies have no evidence of benefit. Existing point-history fields omit recovery eligibility and first-party watch telemetry. Add a passive observer to the debugger already attached to each player, enrich the existing local history, and ship a read-only anonymized extractor in the Windows validation bundle. Reuse existing tooling and dependencies.

## Data contract

- Observe only HTTPS `/track` requests on `spade.twitch.tv`, `spade.sci.twitch.tv` and `beacon.twitch.tv`.
- Keep aggregate request/response/failure counts, HTTP status, timestamps, navigation count and the count of literal `minute-watched` events. Event classification is in memory only; cap encoded/decoded input at64KiB, inspect at most100 events and retain at most128 pending request IDs.
- Never persist or log request IDs, URLs, headers, bodies, event properties, cookies, tokens or account identifiers. Request IDs are kept transiently only to associate responses. An accepted HTTP response does not prove credited watch time.
- Log debugger/network-observer availability, page visibility/focus/login-prompt observations, sample time, fresh-balance availability, API-error boolean, points-enabled setting, recovery flags/count/times and manual-window state. DOM observations do not establish authenticated account identity.
- Preserve the existing5MiB history rotation. Keep diagnostics local; add no network requests, subscriptions, exports or uploads automatically.
- The PowerShell extractor selects an existing validation profile by12-hex prefix (or the newest history), reads only points-log.jsonl and the bundle build manifest, and emits allowlisted fields with C1/C2 aliases. Leaf values must be booleans, finite bounded numbers, enumerated strings or valid timestamps; unexpected objects/arrays/strings become null. It never changes the profile. Optional channel selection allows paired healthy/affected sampling.

## Verification

Behavior tests must cover event formats, malformed/oversized input, endpoint spoofing, bounded pending requests, response/failure attribution and serialization without sentinel secrets. Exercise real main.js logging/observer integration and demonstrate that passive observation preserves playback. Run the PowerShell extractor against fixtures on Windows, including privacy and truncated-last-line cases. Run the project suite, native Electron transport/observer fixtures and Windows packaging/launcher checks. Keep the existing PR in draft; this build gathers evidence and is not a proven credit fix.
