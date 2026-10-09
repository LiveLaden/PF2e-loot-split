# Changelog

All notable changes to Loot Split are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Versioning scheme:

- `x.0.0` — major releases (breaking changes, reworks)
- `0.x.0` — minor releases (new features, improvements)
- `0.0.x` — bug fixes

## [1.31.0] - 2026-10-09

### Changed

- Loot list sorts by priority: open lots by rarity (unique → rare → uncommon
  → common), then awarded, then sold last.
- Sale proceeds pay out in gold/silver/copper only — never platinum.

## [1.30.0] - 2026-10-09

### Added

- Sell-off: per-lot GM Sell button (proceeds in the tooltip) liquidates items
  straight into the pile — treasure at full value, everything else at half
  (PF2e selling rules), rounded down to the copper. Unit rows sell one unit,
  bulk rows sell the whole stack. Claimed lots ask for confirmation first.
  Sold lots stay listed as history with a gold tag and count.

## [1.29.0] - 2026-09-25

### Changed

- Claim tokens 40→60px with a 64px claims slot (roll badge back to 11px —
  1.28.0 grew the wrong element).
- Awarded backdrop sits lower globally (faces, not chests) via the shared
  offset — no per-character tuning, since the West Marches roster churns.

## [1.28.0] - 2026-09-25

### Changed

- Awarded backdrop sits lower in the card (faces instead of chests).
- Roll badge ~50% larger, same corner position.

## [1.27.0] - 2026-09-25

### Changed

- Portrait normalization rebuilt around the token ring: search range widened
  (small-ring tokens were missed entirely), confidence bar raised so ringless
  art falls back cleanly, full-bleed portraits render as-is, and rings target
  62% frame width (verified visually — larger targets crop the rings away).
  Small-ring and big-ring tokens now truly render identically.
- Awarded backdrop is a real desaturated layer (saturate 0.55) centered in the
  card instead of a CSS background, so it stays centered at any card size.
- Roll d100 badge moved inside the chip corner; item actions no longer clip
  vertically, so button glow and badges can't be cut off.

## [1.26.0] - 2026-09-25

### Changed

- Titlebar stripped to icon, title, and close button (party name, totals,
  and version tag removed; version proof remains in the console logs).
- Docs audit: README split-coins and exclusion sections rewritten to match
  actual behavior; AGENTS.md gained the assets dir and toggle-commit notes.

## [1.25.0] - 2026-09-25

### Changed

- Sitting out now redistributes only the sidelined member's UNCLAIMED
  remainder: actives split (total − excluded kept) among themselves, so kept
  items never inflate shares yet the books still close to the copper.
- "Left X gp" renamed to "Owed X gp" on member cards.

## [1.24.0] - 2026-09-25

### Added

- "Value Left" header stat: unawarded items + coin pile still undistributed.

### Changed

- Shares are frozen against exclusion: sitting someone out no longer inflates
  everyone else (that created value from nothing). The excluded member's kept
  value simply stays out of the pool; the capped coin split leaves their
  unclaimed remainder in the pile, so the books always close.
- Sit-out toggle: neutral dark pill always, knob grey/gold only. The commit
  fires 240ms after the click so the slide animation always finishes instead
  of being cut by the re-render.

## [1.23.0] - 2026-09-25

### Changed

- Sit-out toggle restyled: green/gold active state matching the UI's success
  language, round knob, and an instant local flip so the slide animation
  actually plays before the re-render lands.

## [1.22.0] - 2026-09-25

### Changed

- Sit-out toggle flipped and smoothed: resting state (in split) is purple/gold
  with the knob right; sitting out drains the color and slides left, animated
  on transform (GPU-smooth) instead of layout position.
- Removed the own-claim highlight ring: it was the only rendering unique to
  your own token, matching the reported "background only on my token".
- Portrait fill target 0.72→0.85 (clamp up to 1.7×) so frames fill
  edge-to-edge with minimal surround.

## [1.21.0] - 2026-09-25

### Changed

- Sit-out control is now a mini toggle switch (dark pill, gold knob when set)
  instead of a checkbox: smaller, theme-matched, zero glyphs to break.
- Coin Pile row dropped its outline.
- Claims slot hugs the 40px chips exactly (44→40px) with tighter gaps.
- Claim chips always resolve art live from the roster, so they can never
  drift from member portraits when art changes mid-session.

## [1.20.0] - 2026-09-25

### Changed

- Portrait normalization now keys off the token RING itself (circular
  Hough-style voting on radial gradients, center-tolerant) instead of raw
  content bounds, so rings render at identical size whatever the bust inside
  does. Falls back to content bounds, then unscaled. Verified against real
  token art (detected circle overlays the gold ring) and synthetic rings.
- Claim chips 56→40px with a 44px claims slot.
- Sit-out checkboxes use native dark controls with a purple accent (the
  custom glyph broke on some clients).
