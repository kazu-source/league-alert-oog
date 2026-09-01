'use strict';

/**
 * Settings UI. Talks to the main process only through window.api (preload).
 *
 * State pushes arrive every poll tick, so rendering deliberately avoids
 * rebuilding anything the user is currently typing into.
 */

const els = {
  watchEnabled: document.getElementById('watch-enabled'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  statusDetail: document.getElementById('status-detail'),
  statusMeta: document.getElementById('status-meta'),
  reminders: document.getElementById('reminders'),
  history: document.getElementById('history'),
  extraProcesses: document.getElementById('extra-processes'),
  footerInfo: document.getElementById('footer-info'),
  flash: document.getElementById('flash'),
  notificationWarning: document.getElementById('notification-warning'),
  loginHint: document.getElementById('login-hint'),
};

let state = null;
let reminders = [];
let saveTimer = null;

/* --------------------------------------------------------------- helpers */

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m ${String(totalSeconds % 60).padStart(2, '0')}s`;
}

function formatTime(epochMs) {
  const date = new Date(epochMs);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isToday = new Date().toDateString() === date.toDateString();
  return isToday ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function flash(message) {
  els.flash.textContent = message;
  els.flash.classList.add('show');
  setTimeout(() => els.flash.classList.remove('show'), 1200);
}

/** True while the user is typing somewhere in the settings form. */
function isEditing(container) {
  const active = document.activeElement;
  return Boolean(active && container.contains(active));
}

/* ----------------------------------------------------------------- saving */

async function save(patch, { quiet = false } = {}) {
  const settings = await window.api.saveSettings(patch);
  if (state) state.settings = settings;
  if (!quiet) flash('Saved');
  return settings;
}

function saveRemindersSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save({ reminders }, { quiet: true }), 400);
}

/* -------------------------------------------------------------- reminders */

function reminderRow(reminder) {
  const row = document.createElement('div');
  row.className = 'reminder';
  row.dataset.id = reminder.id;

  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = reminder.enabled;
  enabled.title = 'Enable this reminder';
  enabled.addEventListener('change', () => {
    reminder.enabled = enabled.checked;
    saveRemindersSoon();
  });

  const text = document.createElement('input');
  text.type = 'text';
  text.value = reminder.text;
  text.placeholder = 'What should the reminder say?';
  text.addEventListener('input', () => {
    reminder.text = text.value;
    saveRemindersSoon();
  });

  const appliesLabel = document.createElement('label');
  appliesLabel.className = 'reminder-label';
  appliesLabel.append('After');
  const applies = document.createElement('select');
  for (const [value, label] of [
    ['any', 'any game'],
    ['lol', 'League only'],
    ['tft', 'TFT only'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    applies.append(option);
  }
  applies.value = reminder.appliesTo;
  applies.addEventListener('change', () => {
    reminder.appliesTo = applies.value;
    saveRemindersSoon();
  });
  appliesLabel.append(applies);

  const delayLabel = document.createElement('label');
  delayLabel.className = 'reminder-label';
  delayLabel.append('Delay (s)');
  const delay = document.createElement('input');
  delay.type = 'number';
  delay.className = 'num';
  delay.min = '0';
  delay.value = String(reminder.delaySeconds);
  delay.addEventListener('change', () => {
    reminder.delaySeconds = Number(delay.value) || 0;
    saveRemindersSoon();
  });
  delayLabel.append(delay);

  const everyLabel = document.createElement('label');
  everyLabel.className = 'reminder-label';
  everyLabel.append('Every N games');
  const every = document.createElement('input');
  every.type = 'number';
  every.className = 'num';
  every.min = '1';
  every.value = String(reminder.everyNGames);
  every.addEventListener('change', () => {
    reminder.everyNGames = Math.max(1, Number(every.value) || 1);
    saveRemindersSoon();
  });
  everyLabel.append(every);

  const remove = document.createElement('button');
  remove.className = 'icon';
  remove.textContent = '×';
  remove.title = 'Delete this reminder';
  remove.addEventListener('click', () => {
    reminders = reminders.filter((item) => item !== reminder);
    renderReminders();
    save({ reminders }, { quiet: true });
  });

  row.append(enabled, text, appliesLabel, delayLabel, everyLabel, remove);
  return row;
}

function renderReminders() {
  els.reminders.replaceChildren();
  if (reminders.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No reminders yet — add one and it will fire after your next game.';
    els.reminders.append(empty);
    return;
  }
  for (const reminder of reminders) els.reminders.append(reminderRow(reminder));
}

/* ----------------------------------------------------------------- status */

function statusView(status) {
  if (!status.watching) {
    return { dot: 'paused', text: 'Watching paused', detail: 'No reminders will fire until you resume.' };
  }
  if (status.lastError) {
    return { dot: 'error', text: 'Cannot read the process list', detail: status.lastError };
  }
  if (status.inGame) {
    const session = status.session;
    const elapsed = formatDuration(Date.now() - session.startedAt);
    return {
      dot: 'ingame',
      text: session.queueName ? `In game · ${session.queueName}` : 'In game',
      detail: `Running for ${elapsed} — reminders fire when the game client closes.`,
    };
  }
  return {
    dot: 'idle',
    text: 'Waiting for a game',
    detail: status.launcherRunning
      ? 'League launcher is open. Start a game whenever you like.'
      : 'League launcher is closed. The watcher keeps running.',
  };
}

function pill(label, on) {
  const span = document.createElement('span');
  span.className = on ? 'pill on' : 'pill';
  span.textContent = label;
  return span;
}

function renderStatus() {
  if (!state) return;
  const { status, settings, stats } = state;
  const view = statusView(status);

  els.statusDot.className = `status-dot ${view.dot}`;
  els.statusText.textContent = view.text;
  els.statusDetail.textContent = view.detail;

  const secondsAgo = status.lastScanAt ? Math.round((Date.now() - status.lastScanAt) / 1000) : null;
  els.statusMeta.replaceChildren(
    pill(status.launcherRunning ? 'Launcher open' : 'Launcher closed', status.launcherRunning),
    pill(
      settings.useLcu
        ? status.lcuConnected
          ? 'Launcher API connected'
          : 'Launcher API idle'
        : 'Launcher API off',
      status.lcuConnected,
    ),
    pill(secondsAgo === null ? 'No scan yet' : `Last scan ${secondsAgo}s ago`, false),
    pill(`${plural(stats.gamesPlayed, 'game')} logged`, false),
    ...(state.pendingReminders > 0 ? [pill(`${plural(state.pendingReminders, 'reminder')} queued`, true)] : []),
  );

  if (els.watchEnabled.checked !== settings.watchEnabled) els.watchEnabled.checked = settings.watchEnabled;
  els.notificationWarning.hidden = state.notificationsSupported;
  els.loginHint.hidden = state.platform !== 'linux';
}

/* ---------------------------------------------------------------- history */

function renderHistory() {
  const history = state?.history || [];
  els.history.replaceChildren();

  if (history.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Finished games will show up here.';
    els.history.append(empty);
    return;
  }

  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const label of ['Ended', 'Game', 'Queue', 'Length', 'Reminders']) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  table.append(head);

  const skipLabels = {
    'too-short': 'skipped — too short',
    'game-type-muted': 'skipped — type muted',
    'no-matching-reminders': 'skipped — none matched',
  };

  for (const entry of history) {
    const tr = document.createElement('tr');
    const cells = [
      formatTime(entry.endedAt),
      entry.isTFT === true ? 'TFT' : entry.isTFT === false ? 'League' : 'Unknown',
      entry.queueName || '—',
      formatDuration(entry.durationMs),
      entry.skippedReason ? skipLabels[entry.skippedReason] || entry.skippedReason : 'sent',
    ];
    cells.forEach((value, index) => {
      const td = document.createElement('td');
      td.textContent = value;
      if (index >= 2) td.className = 'muted';
      tr.append(td);
    });
    table.append(tr);
  }
  els.history.append(table);
}

/* --------------------------------------------------------------- settings */

function renderSettingsInputs() {
  const settings = state.settings;
  for (const input of document.querySelectorAll('[data-setting]')) {
    if (document.activeElement === input) continue;
    const key = input.dataset.setting;
    if (input.type === 'checkbox') input.checked = Boolean(settings[key]);
    else input.value = String(settings[key]);
  }
  if (document.activeElement !== els.extraProcesses) {
    els.extraProcesses.value = settings.extraGameProcessNames.join('\n');
  }
}

function bindSettingsInputs() {
  for (const input of document.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    // Checkboxes save on toggle; numbers save on commit, so clamping does not
    // rewrite the field halfway through typing.
    input.addEventListener('change', () => {
      const value = input.type === 'checkbox' ? input.checked : Number(input.value);
      save({ [key]: value });
    });
  }

  els.extraProcesses.addEventListener('change', () => {
    const names = els.extraProcesses.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    save({ extraGameProcessNames: names });
  });

  els.watchEnabled.addEventListener('change', () => {
    save({ watchEnabled: els.watchEnabled.checked });
  });

  document.getElementById('add-reminder').addEventListener('click', () => {
    reminders.push({
      id: `local-${Date.now()}-${reminders.length}`,
      text: '',
      enabled: true,
      delaySeconds: 0,
      appliesTo: 'any',
      everyNGames: 1,
    });
    renderReminders();
    els.reminders.querySelector('.reminder:last-child input[type="text"]')?.focus();
  });

  document.getElementById('test-notification').addEventListener('click', async () => {
    await window.api.sendTestNotification();
    flash('Test reminder sent');
  });

  document.getElementById('clear-history').addEventListener('click', () => window.api.clearHistory());
  document.getElementById('open-config').addEventListener('click', () => window.api.openConfigFolder());
  document.getElementById('quit').addEventListener('click', () => window.api.quit());
}

/* ------------------------------------------------------------------- init */

function sameReminderShape(a, b) {
  return a.length === b.length && a.every((reminder, index) => reminder.id === b[index].id);
}

function applyState(next) {
  state = next;

  // Only adopt reminders from the main process when the list actually changed
  // structurally and the user is not mid-edit — otherwise typing would fight
  // the incoming state.
  if (!isEditing(els.reminders) && !sameReminderShape(reminders, next.settings.reminders)) {
    reminders = next.settings.reminders.map((reminder) => ({ ...reminder }));
    renderReminders();
  }

  renderSettingsInputs();
  renderStatus();
  renderHistory();

  els.footerInfo.textContent = `v${next.version} · ${next.platform} · ${next.configPath}`;
}

async function init() {
  bindSettingsInputs();
  const initial = await window.api.getState();
  reminders = initial.settings.reminders.map((reminder) => ({ ...reminder }));
  renderReminders();
  applyState(initial);

  window.api.onState(applyState);
  // Keeps the in-game timer and "last scan" counter moving between pushes.
  setInterval(renderStatus, 1000);
}

init();
