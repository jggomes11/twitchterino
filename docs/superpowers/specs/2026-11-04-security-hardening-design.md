# twitchterino Security Hardening Design

Baseline: 0.1.2, commit `05b70cf0fb7c69a733fce4f4adb901a229b5b47d`. Target: `jggomes11/twitchterino`.

Status: approved by the user for implementation and fork PRs without further confirmations.

## Intent and scope

Maintain the user-owned public fork as an independent Electron application and reduce the session-token exposure identified in the security review. Keep the current product name, interface, one-account behavior, channel-point collection, browser playback, chat, and manual reward redemption. Preserve the original MIT license and author history. Do not integrate this work into Multi Idle or send changes to the original author's repository.

The user's established direction is to maintain separate forks rather than integrate these clients into the existing application. The technical choices below are proposals for review, not requirements previously supplied by the user.

## Approaches considered

1. **Targeted hardening within the existing Electron application — recommended.** Replace page-executed authenticated queries with requests from Electron's main process, authenticate IPC callers, validate privileged arguments, and prevent upstream updates from overwriting the maintained fork. This keeps the existing UI and session model. Compatibility with undocumented platform endpoints must be checked.
2. **Rewrite authentication and integration around newly registered official OAuth applications.** This would require platform client registrations and a feature-by-feature feasibility study; official APIs may not expose the same viewer-point functions. It is a separate project and is not proposed here.
3. **Patch only URL checks around injected scripts.** Smaller, but retains the dangerous dependency on the document receiving credential-bearing JavaScript. It does not meet the proposed requirement that these application query tokens stay out of page-executed code.

## Proposed design

### Credential-bearing requests

- The main process reads session cookies from the existing persistent platform partition. It constructs Authorization and, where needed, device and CSRF headers there.
- Use `session.fromPartition(PARTITION).fetch()` from the main process. Continue to use Chromium networking and the account's existing cookie session; do not use `net.fetch()` from the default session for authenticated queries.
- Stop embedding tokens in scripts passed to `executeJavaScript()`. Browser-side scripts used to inspect a player or click the Twitch bonus chest remain token-free.
- Twitch's GraphQL endpoint is fixed to `https://gql.twitch.tv/gql`. Kick requests are resolved against the fixed origin `https://kick.com` and restricted to the application's known API route forms. Reject alternate origins, credentials in URLs, protocol-relative paths, unexpected query/fragment components, path traversal, non-HTTPS destinations and arbitrary caller-supplied URLs before reading credentials or issuing requests.
- Reject HTTP redirects for credential-bearing requests. Do not rely on the response's `url` property to detect redirects: Electron documents limitations in that property. Keep TLS certificate verification and web security enabled.
- Use explicit timeouts that abort the underlying request, bounded response sizes, and sanitized error messages without tokens, cookies or full sensitive response bodies.
- Keep existing return shapes, including `{ status, json }`, so channel polling and chat continue to consume the same contract.
- The existing login window can remain navigable among permitted login providers because it no longer hosts application-injected credential-bearing queries. No new external service or account upload is introduced.
- Authentication/session changes and logout invalidate in-flight query results. Cancel pending authenticated queries before clearing cookies so stale responses cannot repopulate application state after logout. Existing user confirmation for logout remains.

### IPC and remote-page separation

- Centralize registration of application IPC handlers so every command first verifies that `event.sender` is the current main UI webContents and `event.senderFrame` is its current main frame at the exact local interface document.
- Identify the local document using a canonical `pathToFileURL()` value, not a string prefix or the generic `file:` origin. Reject subframes, other windows, destroyed frames, remote documents, and navigations away from the UI. Keep the current UI transport rather than introducing a custom protocol in this patch.
- Limit preload exposure to that UI document/main frame. Deny popups and remote navigations from the privileged local UI. Platform/login windows have no application preload or Node integration.
- Validate IPC arguments before any side effects. Use booleans for toggles; validated channel slugs and known-channel membership for channel actions; finite bounded values for numeric settings; bounded report rectangles and store queues; and strict chat identifiers.
- For Twitch chat, reject invalid channel names and CR/LF in identifiers. Normalize/restrict content using Twitch's existing 500-character bound. For Kick, accept numeric chatroom IDs only and bounded nonempty message strings; preserve valid current API behavior.
- Maintain existing scalar or structured result contracts for valid calls. Reject invalid calls with an ordinary sanitized IPC error and no filesystem, window, session, or network mutation.