- Coin Pile veil darkened to 0.75.

## [1.19.0] - 2026-09-25

### Added

- Bundled Coin Pile artwork (`assets/coin-pile.jpg`) behind the Coin Pile row.

### Changed

- Rounded window corners restored (opaque frame + neutralized theme padding
  retained, so no edge artifacts).
- Sit-out checkbox glyph switched to U+00D7 (universal font support); the
  previous mark rendered as tofu on some clients.

## [1.18.0] - 2026-09-25

### Added

- Coin Pile backdrop: drop `coin-pile.webp` (or `.png`/`.jpg`) into
  `modules/loot-split/assets/` to have it behind the Coin Pile row, same dim
  treatment as awarded backdrops. Absent file renders plain.
- Version diagnostics: module version in the init log and as a tiny tag in
  the titlebar, plus a one-time portrait-fit log per window — so any client
  can prove exactly what code it runs.

### Changed

- Claim chips 40→56px with a 60px claims slot.
- Sit-out checkboxes restyled to match the dark UI (small, gold ✕ when set).

### Fixed

- Window frame for real this time: the theme was beating our structural rules
  with `section.window-content` padding (`8px 14px 14px`, spotted via element
  inspect). All structural overrides are `!important` now, plus a `.window-frame`
  neutralization rule for themed wrappers.

## [1.17.0] - 2026-09-25

### Changed

- Claim chips 32→40px with a 44px claims slot (uniform cards kept).
- Window frame squared off: with opaque backgrounds everywhere, square corners
  leave no radius-clipping seam for fractional-DPI renderers to fringe on.

## [1.16.0] - 2026-09-25

### Changed

- Claim chips 44→32px with a snug 36px claims slot; cards tighten up again
  while staying uniform.
- Window frame uses a crisp 1px edge with no drop shadow instead of the soft
  shadow, which read as a dirty grey border over light maps.

## [1.15.0] - 2026-09-25

### Changed

- Compact pass: member portraits 76→60px, claim chips 52→44px (claims row
  follows so cards stay uniform), tighter card padding and gaps. Same look,
  roughly a fifth less vertical space.

## [1.14.0] - 2026-09-25

### Added

- Portrait normalization: each token file's real content bounds are measured
  (alpha channel, cached by URL) and portraits are scaled so every disc fills
  its frame equally — tiny busts scale up, overflowing ones scale down,
  centered. Unreadable or fully opaque images stay unscaled.

## [1.13.0] - 2026-09-25

### Changed

- Portraits doubled in size: member list 76px, claim chips 52px (claims row
  grew to match so cards stay uniform).
- Awarded-row veil lightened (0.86 → 0.72) so the winner backdrop shows
  through more.

## [1.12.0] - 2026-09-25

### Changed

- Rarity styling per PF2e hues (brightened for dark UI): rarity pill styled
  like the Awarded tag, item names colored, and card outlines drawn in the
  rarity color. Roll-off highlight still takes precedence while active.
- Portrait frames dropped their borders so token art floats directly on the
  card (own-claim highlight ring kept).

## [1.11.0] - 2026-09-25

### Changed

- Awarded-row backdrop is larger (520px) and right-anchored, so no card
  background shows on any window size.
- Portraits render inside clipped zoom frames (member list and claim chips):
  the baked surround in token art is cropped out instead of showing as a box
  behind the image.

## [1.10.0] - 2026-09-25

### Changed

- Portrait circles removed everywhere: member list and claim chips now use
  small rounded-square thumbnails instead of round crops.

## [1.9.0] - 2026-09-25

### Changed

- Awarded-row backdrop doubled in size and pinned to the right side.

## [1.8.0] - 2026-09-25

### Changed

- Awarded-row backdrop uses the full actor portrait (resolved live, snapshot
  as fallback) at a fixed 160px size anchored left, so it no longer resizes or
  slides with the card.
- Rounded window corners restored over the opaque frame.

### Fixed

- Removed the token-texture scaling of portraits: canvas token scales (e.g.
  1.5–2×) leaked into the fixed-size UI circles and stretched/broke them.
  Portraits render 1:1 with `object-fit: cover` again.

## [1.7.0] - 2026-09-25

### Changed

- Item cards are uniform now: fixed four-line structure (name / level+rarity /
  claims / action) with fixed slot heights, so open and awarded cards are
  always the same size. Awarded cards keep their slots showing the winner and
  an "Awarded" tag instead of shrinking.
- Winner backdrop anchors at 30% from the top (faces, less dead space) and the
  item thumbnail is hidden on awarded rows to remove the doubled image.
- Portraits honor the token's texture scale (clamped), so zoomed-out tokens
  render proportionally in member lists and claim chips.

### Fixed

- Window frame flattened completely (square, opaque, invisible seam, no
  shadow) to eliminate edge artifacts on any client or theme.

## [1.6.0] - 2026-09-25

### Changed

