# Session Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. The user approved inline implementation and both fork PRs without further confirmations.

**Goal:** Prevent page-context exposure of application query tokens and unauthorized IPC operations in the maintained fork.
**Architecture:** Small CommonJS modules isolate main-process session requests, fixed platform endpoints, and IPC validation. Existing UI and persistent platform sessions remain; automatic updates are disabled.
**Tech Stack:** Electron 45.2.1, Node.js 24, CommonJS, node:test, electron-builder.
**Spec:** ../specs/2026-11-04-security-hardening-design.md

## Global Constraints

- Preserve product name, interface, one-account behavior, channel-point collection, browser playback, chat, manual rewards, MIT license and author history.
- Use session.fromPartition(PARTITION).fetch(); never inject application query tokens into renderer JavaScript.
- Twitch endpoint: https://gql.twitch.tv/gql. Kick origin: https://kick.com. Reject credential-bearing redirects.
- Disable automatic update checking/downloading/installing. Publish no release and merge no PR.
- Work only in the user-owned fork; target main with fix/security-hardening.
- Execute Twitchterino first, then apply and independently validate the matching policy in Kickterino.

## Review Focus

- Session-token replacement during cookie reads or streamed response consumption must discard stale results.
- Logout confirmation, in-flight polling, background chest windows and closed windows must not resurrect the old account's state.
- Numeric UI values arrive as input strings; valid settings must keep working while hostile or nonfinite values fail.
- A window navigation or child frame must not inherit an operational preload/IPC bridge.
- Electron main-process fetch may differ from renderer fetch on undocumented production endpoints; local evidence cannot prove live-platform compatibility.

### Task 1: Main-process authenticated requests

**Files:** Create security/requests.js, security/platform.js, tests/requests.test.cjs and tests/platform.test.cjs. Modify main.js.
**Interfaces:** createSessionClient({ getSession, getHeaders, resolveUrl, timeoutMs, maxResponseBytes }) returns { request(input, {method,body}), invalidate(), suspend(), resume(), generation }. request returns {status,json}. readCookie(session, origin, name), resolveTwitchUrl(input), resolveKickUrl(input), createPlatformClient(platform, getSession).
- [x] Write tests for fixed endpoint resolution, wrong-origin and traversal rejection before cookie reads, correct session/cookie headers, redirect refusal, bounded streaming, safe error messages, cancellation, and session changes during headers/body.
- [x] Run node --test tests/requests.test.cjs tests/platform.test.cjs; observe the missing transport fail.
- [x] Implement the request modules with a 20-second abort timeout, 2 MiB response cap, credentials include, redirect error and fixed endpoint validation.
- [x] Replace gql/kickFetch renderer execution with the platform client, invalidate on platform auth-cookie changes, and suspend/cancel before logout. Gate polling results by session generation.
- [x] Run the request tests and an application-level fake-session regression reproducing the previous token-in-page condition. All must pass.
- [x] Commit the independently tested request boundary.

### Task 2: IPC, preload and UI-window boundary

**Files:** Create security/ipc.js, tests/ipc.test.cjs, tests/application.test.cjs. Modify main.js and preload.js.
**Interfaces:** createIpcRegistrar({ipcMain,getMainWindow,uiDocument,platform,getContext}) returns handleIpc(channel,handler); validateIpcArgs(channel,args,{platform,channels,chatroomIds,viewport}) returns normalized arguments.
- [x] Write tests for exact UI document/main-frame authentication, remote windows, subframes, destroyed frames, no side effects on invalid callers, and all registered commands.
- [x] Write argument tests: booleans; platform slug syntax/membership; numeric settings; 500-character chat content; CR/LF identifiers; numeric Kick chatroom IDs; report rectangles within viewport; queues of at most 100 unique known channels; valid bonus selections.
- [x] Run node --test tests/ipc.test.cjs tests/application.test.cjs and observe the absent protection fail.
- [x] Implement one guarded registrar for every handler, sanitized failures and per-command validation. Restrict preload exposure using the exact UI URL passed as a sandbox-safe additional argument. Deny UI navigation and popups, keeping explicit sandbox settings in platform windows.
- [x] Run the full node --test suite; valid UI flows and all rejected boundary cases must pass.
- [x] Commit the independently tested IPC boundary.

### Task 3: Fork update policy, dependencies and release readiness

**Files:** Modify package.json, package-lock.json, README.md, docs/index.html as needed. Add tests/policy.test.cjs, tests/electron-fixture.cjs and scripts/test-electron.cjs.
**Interfaces:** npm test runs node --test tests/*.test.cjs; npm run test:electron runs the controlled Electron fixture. Packaging includes security/**/*.
- [x] Write policy tests for no updater startup path, user-owned package/update metadata, included security modules, preserved app identity and original license.
- [x] Run the policy tests and observe the existing upstream updater configuration fail.
- [x] Remove the runtime updater import/dependency/startup hook; retain fork publish metadata, disable auto updates and document independent-fork/manual-update status.
- [x] Resolve vulnerable minimatch copies with compatible tested build-tool changes or targeted overrides to 11.0.1 or newer; never override unrelated legacy major versions globally.
- [x] Run npm audit --json and npm audit --omit=dev --json; require removal of the known advisory and no production regression.
- [x] Run npm test, the controlled real-Electron session/redirect/abort fixture where available, and electron-builder --linux --dir --publish never as a packaging smoke check. Report environment limitations precisely.
- [x] Commit the policy/dependency changes, request one fresh review of the complete branch, fix important findings with regression tests, then create and attach the fork PR. Do not merge or release.


Local implementation checks passed: 29 Node tests, the controlled Electron transport fixture, zero full/production npm advisories, and Linux directory packaging with security-module ASAR inspection. Final branch review and PR creation are recorded separately after this checkpoint; live-account and Windows UI validation remain unperformed.
