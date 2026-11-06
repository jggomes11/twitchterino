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

## Current Twitch transport correction

User history after the first diagnostic build shows exactly two of five playing channels receiving seven +10 increments at five-minute intervals over38min, with two +50 bonuses each. Three channels show no increase. Both successful and stalled players expose only one legacy unclassified204 request. This is compatible with a concurrency restriction, not proof of its cause or scope.

The current public Twitch frontend (`https://assets.twitch.tv/assets/95120-772ed527aead1b64d549.js`, SHA256 recorded in the external investigation evidence) sends regular events to `https://gql.twitch.tv/gql` using `mutation SendEvents($input: SendSpadeEventsInput!){sendSpadeEvents(input:$input){statusCode}}`. Input has `encoding:GZIP_B64`, `repository:twilight`, and gzip/base64 JSON event arrays. The previous legacy-only observer does not observe that transport. Correct the observer without changing playback or issuing any telemetry.

- Recognize only this telemetry GraphQL field; ignore other GraphQL operations. Decode at most64KiB of request input into at most256KiB, inspect at most100 events across a batch, retain at most128 transient request associations.
- Record bounded counts and last observed watch-state booleans: logged-in, live, ad-playing, playback-gated, muted, expected-account match and expected-channel match. Compare IDs transiently against the verified runtime account/public channel; never persist those IDs, names or event properties. Invalid/missing values are unknown.
- Read only identified telemetry responses through the existing debugger, with a3sec timeout, at most4 concurrent reads and at most64KiB processed response data. Cap debugger response caching at2MiB/resource and8MiB total, matching the existing application transport's per-response budget. Record HTTP status, numeric `sendSpadeEvents.statusCode`, GraphQL-error count and a fixed error category. Discard results from an obsolete navigation/destroyed window; no response content or messages are stored.
- Retain legacy support and explicitly expose missing/unclassified inputs or responses. Increment history diagnosticsVersion to2. An accepted event batch or matching metadata still does not prove credited watch time.
- Extend the typed, anonymous exporter and real local-only Electron fixture to exercise the actual compressed GraphQL format. Keep the PR draft and do not claim a payout fix or a documented numeric platform limit from the observed two earners alone.
- Add optional `-IncludeWatching` to the extractor so a selected target keeps aliasC1 and current controls are included automatically; existing explicit-filter behavior stays the default.