- Member portraits and claimant chips use the token portrait instead of the
  actor portrait. Sitting out keeps the "Claimed X gp" line above the tag.
- Awarded rows are dimmed harder and anchor the winner backdrop at the top so
  faces show instead of torsos.

### Fixed

- Window frame can no longer leak theme/canvas grey at the edges: the app
  element itself is painted opaque (GM and player windows alike).
- Players/Loot column headers line up (unified header spacing).
- Claimant chips are true circles now (fixed-size round avatar with the d100
  result as an overlaid mini-badge instead of a stretched pill).

## [1.5.0] - 2026-09-25

### Added

- GM-only sit-out checkbox per member card. Excluded members are greyed out,
  cannot claim, and are left out of share math, coin splits, and debt settling.
  Exclusion survives re-scans; unticking brings them back.
- Corner reopen button: while a split is active and its window is closed, a
  small scales button sits bottom-right, left of the sidebar (tracks sidebar
  collapse). Clicking reopens the window for that client (re-scans for the host).
- Role-based window widths: 1120px for GMs (three columns), 800px for players.
- Clear Stash button next to Split Loot (GM-only, confirmed): deletes every
  stash item including coins. An active split picks the change up by itself.

### Changed

- Small stacks (qty 2–8, non-containers) render as one row per unit so different
  PCs can claim each unit; awarding moves a single unit and the stash count
  drops live. Larger stacks stay whole. (Replaces the 1.3.0 ×N merge.)
- Loot list is a compact two-column grid; claimant chips show token portraits
  with the d100 result (name on hover); awarded rows show the winner's portrait
  as a dimmed grey-tinted backdrop.
- "Coin pile" renamed to "Coin Pile". Coinage documents are no longer listed as
  lots — the fixed Coin Pile row covers all coins.

## [1.4.0] - 2026-09-25

### Added

- Fixed Coin Pile row at the top of the loot list: Gold, Silver, Copper on one
  line, always visible even at zero (Platinum chip only when nonzero), fed by a
  live denomination snapshot.

### Changed

- Split coins is now need-based: debtors are skipped, each payout is capped at
  what the member is still owed, and leftovers water-fill across the rest
  (e.g. 1000 gp pile with four PCs owed 500 and one owed 50 pays 237.5 × 4
  plus 50). Remainder dust stays in the pile.
- Owes display no longer double-negates ("Owes 412 gp", not "Owes -412 gp").
- Removed "(you)" from member names (own card keeps the blue highlight).

### Fixed

- Distributed coins now show up on member cards and balances; previously only
  awarded items were counted in the window (the host always accounted them).

## [1.3.0] - 2026-09-25

### Added

- GM right column replacing the ⋮ menu and footer: Award uncontested, Refresh
  stash, Split coins, Settle debts, End session, plus the activity log.
- Coinage documents listed as lots in the loot viewer.

### Changed

- The empty-stash notice is GM-only now.
- Identical lots merged into single ×N rows.
- Settle debts pays back in gold/silver/copper only — never platinum.

## [1.2.0] - 2026-09-25

### Added

- Live updates: stash changes (add/remove/edit/quantity/price) mid-session
  trigger an automatic debounced re-scan on the host that preserves
  claims/rolls/status and pushes to every window.
- Split Loot re-scans before reopening an existing session for the same party,
  so the window never shows a stale empty snapshot.

### Fixed

- Coin pile fallback: coinage items are summed directly when the party actor's
  aggregated inventory is unavailable, instead of reading 0 gp.

## [1.1.0] - 2026-09-25

### Changed

- Full UI overhaul: frameless dark-mode window with its own draggable title
  bar, ⋮ menu with GM tools, two-column layout (players left, loot right),
  stat cards, and an activity log.

### Fixed

- Stash scan missed everything stowed inside containers. It now walks the
  stash recursively exactly like the party sheet does (contents annotated
  with "in X"), with a type-set fallback next to the system's classifier.
- Awarding a container now carries its contents along, remapping container
  links to the winner's copy instead of orphaning them.
- Start/reopen toasts report lot counts and totals; refresh preserves claims.

## [1.0.0] - 2026-09-25

### Added

- Initial release.
- GM-only Split Loot button on the party sheet Stash tab; shared draft window
  pops open for everyone via sockets.
- Header totals (total loot, equal share per PC), member balances with
  owes-the-pile tracking. Only real PCs count (no familiars, eidolons,
  minions, or summons).
- "I want this" claims mapped to each player's own PC; single-claimant Award
  plus Award uncontested; contested items resolve with public d100 roll-offs
  (highest wins, ties re-roll, GM roll-missing fallback).
- GM tools: Refresh, equal Split coins, Settle debts, End session. Awards,
  rolls, and payouts post to chat.
- Host-GM authority model (players need no stash permissions), world-setting
  persistence, auto-reopen on reload, price-per aware PF2e valuations.
