# Twitchterino

Independent security-maintenance fork of [ViinniSantoos/twitchterino](https://github.com/ViinniSantoos/twitchterino), originally created by VinniiSaantos. The original MIT license, copyright and Git history are preserved.

Twitchterino is an Electron client for Twitch chat and PokeIdle channel-point tracking. It retains the existing interface, channel rewards, background video playback, bonus-chest collection, notifications and one-account session model.

## Security-maintenance changes

- Application API queries use the platform session from Electron's main process. They no longer inject query tokens into a navigable page.
- Credential-bearing requests have fixed destinations, reject redirects, abort on timeout/session replacement and limit response size.
- Logout cancels queued stores and pending account work. Verified account changes reset balance baselines and archive/restore each account's reports; ordinary token rotation retains its baseline. Legacy unlabelled reports are adopted by the first verified account.
- Every application IPC command authenticates the exact local UI main frame and validates its arguments before side effects.
- The preload bridge is unavailable to remote pages and child frames; the privileged UI cannot navigate to remote sites or open remote popups.
- Automatic update checking, downloading and installation are disabled. The fork metadata points to this repository; there is no signed automatic-update channel yet.
- Known vulnerable minimatch build-tool versions are replaced with a version-qualified override that preserves unrelated legacy versions.

The platform's own web pages still handle their normal website login and cookies. These changes do not certify the application or its external services as vulnerability-free.

## Automatic playback

Sign in once in the official Twitch window. Enable **Todas as lives online** in settings and turn on **Juntar pontos** to start the online channels from your list automatically; newly live channels are picked up by polling. Selecting a channel changes the chat. **Mostrar player** reveals an existing player without reloading it and is not required for background playback.

Disable all-live mode to use **Limite de lives** and bonus prioritization. Age-confirmation prompts still require confirmation on the official page. Verify actual point awards by comparing each channel's balance.

For isolated Windows validation bundles and reuse of an existing local test login, see [Windows validation](docs/WINDOWS_VALIDATION.md).

## Run and test from source

Use Node.js 22.13 or newer (Node.js 24 is used for validation).

```sh
npm ci
npm test
npm run test:electron
npm start
```

Electron 45 downloads its binary on first use when it is not already installed. The optional `test:electron` command runs a controlled local transport fixture using fictitious credentials and a temporary browser profile. On Linux only, its headless fixture disables the Chromium sandbox to accommodate restricted test environments; product startup keeps the existing sandbox settings.

For a local packaging check without publishing:

```sh
npm run dist:linux -- --dir --publish never
# On Windows:
npm run dist -- --publish never
```

The packaging configuration includes the main-process security modules. Tests exercise request routing, redirect refusal, timeouts, session invalidation, IPC authentication, argument bounds, preload exposure and updater-disabled startup.

## Distribution and session compatibility

This maintenance change does not publish reviewed installers or releases. Downloads from the original author's project do not contain the fork's changes. Update maintained builds manually from reviewed source until a separate trusted signing/update policy is established.

The existing application ID, profile directories and visible name are retained. Resolve installer coexistence and final distribution identity before installing a fork build alongside the original. Do not commit cookies, tokens, browser profiles or personal session data.

The partner list remains public configuration fetched from the original author's GitHub Pages URL with the existing slug validation. It is separate from application updates.

Live Twitch login, live point accrual and Windows UI behavior require manual validation with the maintained build. Controlled tests with fake sessions do not establish those behaviors.

## Attribution

Original project: [ViinniSantoos/twitchterino](https://github.com/ViinniSantoos/twitchterino). Original author: VinniiSaantos. Maintenance fork: [jggomes11/twitchterino](https://github.com/jggomes11/twitchterino). License: [MIT](LICENSE).
