# Multi-account Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. User already authorized inline implementation without further confirmation.

**Goal:** Run four independently authenticated Twitch accounts in one Twitchterino window.

**Architecture:** Extract the maintained single-account runtime into a scoped factory. One app manager owns four fixed partitions, one UI/tray and typed account-bound dispatch; switching UI selection does not restart runtimes.

**Tech Stack:** Existing Electron45.2.1, Node24, vanilla JavaScript, Node tests; no new dependencies.

**Spec:** docs/superpowers/specs/2026-11-07-multi-account-window-design.md

## Global Constraints

- Four fixed persistent slots; two collection players and rotation/chests per account by default.
- Main-process authentication only; preserve destination, account, generation and bonus-click safeguards.
- Slot1 retains root config/persist:twitch; no automatic profile/cookie import from other roots.
- One native app process/window/tray and global startup entry; selected-account controls do not pause other slots.
- Preview first; stable release requires actual four-account Windows outcome; no further implementation approval.

## Review Focus

- Delayed account-A actions/events after selecting B must retain A ownership and not replace B's UI.
- Account-A logout or token renewal must not stop B's players, report or claim work.
- OAuth/popup windows must inherit their originating account partition, never the selected UI account.
- New slots must have fresh nested settings/report objects; no shared mutable defaults.
- Existing installation data must remain in slot1, with no credentials exposed by aggregate snapshots or diagnostics.

### Task1: Isolated runtimes and account routing

Files: create account-runtime.js/account-manager.js/tests/multi-account.test.cjs; modify main.js/security/ipc.js/tests/helpers/app.cjs/package.json.
Interfaces: createAccountRuntime({id, partition, dataDirectory, getMainWindow, emit, onChanged, showMain, isOpenAtLogin, setOpenAtLogin}) returns {id,partition,start,snapshot,poll,invoke,getIpcContext}; createAccountManager({runtimes,initialAccountId}) returns {select,snapshot,invoke,acceptEvent,activeId}.
- [ ] Write failing tests for four session clients, independent configs/reports, background players after selection, isolated logout/token change, delayed command ownership, nested typed/source-account IPC and partition ownership.
- [ ] Run focused tests and record RED.
- [ ] Extract account code without rewriting verified transport/chest/session logic, implement factory/manager and one shell; reuse actual account1 behavior in existing application tests.
- [ ] Run preserved regression suite plus focused tests GREEN, inspect extraction diff and commit.

### Task2: Account selector and stale UI protection

Files: modify preload.js/renderer/index.html/renderer/renderer.js/renderer/features.css; create security/account-view.js and tests/account-view.test.cjs.
Interfaces: tt.selectAccount(id), tt.account-bound existing actions, identity-tagged snapshots/events; view guard accepts a state only for its requested account.
- [ ] Write/run RED for delayed account-A snapshot/report/chat after selection B and rapid successive selection.
- [ ] Add four account buttons/names/status, selection control and UI guards; preserve other slots' background work and clear old account chat/modals on selection.
- [ ] Run UI guard and full tests GREEN, inspect UI in Electron/browser and commit.

### Task3: Windows delivery and native fixture

Files: create scripts/validate-accounts.cjs; modify scripts/package-windows-release.cjs/scripts/validate-desktop.cjs/.github/workflows/windows-validation.yml/README.md/docs/releases/v0.1.3.pt-BR.md; update obsolete profile-fixture tests to current account contract.
- [ ] Write/run RED for one-launcher package contract and native fixture state/persistence requirements.
- [ ] Replace four-process gate with one-app/four-partition CDP fixture: defaults/metadata, distinct fake cookies, selection/background preservation, duplicate focus, natural quit/reopen and cookie persistence. Keep failed assertions as failures, cleanup only in finally.
- [ ] Remove pinned RC2 upload path; package new runtime modules and one portable launcher with source manifest.
- [ ] Run tests/audits/native Windows build; verify asset/source/checksums, preserve accurate failures and commit.

### Task4: Review and authorized preview delivery

- [ ] One fresh whole-branch review per inline workflow; fix relevant findings with observed RED/GREEN, no extra review loop.
- [ ] Update PR2 title/body around final single-window behavior, evidence and remaining real-account limits; attach PR.
- [ ] Produce and verify a clearly labelled new prerelease candidate from the exact build source. Do not reuse RC2 binaries.
- [ ] Provide concise Windows test instructions for four official logins and independent balances/points. Record actual user outcomes before stable merge/publication; do not claim success from fake-cookie tests.
