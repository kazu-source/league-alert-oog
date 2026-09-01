# League Alert OOG — build summary

A desktop app that fires your own reminders **the moment a League of Legends or Teamfight
Tactics game ends** — when the game client process exits, not when you close the launcher
and not on a timer.

- **Repo:** `kazu-source/league-alert-oog`
- **Branch:** `claude/lol-game-end-reminders-tq3vl7`
- **Commit:** `fd46be9`
- **Stack:** Electron 44, zero runtime dependencies, no build step
- **Size:** ~2,600 lines of source, ~1,000 lines of tests

---

## The core problem: which process are we watching?

This is the whole design, and it is exactly the distinction in the request. Riot runs two
very different executables, and only one of them exiting means "game over":

| | Watched? | Windows | macOS |
|---|---|---|---|
| **Launcher / base client** — the window you log in to and queue from; stays open all evening | **No** | `LeagueClient.exe`, `LeagueClientUx.exe`, `RiotClientServices.exe` | `LeagueClient`, `LeagueClientUx`, `RiotClientServices` |
| **Game client** — spawned when the match loads, exits when you leave the post-game screen | **Yes** | `League of Legends.exe` | binary under `.../League of Legends.app/Contents/LoL/Game/...` |

Closing the login client never triggers a reminder. On macOS the launcher and the game share
the basename `League of Legends`, so the game is identified by the `/Game/` path segment.

Process listing uses `tasklist` (Windows) and `ps` (macOS) — **no native modules, no drivers,
nothing injected into the game**, so there is nothing for anti-cheat to object to.

### Telling League from TFT

**TFT on desktop runs inside the same game-client executable as League**, so the process alone
cannot label a match. While a game is live, the app asks the launcher's local API
(`https://127.0.0.1:<port>/lol-gameflow/v1/session`) what is being played, discovering
credentials from the launcher's command line and falling back to the lockfile.

This is strictly **best-effort enrichment**. With the launcher closed or the API unreachable,
detection still works — games are simply labelled "Game finished" instead of "TFT game
finished", and type-specific reminders stay quiet rather than guess wrong.

Nothing leaves the machine: no network calls beyond `127.0.0.1`, no accounts, no telemetry.

---

## Features

**Reminders** — each enabled reminder becomes one desktop notification after a game ends:

| Field | Behaviour |
|---|---|
| Text | What the notification says |
| Applies to | Any game / League only / TFT only |
| Delay | Fire N seconds after the game ends |
| Every N games | Fire only every Nth game — e.g. "3 in a row, take a real break" |

**Delayed reminders auto-cancel when the next game starts**, so "stretch in 5 minutes" never
pops up mid-match.

**Also included:** minimum game-length filter (ignores dodges and crashes), per-type muting,
optional game-summary notification (queue name + length), notification sound toggle, tray icon
with status and quick actions, settings window, JSON config, launch at login, start hidden,
and a recent-games log showing whether reminders fired or why they were skipped.

---

## Architecture

```
src/core/      Electron-free logic — process scanning, game detection, the session
               state machine, the launcher API client, settings, reminder planning
src/main/      Electron main process: window, tray, persistence, notification queue
src/preload/   the only renderer → main bridge (contextIsolation, no Node in renderer)
src/renderer/  settings UI (vanilla HTML/CSS/JS, no build step)
test/          unit tests for src/core and the main-process helpers
scripts/       icon generator (PNGs built from code, no binary blobs to maintain)
```

Detection logic is deliberately kept out of the Electron layer so it can be driven by a
scripted process list and a fake clock — that is what makes the tricky cases testable.

Notable design decisions:

- **A failed scan never ends a game.** If `tasklist`/`ps` errors, session state is left
  untouched rather than being read as "the process disappeared".
- **Missed-scan tolerance.** A game survives N missing scans, but the recorded end time is
  when the process was *last seen*, so tolerance never inflates game duration.
- **Config is treated as untrusted.** Every value off disk is validated and clamped.
- **Atomic, serialized writes.** Temp file + rename; concurrent saves cannot interleave.

---

## Verification

**80 unit tests pass** (`npm test`, `node:test`, no Electron required), covering:

- process-list parsing for Windows CSV and macOS/Linux `ps`, including paths with spaces
- game-vs-launcher matching on all three platforms, including a launcher whose command line
  mentions the game executable
- the session state machine: missed scans, back-to-back games, in-flight scans during a stop
- settings validation and clamping, LCU parsing and HTTP behaviour (against a real local
  server), reminder planning rules, persistence and history capping

**End-to-end in the real app:** booted the Electron app under Xvfb against a simulated game
process. Start detected, exit detected, duration computed, the correct notification set
planned — summary + the "any" reminder fired, while the TFT-only reminder correctly stayed
silent with the type unknown and the every-2-games reminder correctly waited. History and game
counter persisted to disk. UI verified by capturing the live window via DevTools Protocol.

**Two real bugs were caught and fixed during the build:**

1. `Number(null) === 0`, so invalid config values silently clamped to zero instead of falling
   back to defaults (a `null` minimum game length became `0`, not `60`).
2. A stop/start during an in-flight scan could leave two poll loops running; fixed with a
   generation guard, plus a regression test.

---

## Known limits

Development happened on Linux, so the following could **not** be verified first-hand and rest
on documented install layouts:

- the exact process names against a live Windows/macOS League install
- the launcher API against a running client
- native toast delivery (the container has no notification daemon)

Mitigations are built in: the LCU path fails soft, the status panel shows exactly what the
watcher sees each scan, and an **"extra process names"** setting lets you widen detection
without a code change. The first real game you play will confirm the names.

Windows and macOS are the supported targets. Linux runs for development only — League has no
native Linux client, and launch-at-login is unavailable there.

---

## Running it

```bash
npm install
npm start            # run the app

npm test             # 80 unit tests
npm run icons        # regenerate assets from scripts/make-icons.js

npm run dist:win     # NSIS installer (build on Windows)
npm run dist:mac     # DMG            (build on macOS)
```

Config lives in a plain JSON file; "Show config file" in the app footer reveals it
(`%APPDATA%`, `~/Library/Application Support`, or `~/.config` under `League Alert OOG`).
