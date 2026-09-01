'use strict';

const path = require('node:path');
const { BrowserWindow, screen } = require('electron');

/**
 * In-app reminder popups, used instead of native toasts.
 *
 * Windows lets users disable toast notifications system-wide
 * (HKCU\...\PushNotifications\ToastEnabled = 0), and many people do because it
 * silences every other app too. When that switch is off a native toast is
 * accepted and then discarded, so the reminder simply never appears -- and
 * Notification.isSupported() still reports true, so the app cannot detect it.
 *
 * A frameless always-on-top BrowserWindow is not subject to that setting, so
 * reminders arrive whatever the notification centre is configured to do.
 *
 * The window is deliberately small, click-through-free and auto-dismissing: it
 * appears above the tray, counts down, and disappears without stealing focus
 * from whatever is in the foreground.
 */

const WIDTH = 360;
const HEIGHT = 132;
const MARGIN = 12;
/** Kept in sync with the CSS slide-out so the window closes as it finishes. */
const FADE_MS = 260;

/**
 * Popups stack upwards from the tray so a burst of reminders stays readable
 * instead of drawing on top of itself.
 * @type {Set<PopupWindow>}
 */
const openPopups = new Set();

function layoutPopups() {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  let offset = 0;

  // Newest nearest the tray; older reminders ride upwards.
  for (const popup of [...openPopups].reverse()) {
    if (popup.destroyed) continue;
    const x = area.x + area.width - WIDTH - MARGIN;
    const y = area.y + area.height - HEIGHT - MARGIN - offset;
    popup.setPosition(Math.round(x), Math.round(y));
    offset += HEIGHT + 8;
  }
}

class PopupWindow {
  /**
   * @param {object} options
   * @param {string} options.title
   * @param {string} options.body
   * @param {boolean} [options.silent]  suppress the cue sound
   * @param {number}  [options.autoDismissMs]  0 keeps it until clicked
   * @param {string}  [options.iconPath]
   */
  constructor({ title, body, silent = false, autoDismissMs = 8000, iconPath = null }) {
    this.title = title;
    this.body = body;
    this.silent = silent;
    this.autoDismissMs = autoDismissMs;
    this.iconPath = iconPath;
    this.window = null;
    this.destroyed = false;
    this.closeTimer = null;
  }

  show() {
    this.window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: '#00000000',
      // A reminder must never steal typing or aim from the foreground app.
      focusable: false,
      acceptFirstMouse: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'popupPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // "screen-saver" keeps the popup above fullscreen windows, which is exactly
    // the case that matters: the game client is still closing down.
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    this.window.loadFile(path.join(__dirname, '..', 'renderer', 'popup.html'));

    this.window.webContents.once('did-finish-load', () => {
      if (this.destroyed || !this.window) return;
      this.window.webContents.send('popup:data', {
        title: this.title,
        body: this.body,
        silent: this.silent,
        autoDismissMs: this.autoDismissMs,
      });
      // showInactive keeps focus where it is instead of raising the popup.
      this.window.showInactive();
    });

    this.window.on('closed', () => {
      this.destroyed = true;
      this.window = null;
      openPopups.delete(this);
      layoutPopups();
    });

    openPopups.add(this);
    layoutPopups();

    if (this.autoDismissMs > 0) {
      this.closeTimer = setTimeout(() => this.dismiss(), this.autoDismissMs + FADE_MS);
    }
    return this;
  }

  setPosition(x, y) {
    if (this.destroyed || !this.window) return;
    this.window.setPosition(x, y);
  }

  dismiss() {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (this.destroyed || !this.window) return;
    this.window.close();
  }
}

/** Close every open popup, e.g. when the next game starts. */
function dismissAll() {
  for (const popup of [...openPopups]) popup.dismiss();
}

module.exports = { PopupWindow, dismissAll, openPopups, WIDTH, HEIGHT, FADE_MS };
