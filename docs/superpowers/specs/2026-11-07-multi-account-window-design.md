# Four Twitch accounts in one window

User steering supersedes the earlier four-process choice: opening another instance now replaces the previous window on their Windows machine. The initial four-opening observation is insufficient; RC2 is not an accepted four-account build. User requests adapting to multiple accounts in one instance, and previously authorized implementation and PRs without more confirmations. Continue inline under that authorization.

## Intent and constraints

One Twitchterino application window must manage four distinct Twitch accounts concurrently for the user's PokeIdle accounts. Selecting another account changes only the displayed controls/chat/report; collection in the other slots continues. Login is always performed in an official Twitch page. Preserve main-process-only authentication, isolated sandboxed UI, fixed destination transport, verified account/generation fences, bonus-only chest clicks and disabled automatic updates. No fabricated watch events, external account automation or concurrency-limit evasion.

Use the current Electron/Node stack and dependencies. Each slot has its own persistent Electron session partition, configuration, players, API client, timers, claim queue, IRC sender and reports. Default collection remains two players with rotation and automatic chests per account. Explicit account commands cannot address an arbitrary session, directory or URL. Logging out affects only that slot.

## Approaches

The previous four-process launchers remain an unsuitable delivery for the user after their corrected observation and are superseded. A global current-token switch would interrupt background work and allow asynchronous attribution errors, so it is rejected. A factory creating four independent account runtimes inside one Electron main process reuses the tested single-account behavior while keeping one UI, tray and process lock. The user selected the one-instance direction; the scoped-runtime design and four persistent slots are the implementer's choices.

## Architecture

`main.js` owns app lifecycle, one window/tray, window navigation policy, global startup registration and an account manager. `account-runtime.js` scopes the maintained account behavior in a factory. Slot1 retains `persist:twitch` and root config to preserve the selected installation's existing login and reports. Slots2–4 use fixed `persist:twitch-account-N` partitions and `accounts/account-N/config.json`. No cookies are copied from RC2/validation/Firefox or other userData roots. Explicit `TWITCHTERINO_DATA` support remains for isolated validation.

`account-manager.js` owns fixed slot identities, active selection and command dispatch. Each asynchronous operation captures a runtime, never a mutable global token. IPC validates a typed account command against that runtime's channel list, and only the trusted UI main frame may issue it. Events and snapshots carry account identity. UI switching rejects stale replies and account events, clears prior account chat/modal state, and shows four account buttons with login/collection state. Pending report results cannot appear under a different account.

The shared tray resumes/shows the one application and reports total collection; toggling collection in the UI affects only the selected slot. Global autostart starts all saved account slots through this one application. Second launch focuses the existing main window rather than promising another account window. Closing the UI retains tray behavior; Sair ends all slots.

## Acceptance

Unit/integration tests must prove four independent request sessions/configs/reports, background continuation across selection, isolated logout/cookie renewal/chest work, captured async dispatch, typed source-account IPC, stale-response rejection and known defaults. Preserve the existing security regression suite. Native Windows fixture must open one app window, exercise all four slots, store distinct fake partition cookies, quit/reopen naturally and confirm persistence; it never handles real credentials. Package one launcher with one-window instructions, remove obsolete four-process CI gate and source-pinned RC2 uploader. Build and artifact hashes must identify the exact new source. Actual four-account login/points/chest outcomes remain the user's Windows observation before stable publication. This is a new architecture, not a claim to fix the unknown fourth-process CI freeze.
