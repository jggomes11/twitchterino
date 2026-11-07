# Four Account Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver four independent persistent Twitch windows using the existing single-account client and two-player collection defaults.

**Architecture:** Complete release PR2 without PR3. Each launcher selects a unique userData root; the existing Electron single-instance guard protects each profile. Diagnose native fixture failures before changes.

**Tech Stack:** Electron45.2.1, Node24, electron-builder26.18.0, Windows2022 native CI, directory-portable ZIP.

**Spec:** docs/superpowers/specs/2026-11-07-four-account-release-design.md

## Global Constraints

Four stable profiles; two live players by default; token/session/security and automatic chest behavior retained; no new authentication code or PR3 experiment. No credentials in CI. Preserve pending preview warning and MIT attribution. Existing user settings survive. Existing authorization covers PR2 completion and release.

## Review Focus

- Different launcher must select distinct persistent cookie/report storage.
- Repeated launcher must not create another writer or hang indefinitely.
- Closing one window must preserve other profiles and permit reopening the closed profile.
- Distribution instructions must keep two-stream collection; installer/default profile remain separate.
- Stable assets must come from the verified source, not the older failed preview.

## Task1: Complete account-window distribution

**Files:** scripts/package-windows-release.cjs, scripts/validate-profiles.cjs, scripts/profile-process.cjs, tests/profile-process.test.cjs, tests/application.test.cjs, README.md, .github/workflows/windows-validation.yml. Modify runtime only if native evidence establishes a runtime defect.

**Interfaces:** Consumes existing TWITCHTERINO_DATA profile selection and main.js profile lock. Produces four stable launcher files, LEIA-ME.txt and native profile-validation.json with explicit checks.

- [ ] Establish baseline npm test (64tests) and re-run native latest source once after confirmed upstream packaging504. Read logs and classify any remaining failure.
- [ ] Correct packaged collection instructions to watchAll=false/maxWatchers2/rotationtrue, farming and automatic chests enabled. Preserve pending preview warning.
- [ ] If native lifecycle fails, reproduce a minimal same-profile/different-profile control using actual Electron and capture exact startup/exit boundary; write a failing regression before the smallest proven fix. No fourth speculative timing workaround.
- [ ] Verify distinct first-use storage, duplicate exit and close-one/reopen preservation on native Windows; add meaningful isolation/continuity assertions to the fixture where missing.
- [ ] Run full Node suite, Electron transport, syntax/YAML/diff checks; commit and update existing PR2. Record actual CI result, not inferred readiness.

## Task2: Verify and distribute

**Files:** .github/workflows/windows-validation.yml, release artifacts/notes, existing PR2.

**Interfaces:** Consumes native-passing source and installer/portable ZIP. Produces source-pinned SHA256-verified release assets and concise Portuguese setup instructions.

- [ ] One fresh whole-branch reviewer checks selected design, security boundaries, profile isolation and delivery instructions; fix Important/Critical with RED/GREEN, record remaining minors.
- [ ] Build installer and directory ZIP on native Windows without publishing; verify artifact hash, packaged manifest/source modules, four launchers and instructions.
- [ ] Merge authorized PR2 only after required checks pass, then publish an accurately labelled release using verified assets; retain any real-account test limitation in release notes.
- [ ] Report download, four official-window logins, persistent profile reuse and collection settings. Do not claim four-account real credits before user testing.
