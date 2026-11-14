# Account Controls Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline.

**Goal:** Move connection controls into account cards and start collection automatically in Twitchterino and Kickterino.

**Architecture:** Render account cards with separate selection and settings controls. Explicitly address logout by account ID in both apps through the existing validated dispatcher, preserving active selection. Both apps reuse their existing four-account sessions.

**Tech Stack:** Electron, vanilla JavaScript, CSS, Node tests, native Electron renderer checks.

**Spec:** `docs/superpowers/specs/2026-11-14-account-controls-design.md`

## Global Constraints

- Disconnected slots say exactly “Adicionar conta”; connected slots alone expose a settings menu containing “Desconectar”.
- Keep other accounts and the current selection intact when disconnecting a background profile.
- Preserve prior changes in both repositories; add no dependencies.
- Keep the existing confirmation and session cleanup without opening the login window.
- Collection starts automatically on launch, including previously paused profiles, with other collection preferences preserved.

## Review Focus

- Selection changes while a logout confirmation is pending must not retarget logout.
- A background logout must refresh all cards without replacing the displayed account.
- Session checking must not expose a stale account menu or start duplicate logins.
- Polling must preserve open menus and keyboard focus.
- Menu dismissal and disconnected states must work in both apps and narrow windows.

## Tasks

- [x] Add a failing preload test for explicitly addressed logout and invalid account IDs. Implement `logoutAccount(id)` through the guarded account dispatcher and run Node tests.
- [x] Add the reusable account-card renderer and styles; integrate Twitch selection, login, and disconnect callbacks. Remove obsolete global controls and update desktop validation to use account cards.
- [x] Integrate the four Kick account cards with explicitly addressed logout on the updated 0.3.2 base.
- [x] Verify native renderer interactions for connected, disconnected, checking, pending, cancelled and failed actions, cross-account races, menu dismissal and narrow layouts. Run the Twitch suite, Electron transport checks, syntax checks and diff checks. Review the final implementation.

- [x] Remove the collection toggle, enable collection on startup for all four saved profiles, and update validation scripts and documentation. Cover the paused-profile migration and unauthenticated startup with regression tests.

## Verification

- Twitch: `npm test` — 124 passed; `npm run test:electron` passed.
- Kick: `npm test` — 105 passed; `npm run test:electron` passed.
- Native fixtures use the actual preload and renderer and cover four cards, explicit logout targeting after a profile switch, slot login, cancellation, failures, checking state, polling while a menu is open, focus restoration, outside clicks, Escape, panel overlap and narrow layouts.
- Independent review completed. Focus restoration and the observed settings click propagation issue were reproduced and fixed; the responsive Twitch bonus panel no longer blocks profile controls. No deferred findings.
- Source bases fast-forwarded to current origin/main after the user confirmed that Kick already has four profiles. Prior title and Kick channel-header changes were preserved.