### Fork identity and updates

- Set package repository/homepage references and the build publish owner to the user-owned GitHub fork. Preserve author attribution and explicit upstream links in the README.
- Disable automatic update checking/downloading/installing in this first security patch. Document manual source/build updates. This avoids both upstream replacement of the fixes and silently establishing an unsigned update channel.
- Do not introduce a signing certificate, purchase one, change user GitHub permissions, or publish a release in this phase. A later update-channel design must establish trusted signer identity and platform-specific validation before automatic updates are restored.
- Keep current visible names, application IDs, persistent partition names and data-directory behavior for this source-focused patch. Do not distribute a new installer yet: coexistence with an upstream installation and final application identity must be resolved before distributing binaries.
- Retain the explicit upstream partner-list URL as documented public configuration; it is not an update feed or executable content. Continue its existing slug validation and bounds.

### Dependency maintenance

- Re-run the full and production-only npm audits on each actual fork snapshot.
- Remove the affected locked minimatch versions through compatible build-tool upgrades or tested dependency overrides. The current advisory fixes the affected range at minimatch 11.0.1. Resolve all affected copies; do not automatically apply npm's suggested downgrade or a forced audit fix.
- Do not change the Electron major version as an incidental cleanup. If a compatible dependency update cannot remove the finding, document that limitation and seek a focused decision rather than hiding it.
- Update lockfiles reproducibly and keep dependencies out of version control.

## Validation and acceptance criteria

1. With an external login page active and a fake token present, authenticated queries use the selected main-process session and a fixed platform destination; no renderer execution receives the token.
2. Redirects, malformed URLs, traversal strings, hostile chat identifiers, malformed cookies, aborted requests and oversized responses fail without leaking credentials or triggering secondary requests.
3. A valid main-frame UI caller can use the bridge. A remote window, UI child frame, different local document or destroyed frame cannot invoke any handler.
4. Every current IPC command is registered through the sender guard; representative valid and invalid arguments prove that validation occurs before side effects. Test CR/LF identifiers, nonnumeric Kick chatroom IDs, invalid toggles, nonfinite rectangles and excessive queues.
5. Logout cancels authenticated requests and rejects stale results. No token enters app logs or IPC payloads.
6. Packaged startup cannot invoke the updater while the first-phase policy is disabled; package metadata does not point the maintenance/update configuration at the original author's releases.
7. The full audit no longer reports the known minimatch advisory, and production dependencies introduce no known advisory regression. Run project security tests and a packaging smoke check where the environment permits.
8. Test a real Electron runtime against controlled local HTTP fixtures with fake cookies/credentials to validate session, redirect, and abort behavior. No TLS bypass for the production hosts is permitted. A live login and actual points accrual require explicit user validation after the patch; automated/local tests do not establish those behaviors.
9. Preserve original licenses, credits, existing session directories and application features. Do not execute code from untrusted chat messages.

## Delivery and limitations

Prepare a dedicated `fix/security-hardening` branch and a pull request targeting `main` in this user-owned fork. Do not merge it, open a PR against upstream, publish a release, change repository visibility, or claim the app is completely safe. Report the exact tests run and any runtime/build/live-account checks that remain unverified.

Implement Twitchterino first because it prompted the original investigation, then apply and test the corresponding policy independently in Kickterino. This order is the proposed implementation choice. No new shared external package is needed; small local security modules and Node's built-in test runner are sufficient.

## References

- [Electron session.fetch](https://www.electronjs.org/docs/latest/api/session#sesfetchinput-init)
- [Electron main-process networking](https://www.electronjs.org/docs/latest/api/net)
- [Electron IPC sender validation](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages)
- [minimatch advisory GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)

