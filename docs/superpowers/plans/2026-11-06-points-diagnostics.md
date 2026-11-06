# Points diagnostics implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gather private local evidence comparing a stalled player and an earning player without changing their scheduling.

**Architecture:** A bounded passive debugger observer supplies sanitized counters to the existing point-history writer. A standalone PowerShell extractor produces an allowlisted, anonymized report from the same Windows profile.

**Tech Stack:** Existing Electron45, CommonJS/Node24 and Windows PowerShell5.1+; no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-points-diagnostics-design.md`

## Global Constraints

- Preserve current playback/authentication/scheduling; do not send or forge telemetry.
- No cookies, tokens, request content, account IDs or raw URLs in diagnostics.
- Observer input64KiB, max100 events and128 pending IDs; existing5MiB history rotation.
- Keep PR3 draft and do not claim real-credit success from fixture results.

## Review Focus

- Telemetry can arrive without postData; record classification limits instead of inferring missing watch time.
- Redirects, incomplete requests and reloads must not cause unbounded state or duplicate responses.
- Manually shown players have stale DOM samples; preserve and expose sample age/manual status.
- Partial API balances cannot be confused with a current finite balance.
- Corrupt final log lines, missing profiles and unexpected extra fields must not disclose profile content.

### Task1: Passive observer and local history

**Files:** create `security/points-diagnostics.js`, `tests/points-diagnostics.test.cjs`; modify `main.js`, `tests/helpers/app.cjs`, `tests/electron-fixture.cjs`.

**Interfaces:** `createWatchDiagnostics({ now })` returns `observe(method, params)`, `navigation()`, `attached(value)`, `enabled(value)` and `snapshot()`. Main stores observers by player window in a WeakMap; `logHistory` adds an allowlisted diagnostic object.

- [x] Write behavior tests for JSON/form-base64 `minute-watched`, endpoint spoofing, bounded malformed input, responses/failures and no serialized secrets. Run and observe failures against absent behavior.
- [x] Implement the pure observer, wire the existing debugger, expose page/current-balance/recovery observations in history. Add real-main integration tests and a native Electron observer fixture.
- [x] Run focused tests, `npm test` and `npm run test:electron`; inspect evidence and commit. Local83/83 and transport passed; native Windows metrics fixture runs with Task2 build.

### Task2: Read-only Windows paired-channel report and build

**Files:** create `scripts/Collect-PointsDiagnostics.ps1`, `scripts/test-points-diagnostics.ps1`; modify `scripts/package-windows-validation.cjs`, `.github/workflows/windows-validation.yml`, `docs/WINDOWS_VALIDATION.md`.

**Interfaces:** extractor parameters `-ProfileCommit <12hex>`, `-Channels <slug[]>`, `-Samples <1..120>` default20. Emits JSON: bundle source, profile prefix, report schema, allowlisted per-sample modes and channels aliased by selected order. Reads no profile files except points-log.jsonl.

- [ ] Write and run native Windows fixture tests for paired selection/anonymization, skipped malformed final line and safe missing-profile output; observe RED before implementation.
- [ ] Implement exporter, package it and add native workflow verification. Document evidence limits and exact profile-reuse commands.
- [ ] Run all checks, request one fresh whole-change review, address important findings with RED/GREEN tests, push existing branch and verify Windows artifact/source hashes. Keep PR draft and provide diagnostic test instructions.
