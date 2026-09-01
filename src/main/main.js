'use strict';

const path = require('node:path');
const { app, BrowserWindow, Notification, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');

const { GameWatcher } = require('../core/watcher');
const { planNotifications, formatDuration } = require('../core/reminderPlanner');
const { Store } = require('./store');
const { Notifier } = require('./notifier');
const { PopupWindow, dismissAll } = require('./popup');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

// Windows groups toasts by app id; without this they are attributed to the
// Electron process and can be silently dropped.
app.setAppUserModelId('com.kazusource.leaguealertoog');

let store;
let watcher;
let notifier;
let tray = null;
let window = null;
let quitting = false;

/* ------------------------------------------------------------------ window */

function createWindow() {
  window = new BrowserWindow({
    width: 860,
    height: 780,
    minWidth: 660,
    minHeight: 560,
    show: false,
    backgroundColor: '#0a1428',
    title: 'League Alert OOG',
    icon: path.join(ASSETS, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Closing the window leaves the watcher running in the tray, which is the
  // whole point — quitting is an explicit action.
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });

  window.on('closed', () => {
    window = null;
  });

  window.webContents.on('did-finish-load', pushState);
}

function showWindow() {
  if (!window) createWindow();
  window.show();
  window.focus();
}

/* ------------------------------------------------------------------- state */

function buildState() {
  return {
    status: watcher.getStatus(),
    settings: store.getSettings(),
    stats: store.getStats(),
    history: store.getHistory(),
    platform: process.platform,
    version: app.getVersion(),
    configPath: store.file,
    // Reminders are in-app windows, so they work regardless of OS toast settings.
    notificationsSupported: true,
    nativeToastsSupported: Notification.isSupported(),
    pendingReminders: notifier.pendingCount,
  };
}

function pushState() {
  if (window && !window.isDestroyed() && window.webContents) {
    window.webContents.send('state:update', buildState());
  }
  updateTrayMenu();
}

/* --------------------------------------------------------------------- tray */

function trayImage() {
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const image = nativeImage.createFromPath(path.join(ASSETS, file));
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}

function trayStatusLabel() {
  const status = watcher.getStatus();
  if (!status.watching) return 'Watching paused';
  if (status.inGame) {
    const label = status.session?.queueName ? `In game · ${status.session.queueName}` : 'In game';
    return label;
  }
  if (status.lastError) return 'Scan error — see the window';
  return status.launcherRunning ? 'Waiting — launcher open' : 'Waiting for a game';
}

let trayMenuKey = null;

function updateTrayMenu() {
  if (!tray) return;
  const settings = store.getSettings();

  // Status is pushed every poll tick; rebuilding the menu each time is wasteful
  // and closes it under the user's cursor on some platforms.
  const key = `${trayStatusLabel()}|${settings.watchEnabled}`;
  if (key === trayMenuKey) return;
  trayMenuKey = key;

  tray.setToolTip(`League Alert OOG — ${trayStatusLabel()}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: trayStatusLabel(), enabled: false },
      { type: 'separator' },
      { label: 'Open League Alert', click: showWindow },
      {
        label: 'Watch for games',
        type: 'checkbox',
        checked: settings.watchEnabled,
        click: (item) => setWatchEnabled(item.checked),
      },
      { label: 'Send a test reminder', click: sendTestNotification },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  try {
    tray = new Tray(trayImage());
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
    updateTrayMenu();
  } catch (error) {
    // Some Linux desktops ship no tray host. Watching and reminders still work;
    // only the tray shortcut is missing, so show the window instead.
    console.error('[league-alert] tray unavailable:', error.message);
    tray = null;
    showWindow();
  }
}

/* ------------------------------------------------------------ notifications */

function sendTestNotification() {
  notifier.schedule(
    [
      {
        id: `test-${Date.now()}`,
        kind: 'test',
        title: 'League Alert OOG',
        body: 'This is what a post-game reminder looks like.',
        delayMs: 0,
      },
    ],
    { silent: !store.getSettings().playSound },
  );
}

async function handleGameEnd(session) {
  const settings = store.getSettings();
  const gamesPlayed = store.getStats().gamesPlayed + 1;
  const plan = planNotifications({ session, settings, gamesPlayed });

  console.log(
    `[league-alert] game ended: ${formatDuration(session.durationMs)}` +
      `${session.queueName ? ` (${session.queueName})` : ''}` +
      `${plan.skippedReason ? ` — skipped: ${plan.skippedReason}` : ` — ${plan.notifications.length} notification(s)`}`,
  );

  notifier.schedule(plan.notifications, { silent: !settings.playSound });
  await store.recordGame(session, { skippedReason: plan.skippedReason });
  pushState();
}

function handleGameStart(session) {
  console.log(`[league-alert] game started (pid ${session.pid})`);
  // A reminder still on screen is stale the moment the next game loads.
  dismissAll();
  if (store.getSettings().cancelPendingOnNewGame) {
    const dropped = notifier.cancelPending();
    if (dropped > 0) console.log(`[league-alert] cancelled ${dropped} pending reminder(s)`);
  }
  pushState();
}

/* ---------------------------------------------------------------- lifecycle */

/** Persist a settings patch and bring the watcher and OS integration in line. */
async function applySettings(patch) {
  const settings = await store.saveSettings(patch || {});
  watcher.updateSettings(settings);
  applyLoginItem(settings);

  if (settings.watchEnabled && !watcher.getStatus().watching) watcher.start();
  if (!settings.watchEnabled && watcher.getStatus().watching) watcher.stop();

  pushState();
  return settings;
}

function setWatchEnabled(enabled) {
  applySettings({ watchEnabled: enabled }).catch((error) => console.error('[league-alert]', error));
}

function applyLoginItem(settings) {
  if (process.platform === 'linux') return; // not supported by Electron on Linux
  app.setLoginItemSettings({
    openAtLogin: settings.launchAtLogin,
    openAsHidden: settings.startMinimized,
  });
}

function registerIpc() {
  ipcMain.handle('app:getState', () => buildState());

  ipcMain.handle('settings:save', (_event, patch) => applySettings(patch));

  ipcMain.on('popup:dismiss', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
  });

  ipcMain.handle('notify:test', () => {
    sendTestNotification();
    return true;
  });

  ipcMain.handle('history:clear', async () => {
    await store.clearHistory();
    pushState();
    return true;
  });

  ipcMain.handle('app:openConfigFolder', () => shell.showItemInFolder(store.file));

  ipcMain.handle('app:quit', () => {
    quitting = true;
    app.quit();
  });
}

function bootstrap() {
  app.whenReady().then(startApp);
  app.on('second-instance', showWindow);
  // Tray app: closing the last window must not quit.
  app.on('window-all-closed', () => {});
  app.on('activate', () => showWindow());
  app.on('before-quit', () => {
    quitting = true;
    if (watcher) watcher.stop();
    if (notifier) notifier.cancelPending();
  });
}

async function startApp() {
  store = new Store({ dir: app.getPath('userData') });
  await store.load();
  const settings = store.getSettings();

  notifier = new Notifier({
    // Reminders are drawn by the app itself rather than handed to the OS. See
    // src/main/popup.js: Windows' global "turn off notifications" switch would
    // otherwise discard every reminder with no way to detect it.
    createNotification: (options) =>
      new PopupWindow({
        ...options,
        autoDismissMs: store.getSettings().popupDismissSeconds * 1000,
        iconPath: path.join(ASSETS, 'icon.png'),
      }),
    onShow: () => pushState(),
  });

  watcher = new GameWatcher({ settings });
  watcher.on('game-start', handleGameStart);
  watcher.on('game-end', (session) => {
    handleGameEnd(session).catch((error) => console.error('[league-alert]', error));
  });
  watcher.on('status', pushState);
  watcher.on('scan-error', (error) => console.error('[league-alert] scan failed:', error.message));

  registerIpc();
  applyLoginItem(settings);
  createWindow();
  createTray();

  if (!settings.startMinimized) showWindow();
  if (settings.watchEnabled) watcher.start();
}

// A second copy would double every reminder, so the duplicate exits immediately.
if (app.requestSingleInstanceLock()) bootstrap();
else app.quit();
