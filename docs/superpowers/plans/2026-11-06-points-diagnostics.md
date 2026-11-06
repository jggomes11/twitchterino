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

- [x] Write and run fixture tests for paired selection/anonymization, skipped malformed final line and safe missing-profile output; observe RED before implementation. Local PowerShell7.6.9 RED/GREEN verified; Windows5.1/7 execution in CI.
- [x] Implement exporter, package it and add native workflow verification. Document evidence limits and exact profile-reuse commands.
- [ ] Run all checks, request one fresh whole-change review, address important findings with RED/GREEN tests, push existing branch and verify Windows artifact/source hashes. Keep PR draft and provide diagnostic test instructions.

### Task3: Observe the verified current GraphQL telemetry transport

**Files:** modify `security/points-diagnostics.js`, `main.js`, Node observer/integration tests, native Electron fixture, PowerShell exporter/privacy fixture and Windows validation docs.

**Interfaces:** extend `createWatchDiagnostics({ now, channel, getExpectedChannelId, getExpectedAccountId, readResponse })`. `observe` may return a caught promise for an identified telemetry response; all output remains bounded numeric/boolean/enum metadata. Existing controller supplies a3sec-limited debugger response reader. History schema becomes diagnosticsVersion2; exporter schema stays1.

- [x] Add RED regressions for real SendEvents/GZIP_B64 requests, unrelated GraphQL exclusion, decompression/batch limits, ephemeral account/channel comparison, accepted/rejected/error responses, unavailable bodies and obsolete-navigation reads.
- [x] Implement bounded current-transport parsing and passive response observation, wire verified account/public-channel comparisons and history version2, then run focused and full Node tests. Local97/97 passed.
- [x] Extend native local-only Electron fixture and typed PowerShell export tests for new fields/format, observe the new integration/export assertions fail before wiring and pass afterward. IncludeWatching is additive and includes only actual boolean watching states. Native Linux and PS7 passed.
- [ ] Obtain one fresh review of this transport correction, fix important findings via RED/GREEN, run native Windows and verify the pinned artifact/source before delivering a new diagnostic build. Payout cause stays open until real evidence distinguishes rejection, bad metadata and platform eligibility.
