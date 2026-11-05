# Session and All-Live Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stable account recognition and automatic playback of all listed live channels without manual opening.

**Architecture:** Main-process cookie reconciliation uses the current selected cookie and last verified token fingerprint; generations invalidate stale work. Main scheduling gains an all-live mode, and revealing a player does not reload it. Existing UI/preload/IPC boundaries carry only validated booleans and public session state.

**Tech Stack:** Existing Electron 45.2.1, Node tests, vanilla JS/CSS, PowerShell, Windows Actions.

**Spec:** `docs/superpowers/specs/2026-11-05-session-and-all-live.md`

## Global Constraints

- No tokens or fingerprints enter renderer state, logs or config.
- Preserve pinned destinations, redirect refusal, bounded requests and exact main-frame IPC authorization.
- Keep account-specific queues and reports protected until current identity verification.
- No merge or release; update the existing draft PR.
- Native execution already authorized; no additional design confirmation.

## Review Focus

- Same-value cookie overwrites must not display logout or destroy a valid store/player.
- A changed cookie must not attribute new redemptions to an old account.
- Explicit logout must cancel pending cookie checks and old polls.
- All mode must fill automatically and admit newly live channels without a selected chat.
- A reused profile must be confined to the current repository's existing validation directory.

### Task 1: Reconcile selected cookie and preserve player navigation

**Files:** `main.js`, `renderer/renderer.js`, `tests/application.test.cjs`, `tests/helpers/app.cjs`.
**Interfaces:** snapshot adds `sessionChecking`; selected-cookie fingerprint remains private. Poll generations allow current-session refresh over an obsolete poll. Existing `channel:show` reveals without reload.

- [ ] Write failing tests for unchanged selected-cookie rewrite, unchanged cookie event from another scope, changed-token account isolation, explicit removal, obsolete-poll overlap and reveal without reload; use mutable fake cookie storage at the external boundary.
- [ ] Run application tests and inspect expected failures before changing production behavior.
- [ ] Implement 100ms debounced selected-cookie reconciliation, generation-aware polling and session-checking UI; preserve existing security guards.
- [ ] Run the full Node suite and native Electron fixture; commit after passing.

### Task 2: All-live mode and clear controls

**Files:** `main.js`, `security/ipc.js`, `preload.js`, `renderer/index.html`, `renderer/renderer.js`, `tests/application.test.cjs`, `tests/ipc.test.cjs`.
**Interfaces:** config/snapshot `watchAll:boolean`, IPC `watchAll:set(boolean)`, preload `setWatchAll(boolean)`.

- [ ] Write failing tests: enable all mode and collection without revealing a channel; all eligible live channels start, a newly live channel starts on the next poll, and an offline channel stops. Verify fixed-limit mode and boolean argument rejection.
- [ ] Implement scheduling and visible controls. Fixed count is disabled in all mode; “Mostrar player” is separate from collection. No unrelated redesign.
- [ ] Run Node tests, native Electron fixture and syntax/diff checks; commit.

### Task 3: Windows evidence and retained local test login

**Files:** `scripts/validate-desktop.cjs`, `scripts/validation-config.cjs`, `scripts/package-windows-validation.cjs`, `scripts/Start-WindowsValidation.ps1`, `docs/WINDOWS_VALIDATION.md`.
**Interfaces:** launcher `-ProfileCommit <12 lowercase hex>` optionally selects an existing isolated profile; default is per-build. CI uses explicit empty-profile settings.

- [ ] Add the confined optional profile selector and document it; keep integrity checks before launch and no credential copying/uploads.
- [ ] Extend Windows UI validation to all-mode multiple-player startup and show/reveal behavior. Record anonymous scope, not authenticated points.
- [ ] Run the required workflow on the final source head; inspect actual test results and artifacts.
- [ ] Request a focused read-only review of session/race/account isolation and all-mode scheduling; resolve substantive findings.
- [ ] Update PR description and local delivery records with verified build link and remaining authenticated checks.
