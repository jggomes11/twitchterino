# Stable session and automatic playback of all live channels

The user reports real point accrual, intermittent apparent logout after showing a player, and confusion about starting multiple streams. They explicitly chose opening all listed live channels simultaneously, including channels that become live later. The existing approval authorizes implementation and PR updates without further confirmations.

## Approach

Confirm the selected auth cookie after its native replacement events settle. Keep only a SHA256 fingerprint of the last verified token in main-process memory. Invalidate old work immediately, but distinguish checking from signed out. An unchanged selected cookie restores the same verified account without closing windows or showing a logout. A changed token closes account-specific windows before remote identity verification; explicit removal/logout still clears runtime immediately. Retain generation checks and reject unverified redemption accounting. A newer generation must not lose its refresh behind an older in-progress poll.

Alternatives considered: continuing to infer logout from native events leaves false transitions; delaying a full reset for every event still needlessly interrupts unchanged sessions. Comparing the cookie actually selected by the API avoids both and handles multiple cookie events. No tokens or fingerprints enter renderer state, logs or config.

Showing a player must reveal the existing window without reloading it. Automatic playback must start independently of which channel is selected in the chat. An explicit `watchAll` boolean overrides the fixed simultaneous-live limit for listed eligible live channels. Newly online channels are picked up by polling; offline channels stop. Fixed-limit mode remains available. The new test bundle enables all mode when collection is turned on; CI begins with collection off and tests multiple real players with an empty profile.

UI: add “Todas as lives online”; disable the fixed count in all mode; call the reveal action “Mostrar player”; show session checking distinctly from login and show collection paused/starting distinctly from a full fixed-limit queue. Opening every stream does not establish platform point awards in every stream.

Validation launcher: optionally accept a 12-hex existing profile commit, confined to this repository's isolated validation-profile root, so the user can reuse their existing local test login without copying or exporting credentials. Default remains a fresh per-build profile.

## Verification

Reproduce false session transitions and unwanted reveal reload first. Test unchanged-cookie reuse, changed-account isolation, real logout, stale response rejection and refresh during an older poll. Test all-mode startup without manual reveal, additional live arrivals and offline stops. Native Windows checks must exercise multiple real players and the new UI; authenticated account and per-channel point accrual remain user checks. Keep the existing draft PR, no merge or release.
