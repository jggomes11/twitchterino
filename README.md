# Twitchterino

Independent security-maintenance fork of [ViinniSantoos/twitchterino](https://github.com/ViinniSantoos/twitchterino), originally created by VinniiSaantos. The original MIT license, copyright and Git history are preserved.

Twitchterino is an Electron client for Twitch chat and PokeIdle channel-point tracking. It retains the existing interface, channel rewards, background video playback, bonus-chest collection, notifications and four isolated Twitch accounts in one application window.

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

Sign in once in the official Twitch window. Collection starts automatically whenever the app opens with a connected account. Enable **Todas as lives online** in settings to watch all online channels from your list; newly live channels are picked up by polling. Selecting a channel changes the chat. **Mostrar player** reveals an existing player without reloading it and is not required for background playback.

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

Windows x64 builds are published manually in this fork's [releases](https://github.com/jggomes11/twitchterino/releases). Executables are unsigned, and automatic updates remain disabled. Downloads from the original author's project do not contain the fork's changes.

Download **Twitchterino-Setup.exe**, run the installer, then open Twitchterino from its Windows shortcut. The installer is the application distribution; releases no longer offer a portable application ZIP. JSON/text assets are build and integrity records. GitHub's automatic source-code archives are separate from the Windows installer.

Use only as many account slots as you need, up to four. One or two accounts are sufficient; the four slots are optional. Sign in to a different Twitch account in each slot you use, through its official login window. Each slot has independent cookies, channels, settings, players, chests and reports, and selecting another account leaves other collectors running. Unauthenticated slots do not start collection players. Memory/network consumption grows with active players.

Fresh accounts use **Todas as lives online** off, **Limite de lives: 2**, **Foco em bônus** and **Pegar baú sozinho** on. Collection starts automatically on launch, including profiles previously paused; other existing settings are preserved. Twitch decides whether points are credited. Use one active app per Twitch account when checking points, including older versions.

The installer keeps the original application identity and default Electron user-data profile; slot1 retains that profile's existing login/configuration. Earlier RC/portable launchers used separate profiles and are not imported into the installed app. Users switching from the portable package may need to sign in again; keep the old profile until access is confirmed. Normal installer updates retain the installed profile. Quit through **Sair** in the tray before upgrading. Do not upload profile directories, cookies or tokens.

Google may reject sign-in inside the embedded Electron window. This version supports the direct Twitch username/password path. Social-only accounts may need Twitch Account Recovery/support to enable a Twitch password; password reset can revoke existing sessions and third-party authorizations. No Google protection bypass or browser-cookie import is provided.

The partner list remains public configuration fetched from the original author's GitHub Pages URL with the existing slug validation. It is separate from application updates.

The user confirmed real Windows login, point accrual and automatic bonus collection in the maintained single-account base. The new automated fixture uses four empty partitions and fake persistent cookies in one application; it does not authenticate four real accounts or prove their point awards. The user confirmed real multi-account operation on Windows and explicitly accepted two-account validation as sufficient. Four-real-account point/chest awards were not tested. See the release/PR validation notes for actual outcomes. RC2 was not accepted for four accounts after the user's corrected window-replacement report.

## Attribution

Original project: [ViinniSantoos/twitchterino](https://github.com/ViinniSantoos/twitchterino). Original author: VinniiSaantos. Maintenance fork: [jggomes11/twitchterino](https://github.com/jggomes11/twitchterino). License: [MIT](LICENSE).

## Documentação técnica do estado atual

A [base técnica](docs/technical/README.md) reúne arquitetura, regras de negócio rastreáveis, integrações, persistência, testes, inventário e um protocolo de medição de desempenho. Descreve a versão publicada e separa evidência de código/testes de consumo de recursos ainda não medido.
