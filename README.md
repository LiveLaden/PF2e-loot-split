# Loot Split

Foundry VTT v14 + PF2e system module. Split the party stash fairly between player characters.

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Installation

In Foundry Setup → Modules → Install Module, paste the manifest URL:

```text
https://raw.githubusercontent.com/LiveLaden/foundryvtt-loot-split/main/module.json
```

Or [download the latest release](https://github.com/LiveLaden/foundryvtt-loot-split/releases)
and extract it into your `Data/modules/` folder.

## Flow

1. GM opens a **party sheet**, goes to the **Stash** tab, and clicks **Split Loot** (GM-only button at the top of the stash inventory).
2. A **Loot Split** window pops up for **everyone** (total loot value, equal share per PC, member balances, stash items).
3. Each player clicks **I want this** on items they want (mapped to their own PC — only real PCs count; familiars, eidolons/minions, and summons are excluded).
4. Items with exactly one claimant: GM clicks **Award** (or **Award uncontested** for all). The item moves from the stash to the winner's inventory and its value counts against their share. Going below zero shows **Owes X to pile**.
5. Items with 2+ claimants: GM clicks **Roll off**, each claimant presses **Roll d100** in the window (public roll to chat), highest wins and the item is awarded automatically. Ties re-roll. GM can roll for missing players with **Roll missing**.
6. GM tools: **Refresh** (re-read stash), **Split coins** (pays only members still owed value, capped per member with leftovers redistributed), **Settle debts** (pulls owed gold from debtors back into the stash), **Sell** (per-lot liquidation into the pile: treasure full value, else half), **End** (closes for everyone).

## Notes

- The GM who starts the split is the host: all claims/rolls route through them, so players need no stash edit permissions.
- Coins and item values use PF2e price data (including price-per quantity, e.g. ammunition).
- The stash scan mirrors the party sheet: loose items **and** everything stowed inside containers (shown as "in X"). Awarding a container carries its contents along with it.
- The split stays live: adding, removing, or editing stash items mid-session re-scans automatically (claims are kept), and clicking Split Loot again re-scans before reopening.
- While a split is active, closing the window leaves a small reopen button at the bottom-right, left of the sidebar. PC windows open narrower than GM windows (no GM column).
- The GM can flip members out of the split with a mini toggle (greyed, can't claim, skipped by coin tools). Shares never move: the sidelined member keeps what they took and only their unclaimed remainder flows back to actives, so the books always close.
- Small stacks (up to 8) show as one row per unit so each can be claimed separately; larger stacks stay whole. Loot shows two per line with claimant token art; winners get a dimmed portrait backdrop on their row.
- Coin pile shows as a fixed Gold/Silver/Copper row (plus Platinum only if any), always visible even at zero.
- Split coins only pays members still owed value (debtors are skipped), caps each payout at what they're owed, and redistributes the leftover across the rest. Settle debts pays back in gold/silver/copper only — never platinum.
- Clear Stash (next to Split Loot, GM-only, with confirm) deletes every stash item.
- If a session is active, clicking Split Loot again re-opens the window for everyone instead of wiping claims.
- Reloading while a split is active re-opens the window automatically.
- The window is frameless dark mode with its own title bar (drag it anywhere) and a three-column layout: players left, loot middle, GM tools + activity log right (GM-only).
