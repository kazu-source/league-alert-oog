# League Alert OOG

A small desktop app that fires your own reminders **the moment a League of Legends or
Teamfight Tactics game ends** — the instant the game client closes, not when you close
the launcher and not on a timer.

It lives in the tray, watches for the game client process, and shows a native desktop
notification for each reminder you have configured.

## How it detects "game over"

Riot ships two very different executables, and the difference is the whole trick:

| | Windows | macOS |
|---|---|---|
| **Launcher / base client** — the window you log in to and queue from. Stays open all evening. | `LeagueClient.exe`, `LeagueClientUx.exe`, `RiotClientServices.exe` | `LeagueClient`, `LeagueClientUx`, `RiotClientServices` |
| **Game client** — spawned when the match loads, exits when you leave the post-game screen. **This is what we watch.** | `League of Legends.exe` | `.../League of Legends.app/Contents/LoL/Game/League of Legends.app/Contents/MacOS/League of Legends` |

The app polls the process list every few seconds (`tasklist` on Windows, `ps` on macOS —
no native modules, no drivers, no injection into the game). When the game-client process
disappears, the game is over and your reminders fire. Closing the launcher never triggers
anything.

**Teamfight Tactics runs inside the same game client executable as League**, so the
process alone cannot say which one you played. To label a game, the app asks the League
launcher's local API (`https://127.0.0.1:<port>/lol-gameflow/v1/session`) while the match
is running. That is entirely optional: without it, detection still works and reminders
simply say "Game finished" instead of "TFT game finished".

Nothing is sent off your machine — no network calls beyond `127.0.0.1`, no accounts,
no telemetry.

## Install and run

```bash
npm install
npm start
```

## Build an installer

```bash
npm run dist:win    # NSIS installer  (build on Windows)
npm run dist:mac    # DMG             (build on macOS)
```

`electron-builder` writes to `dist/`. Build on the platform you are targeting.

## Using it

The window is the settings screen; closing it leaves the app running in the tray. The
tray menu has status, a watching on/off toggle, a test reminder, and quit.

**Reminders** — each enabled reminder becomes one notification after a game ends:

| Field | What it does |
|---|---|
| Text | What the notification says. |
| Applies to | Any game, League only, or TFT only. Type-specific reminders need the launcher open (see above); when the type is unknown they stay quiet rather than guess. |
| Delay (s) | Wait this long after the game ends. Delayed reminders are cancelled if you start another game, so "stretch in 5 minutes" never pops up mid-match. |
| Every N games | Fire only every Nth game — useful for "you have played 3 in a row, take a real break". |

**Notifications** — mute League or TFT independently, toggle the game-summary
notification (queue name + game length), toggle the notification sound, and ignore games
shorter than N seconds so a crash or an instant dodge does not count.

**Detection** — poll interval, how many missed scans to tolerate before calling a game
over, whether to use the launcher API, and extra process names for unusual installs.

**Application** — launch at login and start hidden in the tray (both unsupported on Linux).

Settings live in a plain JSON file; "Show config file" in the footer reveals it.

| Platform | Config location |
|---|---|
| Windows | `%APPDATA%\League Alert OOG\config.json` |
| macOS | `~/Library/Application Support/League Alert OOG/config.json` |
| Linux | `~/.config/League Alert OOG/config.json` |

## Troubleshooting

**No reminders after a game.** Open the window and check the status line. "Waiting for a
game" while you are in a match means the game client is not being matched — add its
process name under Detection → *Extra process names*. Check *Recent games* too: a game
logged as "skipped — too short" means it was under your minimum length.

**Games show as "Unknown" instead of League/TFT.** The launcher API was unreachable.
It only answers while the launcher is open; keep *Ask the League launcher what is being
played* enabled and the launcher running. Everything else still works.

**Nothing shows up at all.** The window warns you if the OS is refusing notifications for
this app; allow them in Windows Settings → Notifications, or macOS System Settings →
Notifications.

## Platform support

Windows and macOS are the supported targets. Linux is supported for development (the app
runs, and detection matches the Wine command line), but League does not run natively
there, and launch-at-login is unavailable.

## Development

```bash
npm test        # unit tests (node:test, no Electron needed)
npm run icons   # regenerate assets/ from scripts/make-icons.js
```

Layout:

```
src/core/      platform + Electron-free logic — process scanning, game detection,
               the session state machine, the launcher API client, reminder planning
src/main/      Electron main process: window, tray, persistence, notification queue
src/preload/   the only renderer → main bridge
src/renderer/  settings UI (vanilla HTML/CSS/JS, no build step)
test/          unit tests for everything under src/core and the main-process helpers
```

Detection logic is deliberately kept out of the Electron layer so it can be tested with a
scripted process list and a fake clock — see `test/watcher.test.js`.

## License

MIT
