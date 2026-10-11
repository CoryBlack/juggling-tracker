// ---------- Storage keys ----------
const LS_DATA = 'juggling-data-v1';
const LS_SHA = 'juggling-data-sha';
const LS_SETTINGS = 'juggling-settings-v1';
const LS_PENDING = 'juggling-pending-sync';
const LS_DRAFT = 'juggling-draft-v1'; // in-progress practice session, saved after every edit so it survives a tab switch or the app getting reloaded/killed mid-practice

const DEFAULT_CATEGORIES = ['Clubs', 'Balls', 'Soccer/Freestyle', 'Bounce', 'Balance', 'Rings', 'Other'];
const UNIT_PRESETS = ['catches', 'reps', 'seconds', 'successful attempts', 'rounds'];

// ---------- State ----------
let state = loadLocalData();
let settings = loadSettings();
let currentSession = null; // { id, date, startedAt, entries: [...] } while a practice is in progress
let trickLogActiveIndex = null; // index into currentSession.entries currently being logged
let progressReturnTo = 'progress'; // which top-level tab to return to from the progress detail view
let progressDetailTrickId = null;
let openHistorySessionId = null;
let libraryEditingId = null; // which trick's row is expanded in Settings > Trick Library

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireEvents();
  loadDraft();
  updateTrainTabLabel();
  renderTrain();
  showView('view-train');
  await refreshFromGitHub(true);
}

// ---------- Draft persistence (active session) ----------
function saveDraft() {
  if (!currentSession) { localStorage.removeItem(LS_DRAFT); return; }
  localStorage.setItem(LS_DRAFT, JSON.stringify(currentSession));
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(LS_DRAFT);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (!draft || !draft.id) return;
    currentSession = draft;
  } catch (e) { console.warn('draft parse failed', e); }
}

function clearDraft() {
  localStorage.removeItem(LS_DRAFT);
}

function updateTrainTabLabel() {
  const btn = document.getElementById('trainTabBtn');
  if (!btn) return;
  btn.classList.toggle('has-draft', !!currentSession);
}

// ---------- Local data ----------
function loadLocalData() {
  try {
    const raw = localStorage.getItem(LS_DATA);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn('local data parse failed', e); }
  return { categories: [...DEFAULT_CATEGORIES], tricks: [], sessions: [], priorities: [] };
}

function saveLocalData() {
  localStorage.setItem(LS_DATA, JSON.stringify(state));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { ghUser: '', ghRepo: '', ghBranch: 'main', ghToken: '' };
}

function saveSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
}

function ghConfigured() {
  return !!(settings.ghUser && settings.ghRepo && settings.ghToken);
}

// ---------- GitHub sync ----------
function ghApiUrl() {
  const path = 'data.json';
  return `https://api.github.com/repos/${settings.ghUser}/${settings.ghRepo}/contents/${path}`;
}

function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64DecodeUnicode(str) {
  return decodeURIComponent(escape(atob(str)));
}

async function ghFetchRemote() {
  const branch = settings.ghBranch || 'main';
  const res = await fetch(`${ghApiUrl()}?ref=${encodeURIComponent(branch)}&_=${Date.now()}`, {
    headers: {
      'Authorization': `Bearer ${settings.ghToken}`,
      'Accept': 'application/vnd.github+json'
    }
  });
  if (res.status === 404) return null; // file doesn't exist yet
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const json = await res.json();
  const content = JSON.parse(b64DecodeUnicode(json.content.replace(/\n/g, '')));
  localStorage.setItem(LS_SHA, json.sha);
  return content;
}

async function ghPushLocal() {
  if (!ghConfigured()) return;
  setSyncStatus('pending', 'Saving…');
  try {
    const sha = localStorage.getItem(LS_SHA) || undefined;
    const body = {
      message: `Update juggling data — ${new Date().toISOString()}`,
      content: b64EncodeUnicode(JSON.stringify(state, null, 2)),
      branch: settings.ghBranch || 'main'
    };
    if (sha) body.sha = sha;
    const res = await fetch(ghApiUrl(), {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${settings.ghToken}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (res.status === 409 || res.status === 422) {
      // sha mismatch — remote changed since we last read it
      const remote = await ghFetchRemote();
      setSyncStatus('error', 'Sync conflict — reloaded latest from GitHub. Please redo your last change.');
      if (remote) {
        state = remote;
        saveLocalData();
        renderTrain();
      }
      localStorage.removeItem(LS_PENDING);
      return;
    }
    if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status}`);
    const json = await res.json();
    localStorage.setItem(LS_SHA, json.content.sha);
    localStorage.removeItem(LS_PENDING);
    setSyncStatus('ok', 'Synced');
  } catch (e) {
    console.warn('push failed', e);
    localStorage.setItem(LS_PENDING, '1');
    setSyncStatus('error', 'Offline — will retry');
  }
}

async function refreshFromGitHub(initial) {
  if (!ghConfigured()) {
    setSyncStatus('pending', 'Not configured');
    return;
  }
  if (localStorage.getItem(LS_PENDING)) {
    await ghPushLocal();
    return;
  }
  setSyncStatus('pending', 'Syncing…');
  try {
    const remote = await ghFetchRemote();
    if (remote) {
      state = remote;
      saveLocalData();
      renderTrain();
      setSyncStatus('ok', 'Synced');
    } else if (initial) {
      await ghPushLocal();
    }
  } catch (e) {
    console.warn('refresh failed', e);
    setSyncStatus('error', 'Offline (using cached data)');
  }
}

function setSyncStatus(cls, text) {
  const el = document.getElementById('syncStatus');
  el.className = cls;
  document.getElementById('syncStatusText').textContent = text;
}

async function persist() {
  saveLocalData();
  await ghPushLocal();
}

// ---------- Utilities ----------
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRelative(iso) {
  const today = todayISO();
  if (iso === today) return 'Today';
  const d = new Date(iso + 'T00:00:00');
  const t = new Date(today + 'T00:00:00');
  const diffDays = Math.round((t - d) / 86400000);
  if (diffDays === 1) return 'Yesterday';
  return formatDate(iso);
}

// Short form used in stat bars, e.g. "Oct 6".
function formatDateShort(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function pad2(n) { return String(n).padStart(2, '0'); }

function dateToISO(dt) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

// Monday of the calendar week containing the given date (ISO in, ISO out).
function getWeekStartISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0 = Sun .. 6 = Sat
  const diff = (day === 0 ? -6 : 1) - day;
  dt.setDate(dt.getDate() + diff);
  return dateToISO(dt);
}

function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// This calendar week (Monday through today, inclusive) across all saved sessions.
function weekStats() {
  const today = todayISO();
  const weekStart = getWeekStartISO(today);
  const sessionsThisWeek = state.sessions.filter(s => s.date >= weekStart && s.date <= today);
  const totalMinutes = sessionsThisWeek.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  return { totalMinutes, count: sessionsThisWeek.length, weekStart };
}

function renderWeekStatBar() {
  const { totalMinutes, count, weekStart } = weekStats();
  const since = `since ${formatDateShort(weekStart)}`;
  let html;
  if (count === 0) {
    html = `This week (${since}): no practices logged yet`;
  } else if (totalMinutes > 0) {
    html = `This week (${since}): <strong>${formatDuration(totalMinutes)}</strong> · ${count} session${count === 1 ? '' : 's'}`;
  } else {
    html = `This week (${since}): ${count} session${count === 1 ? '' : 's'} · no time logged`;
  }
  document.querySelectorAll('.week-stat-bar').forEach(el => { el.innerHTML = html; });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Trick / history lookups ----------
function getTrick(id) {
  return state.tricks.find(t => t.id === id);
}

function activeTricks() {
  return state.tricks.filter(t => !t.archived);
}

function sortedSessions() {
  return [...state.sessions].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
}

function getTrickPB(trickId) {
  let max = null;
  state.sessions.forEach(s => s.entries.forEach(e => {
    if (e.trickId === trickId && typeof e.best === 'number') {
      if (max === null || e.best > max) max = e.best;
    }
  }));
  return max;
}

function findLastEntry(trickId) {
  const sessions = sortedSessions();
  for (const s of sessions) {
    const e = s.entries.find(e => e.trickId === trickId);
    if (e) return { session: s, entry: e };
  }
  return null;
}

// Matches anywhere in the name, ranked by how recently the trick was last trained —
// most recently practiced first. Tricks never logged sort last, alphabetically.
function matchTricks(pool, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return pool.slice();
  const filtered = pool.filter(t => t.name.toLowerCase().includes(q));
  const lastDates = new Map();
  filtered.forEach(t => {
    if (!lastDates.has(t.id)) {
      const last = findLastEntry(t.id);
      lastDates.set(t.id, last ? last.session.date : null);
    }
  });
  return filtered.sort((a, b) => {
    const da = lastDates.get(a.id), db = lastDates.get(b.id);
    if (da && db) return db.localeCompare(da);
    if (da) return -1;
    if (db) return 1;
    return a.name.localeCompare(b.name);
  });
}

function categoryOptionsHtml(selected) {
  return `<option value="" ${!selected ? 'selected' : ''}>None</option>` +
    state.categories.map(c => `<option value="${escapeHtml(c)}" ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

function unitOptionsHtml(selected) {
  const isPreset = UNIT_PRESETS.includes(selected);
  return UNIT_PRESETS.map(u => `<option value="${u}" ${u === selected ? 'selected' : ''}>${u}</option>`).join('') +
    `<option value="__custom" ${!isPreset ? 'selected' : ''}>Custom…</option>`;
}

// =====================================================================
// TRAIN
// =====================================================================
function renderTrain() {
  renderWeekStatBar();
  const hasSession = !!currentSession;
  document.getElementById('trainEmptyState').hidden = hasSession;
  document.getElementById('trainActive').hidden = !hasSession;
  if (hasSession) {
    document.getElementById('trainDateLabel').textContent = formatDate(currentSession.date);
    renderSessionTrickList();
  }
}

function startNewSession() {
  currentSession = {
    id: uuid(),
    date: todayISO(),
    startedAt: new Date().toISOString(),
    durationMinutes: null,
    durationManuallySet: false,
    entries: []
  };
  saveDraft();
  updateTrainTabLabel();
  renderTrain();
}

function discardSession() {
  if (!currentSession) return;
  if (!confirm('Discard this in-progress practice? This cannot be undone.')) return;
  currentSession = null;
  clearDraft();
  updateTrainTabLabel();
  renderTrain();
}

function entrySummaryText(entry, trick) {
  const parts = [];
  if (entry.best != null) parts.push(`Best: ${entry.best} ${trick.unit}`);
  if (entry.goalTarget != null) {
    const done = (entry.goalSetResults || []).filter(Boolean).length;
    parts.push(`${done}/${entry.goalSetsDesired}`);
  }
  if (entry.notes) parts.push('Note added');
  return parts.join(' · ') || 'Tap to log';
}

function renderSessionTrickList() {
  const box = document.getElementById('sessionTrickList');
  if (!currentSession.entries.length) {
    box.innerHTML = `<p class="hint">None yet — tap "+ Add Trick" below.</p>`;
    return;
  }
  box.innerHTML = currentSession.entries.map((e, idx) => {
    const trick = getTrick(e.trickId);
    if (!trick) return '';
    return `<div class="current-ex-card" data-idx="${idx}">
      <div class="cx-main" data-idx="${idx}">
        <div class="cx-info"><b>${escapeHtml(trick.name)}</b><span>${escapeHtml(entrySummaryText(e, trick))}</span></div>
      </div>
      <div class="cx-actions">
        <button type="button" class="up-btn" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
        <button type="button" class="down-btn" data-idx="${idx}" ${idx === currentSession.entries.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
        <button type="button" class="remove-btn" data-idx="${idx}" aria-label="Remove">✕</button>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('.cx-main').forEach(el => {
    el.addEventListener('click', () => openTrickLog(Number(el.dataset.idx)));
  });
  box.querySelectorAll('.up-btn').forEach(btn => {
    btn.addEventListener('click', () => moveSessionEntry(Number(btn.dataset.idx), -1));
  });
  box.querySelectorAll('.down-btn').forEach(btn => {
    btn.addEventListener('click', () => moveSessionEntry(Number(btn.dataset.idx), 1));
  });
  box.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removeSessionEntry(Number(btn.dataset.idx)));
  });
}

function moveSessionEntry(idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= currentSession.entries.length) return;
  const arr = currentSession.entries;
  [arr[idx], arr[j]] = [arr[j], arr[idx]];
  renderSessionTrickList();
  saveDraft();
}

function removeSessionEntry(idx) {
  const e = currentSession.entries[idx];
  const hasData = e.best != null || e.notes || e.goalTarget != null;
  if (hasData && !confirm('Remove this trick from today\'s practice? Anything logged for it will be lost.')) return;
  currentSession.entries.splice(idx, 1);
  renderSessionTrickList();
  saveDraft();
}

// ---------- Add trick to session ----------
function openAddTrickView() {
  document.getElementById('trickPicker').value = '';
  document.getElementById('trickSuggestions').hidden = true;
  document.getElementById('trickSuggestions').innerHTML = '';
  document.getElementById('newTrickFields').hidden = true;
  document.getElementById('newTrickCategory').innerHTML = categoryOptionsHtml('');
  document.getElementById('newTrickUnit').innerHTML = `<option value="catches">catches</option><option value="reps">reps</option><option value="seconds">seconds</option><option value="successful attempts">successful attempts</option><option value="rounds">rounds</option><option value="__custom">Custom…</option>`;
  document.getElementById('newTrickUnitCustom').hidden = true;
  document.getElementById('newTrickUnitCustom').value = '';
  showView('view-add-trick');
}

function updateTrickSuggestions() {
  const input = document.getElementById('trickPicker');
  const box = document.getElementById('trickSuggestions');
  const newFields = document.getElementById('newTrickFields');
  const typed = input.value.trim();
  if (!typed) { box.hidden = true; box.innerHTML = ''; newFields.hidden = true; return; }

  const pool = activeTricks().filter(t => !currentSession.entries.some(e => e.trickId === t.id));
  const matches = matchTricks(pool, typed).slice(0, 8);

  if (matches.length) {
    box.hidden = false;
    box.innerHTML = matches.map(t =>
      `<div class="suggest-item" data-id="${t.id}">${escapeHtml(t.name)}${t.category ? `<span class="si-cat">${escapeHtml(t.category)}</span>` : ''}</div>`
    ).join('');
    box.querySelectorAll('.suggest-item').forEach(item => {
      item.addEventListener('mousedown', e => e.preventDefault());
      item.addEventListener('click', () => pickExistingTrick(item.dataset.id));
    });
  } else {
    box.hidden = true; box.innerHTML = '';
  }

  const exact = state.tricks.find(t => t.name.toLowerCase() === typed.toLowerCase());
  if (!exact) {
    newFields.hidden = false;
    document.getElementById('newTrickNamePreview').textContent = typed;
  } else {
    newFields.hidden = true;
  }
}

function addTrickEntry(trickId) {
  if (currentSession.entries.some(e => e.trickId === trickId)) {
    alert('Already in today\'s practice — tap it in the list to log it.');
    return false;
  }
  currentSession.entries.push({ trickId, best: null, goalTarget: null, goalSetsDesired: null, goalSetResults: [], notes: '' });
  return true;
}

function pickExistingTrick(id) {
  if (!addTrickEntry(id)) return;
  saveDraft();
  renderSessionTrickList();
  showView('view-train');
}

function createNewTrickFromForm() {
  const nameInput = document.getElementById('trickPicker');
  const name = nameInput.value.trim();
  if (!name) return;
  if (state.tricks.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    alert('A trick with this name already exists — pick it from the list above.');
    return;
  }
  const category = document.getElementById('newTrickCategory').value;
  const unitSel = document.getElementById('newTrickUnit').value;
  const unit = unitSel === '__custom'
    ? (document.getElementById('newTrickUnitCustom').value.trim() || 'reps')
    : unitSel;
  const trick = { id: uuid(), name, category, unit, createdAt: todayISO(), archived: false };
  state.tricks.push(trick);
  saveLocalData();
  if (!addTrickEntry(trick.id)) return;
  saveDraft();
  renderSessionTrickList();
  showView('view-train');
  persist();
}

// ---------- Trick logging ----------
function openTrickLog(index) {
  trickLogActiveIndex = index;
  const entry = currentSession.entries[index];
  const trick = getTrick(entry.trickId);
  if (!trick) return;
  document.getElementById('trickLogTitle').textContent = trick.name;
  document.getElementById('trickLogUnitLabel').textContent = `(${trick.unit})`;
  document.getElementById('trickBestInput').value = entry.best ?? '';
  document.getElementById('trickNotesInput').value = entry.notes || '';
  renderLastSessionBox(trick);
  renderGoalBox();
  updatePrIndicator();
  showView('view-trick-log');
}

function renderLastSessionBox(trick) {
  const box = document.getElementById('trickLogLastSession');
  const pb = getTrickPB(trick.id);
  const last = findLastEntry(trick.id);
  if (!last && pb == null) {
    box.innerHTML = `<div class="last-time-box">No previous record for this trick yet — today is session one.</div>`;
    return;
  }
  let html = '<div class="last-time-box">';
  html += `<div class="lt-row"><span>Last practiced</span><strong>${last ? formatRelative(last.session.date) : '—'}</strong></div>`;
  if (pb != null) html += `<div class="lt-row"><span>Record</span><span class="lt-pb">${pb} ${escapeHtml(trick.unit)}</span></div>`;
  if (last) {
    const e = last.entry;
    if (e.goalTarget != null) {
      const done = (e.goalSetResults || []).filter(Boolean).length;
      html += `<div class="lt-row"><span>Last goal</span><span>${e.goalTarget} ${escapeHtml(trick.unit)} × ${e.goalSetsDesired} — ${done}/${e.goalSetsDesired}</span></div>`;
    }
    if (e.notes) html += `<div class="lt-notes">"${escapeHtml(e.notes)}"</div>`;
  }
  html += '</div>';
  box.innerHTML = html;
}

function updatePrIndicator() {
  const entry = currentSession.entries[trickLogActiveIndex];
  const trick = getTrick(entry.trickId);
  const el = document.getElementById('trickPrIndicator');
  const pb = getTrickPB(trick.id);
  if (entry.best != null && (pb == null || entry.best > pb)) {
    el.hidden = false;
    el.textContent = `🎉 New PB! ${entry.best} ${trick.unit}`;
  } else {
    el.hidden = true;
  }
}

function renderGoalBox() {
  const box = document.getElementById('goalBox');
  const entry = currentSession.entries[trickLogActiveIndex];
  const trick = getTrick(entry.trickId);

  if (entry.goalTarget == null || entry.goalSetsDesired == null) {
    box.innerHTML = `
      <div class="goal-setup">
        <h3 class="section-label" style="margin-top:0;">Goal (optional)</h3>
        <div class="two-col">
          <div class="field">
            <label for="goalTargetInput">Target (${escapeHtml(trick.unit)})</label>
            <input type="number" inputmode="numeric" id="goalTargetInput" placeholder="e.g. 20">
          </div>
          <div class="field">
            <label for="goalSetsInput"># of sets</label>
            <input type="number" inputmode="numeric" id="goalSetsInput" placeholder="e.g. 10">
          </div>
        </div>
        <button type="button" class="btn small" id="setGoalBtn">Set Goal</button>
      </div>`;
    document.getElementById('setGoalBtn').addEventListener('click', () => {
      const target = Number(document.getElementById('goalTargetInput').value);
      const sets = Number(document.getElementById('goalSetsInput').value);
      if (!target || !sets || sets < 1) { alert('Enter a target and a number of sets.'); return; }
      entry.goalTarget = target;
      entry.goalSetsDesired = sets;
      entry.goalSetResults = new Array(sets).fill(false);
      saveDraft();
      renderGoalBox();
    });
  } else {
    const done = entry.goalSetResults.filter(Boolean).length;
    box.innerHTML = `
      <div class="goal-active">
        <div class="goal-active-top">
          <div class="goal-active-title">${entry.goalTarget} ${escapeHtml(trick.unit)} × ${entry.goalSetsDesired}</div>
          <div class="goal-active-count">${done} / ${entry.goalSetsDesired}</div>
        </div>
        <div class="goal-grid">
          ${entry.goalSetResults.map((v, i) => `<button type="button" class="goal-dot${v ? ' done' : ''}" data-i="${i}">${v ? '✓' : i + 1}</button>`).join('')}
        </div>
        <button type="button" class="goal-edit-link" id="editGoalBtn">Edit goal</button>
      </div>`;
    box.querySelectorAll('.goal-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        const i = Number(dot.dataset.i);
        entry.goalSetResults[i] = !entry.goalSetResults[i];
        saveDraft();
        renderGoalBox();
      });
    });
    document.getElementById('editGoalBtn').addEventListener('click', () => {
      const anyDone = entry.goalSetResults.some(Boolean);
      if (anyDone && !confirm('Change the goal? This resets today\'s progress toward it.')) return;
      entry.goalTarget = null;
      entry.goalSetsDesired = null;
      entry.goalSetResults = [];
      saveDraft();
      renderGoalBox();
    });
  }
}

// =====================================================================
// FINISH / SAVE PRACTICE
// =====================================================================
function openFinishView() {
  if (!currentSession.entries.length) { alert('Add at least one trick before finishing.'); return; }
  document.getElementById('finishTitle').textContent = formatDate(currentSession.date) + ' Practice';

  const hoursInput = document.getElementById('finishHoursInput');
  const minutesInput = document.getElementById('finishMinutesInput');
  if (!currentSession.durationManuallySet) {
    // No explicit entry yet — default to actual elapsed time since the session started,
    // so the common case ("I just trained for a while") needs no typing at all.
    const elapsed = currentSession.startedAt
      ? Math.max(0, Math.round((Date.now() - new Date(currentSession.startedAt).getTime()) / 60000))
      : 0;
    currentSession.durationMinutes = elapsed || null;
  }
  const total = currentSession.durationMinutes || 0;
  hoursInput.value = total ? Math.floor(total / 60) : '';
  minutesInput.value = total ? total % 60 : '';

  const box = document.getElementById('finishSummary');
  box.innerHTML = currentSession.entries.map(e => {
    const trick = getTrick(e.trickId);
    let html = `<div class="card"><div class="card-title" style="margin-bottom:6px;">${escapeHtml(trick.name)}</div>`;
    if (e.best != null) html += `<div class="set-line"><span class="label">Best</span><span>${e.best} ${escapeHtml(trick.unit)}</span></div>`;
    if (e.goalTarget != null) {
      const done = (e.goalSetResults || []).filter(Boolean).length;
      html += `<div class="set-line"><span class="label">Goal</span><span>${e.goalTarget} ${escapeHtml(trick.unit)} × ${e.goalSetsDesired} — ${done}/${e.goalSetsDesired}</span></div>`;
    }
    if (e.notes) html += `<div class="set-line"><span class="label">Notes</span><span>"${escapeHtml(e.notes)}"</span></div>`;
    if (e.best == null && e.goalTarget == null && !e.notes) html += `<p class="hint">Nothing logged for this one.</p>`;
    html += `</div>`;
    return html;
  }).join('');
  showView('view-finish');
}

function savePractice() {
  const snapshotEntries = currentSession.entries.map(e => {
    const trick = getTrick(e.trickId);
    return {
      trickId: e.trickId,
      name: trick.name,
      unit: trick.unit,
      best: e.best,
      goalTarget: e.goalTarget,
      goalSetsDesired: e.goalSetsDesired,
      goalSetResults: e.goalSetResults,
      notes: e.notes
    };
  });
  const session = {
    id: currentSession.id,
    date: currentSession.date,
    startedAt: currentSession.startedAt,
    finishedAt: new Date().toISOString(),
    durationMinutes: currentSession.durationMinutes || null,
    entries: snapshotEntries
  };
  state.sessions.push(session);
  saveLocalData();

  currentSession = null;
  clearDraft();
  updateTrainTabLabel();
  renderTrain();
  showView('view-train');
  persist();
}

// =====================================================================
// PRIORITIES
// =====================================================================
function renderPriorities() {
  const box = document.getElementById('prioritiesList');
  const list = [...state.priorities].sort((a, b) => a.order - b.order);
  if (!list.length) {
    box.innerHTML = `<div class="empty-state">No priorities set yet.<br>Add the skills you want to focus on right now.</div>`;
    return;
  }
  box.innerHTML = list.map((p, idx) => {
    const trick = getTrick(p.trickId);
    if (!trick) return '';
    const pb = getTrickPB(trick.id);
    const last = findLastEntry(trick.id);
    const recentBest = last && typeof last.entry.best === 'number' ? last.entry.best : null;
    return `<div class="priority-card">
      <div class="priority-rank">${idx + 1}</div>
      <div class="priority-main" data-id="${trick.id}">
        <div class="priority-name">${escapeHtml(trick.name)}</div>
        <div class="priority-meta">
          <span>Last: ${last ? formatRelative(last.session.date) : 'Never'}</span>
          ${pb != null ? `<span class="pb">PB: ${pb} ${escapeHtml(trick.unit)}</span>` : ''}
          ${recentBest != null ? `<span>Recent: ${recentBest} ${escapeHtml(trick.unit)}</span>` : ''}
        </div>
      </div>
      <div class="priority-actions">
        <button type="button" class="up-btn" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
        <button type="button" class="down-btn" data-idx="${idx}" ${idx === list.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
        <button type="button" class="remove-btn" data-idx="${idx}">Remove</button>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('.priority-main').forEach(el => {
    el.addEventListener('click', () => openProgressDetail(el.dataset.id, 'priorities'));
  });
  box.querySelectorAll('.up-btn').forEach(btn => btn.addEventListener('click', () => movePriority(Number(btn.dataset.idx), -1)));
  box.querySelectorAll('.down-btn').forEach(btn => btn.addEventListener('click', () => movePriority(Number(btn.dataset.idx), 1)));
  box.querySelectorAll('.remove-btn').forEach(btn => btn.addEventListener('click', () => removePriority(Number(btn.dataset.idx))));
}

function movePriority(idx, dir) {
  const list = [...state.priorities].sort((a, b) => a.order - b.order);
  const j = idx + dir;
  if (j < 0 || j >= list.length) return;
  const tmp = list[idx].order;
  list[idx].order = list[j].order;
  list[j].order = tmp;
  saveLocalData();
  renderPriorities();
  persist();
}

function removePriority(idx) {
  const list = [...state.priorities].sort((a, b) => a.order - b.order);
  const p = list[idx];
  state.priorities = state.priorities.filter(x => x !== p);
  saveLocalData();
  renderPriorities();
  persist();
}

function openAddPriorityView() {
  document.getElementById('prioritySearch').value = '';
  renderPriorityPickList();
  showView('view-add-priority');
}

function renderPriorityPickList() {
  const query = document.getElementById('prioritySearch').value;
  const pool = activeTricks().filter(t => !state.priorities.some(p => p.trickId === t.id));
  const matches = matchTricks(pool, query);
  const box = document.getElementById('priorityPickList');
  if (!matches.length) {
    box.innerHTML = `<div class="empty-state">${pool.length ? 'No matches.' : 'All your tricks are already priorities.'}</div>`;
    return;
  }
  box.innerHTML = matches.map(t =>
    `<div class="current-ex-card exercise-lib-card" data-id="${t.id}"><div class="cx-info"><b>${escapeHtml(t.name)}</b><span>${escapeHtml(t.category || 'Uncategorized')}</span></div><span class="chev">+</span></div>`
  ).join('');
  box.querySelectorAll('[data-id]').forEach(card => card.addEventListener('click', () => {
    const maxOrder = state.priorities.reduce((m, p) => Math.max(m, p.order), -1);
    state.priorities.push({ trickId: card.dataset.id, order: maxOrder + 1, addedAt: todayISO() });
    saveLocalData();
    persist();
    showView('view-priorities');
    renderPriorities();
  }));
}

// =====================================================================
// PROGRESS
// =====================================================================
function renderProgressList() {
  const query = document.getElementById('progressSearch').value;
  const pool = matchTricks(state.tricks, query);
  const box = document.getElementById('progressTrickList');
  if (!pool.length) {
    box.innerHTML = `<div class="empty-state">${state.tricks.length ? 'No tricks match.' : 'No tricks yet — add one from Train.'}</div>`;
    return;
  }
  const byCat = {};
  pool.forEach(t => {
    const cat = t.category || 'Uncategorized';
    (byCat[cat] = byCat[cat] || []).push(t);
  });
  const catOrder = [...state.categories, 'Uncategorized', ...Object.keys(byCat).filter(c => !state.categories.includes(c) && c !== 'Uncategorized')];
  const hasQuery = !!query.trim();
  let html = '';
  catOrder.forEach(cat => {
    const list = (byCat[cat] || []).slice();
    if (!hasQuery) list.sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) return;
    html += `<h3 class="section-label">${escapeHtml(cat)}</h3>`;
    html += list.map(t => {
      const last = findLastEntry(t.id);
      const lastText = last ? `Last: ${formatRelative(last.session.date)}` : 'No history yet';
      return `<div class="current-ex-card exercise-lib-card" data-id="${t.id}">
        <div class="cx-info"><b>${escapeHtml(t.name)}${t.archived ? ' (archived)' : ''}</b><span>${lastText}</span></div>
        <span class="chev">›</span>
      </div>`;
    }).join('');
  });
  box.innerHTML = html;
  box.querySelectorAll('[data-id]').forEach(card => card.addEventListener('click', () => openProgressDetail(card.dataset.id, 'progress')));
}

function openProgressDetail(trickId, returnTo) {
  progressReturnTo = returnTo || 'progress';
  progressDetailTrickId = trickId;
  const trick = getTrick(trickId);
  if (!trick) return;
  document.getElementById('progressDetailTitle').textContent = trick.name;
  const pb = getTrickPB(trickId);
  const last = findLastEntry(trickId);
  document.getElementById('progressDetailStats').innerHTML = `<div class="last-time-box">
    <div class="lt-row"><span>Personal best</span><span class="lt-pb">${pb != null ? pb + ' ' + escapeHtml(trick.unit) : '—'}</span></div>
    <div class="lt-row"><span>Last practiced</span><strong>${last ? formatRelative(last.session.date) : 'Never'}</strong></div>
  </div>`;

  const historyBox = document.getElementById('progressDetailHistory');
  const entries = sortedSessions()
    .map(s => ({ session: s, entry: s.entries.find(e => e.trickId === trickId) }))
    .filter(x => x.entry);
  if (!entries.length) {
    historyBox.innerHTML = `<div class="empty-state">No sessions logged yet.</div>`;
  } else {
    historyBox.innerHTML = entries.map(({ session, entry }) => {
      const isPb = pb != null && entry.best === pb;
      let html = `<div class="workout-detail"><div class="card-top" style="margin-bottom:8px;"><div class="card-title" style="font-size:15px;">${formatDate(session.date)}</div></div>`;
      if (entry.best != null) html += `<div class="set-line${isPb ? ' pr' : ''}"><span class="label">Best</span><span class="value">${entry.best} ${escapeHtml(entry.unit || trick.unit)}${isPb ? ' 🎉' : ''}</span></div>`;
      if (entry.goalTarget != null) {
        const done = (entry.goalSetResults || []).filter(Boolean).length;
        html += `<div class="set-line"><span class="label">Goal</span><span>${entry.goalTarget} ${escapeHtml(entry.unit || trick.unit)} × ${entry.goalSetsDesired} — ${done}/${entry.goalSetsDesired}</span></div>`;
      }
      if (entry.notes) html += `<div class="set-line"><span class="label">Notes</span><span>"${escapeHtml(entry.notes)}"</span></div>`;
      html += `</div>`;
      return html;
    }).join('');
  }
  showView('view-progress-detail');
}

function startTrainingFromProgress() {
  const trickId = progressDetailTrickId;
  if (!trickId) return;
  if (!currentSession) startNewSession();
  let idx = currentSession.entries.findIndex(e => e.trickId === trickId);
  if (idx === -1) {
    currentSession.entries.push({ trickId, best: null, goalTarget: null, goalSetsDesired: null, goalSetResults: [], notes: '' });
    idx = currentSession.entries.length - 1;
    saveDraft();
  }
  updateTrainTabLabel();
  openTrickLog(idx);
}

// =====================================================================
// HISTORY
// =====================================================================
function renderHistoryList() {
  renderWeekStatBar();
  const box = document.getElementById('historyList');
  const sessions = sortedSessions();
  if (!sessions.length) {
    box.innerHTML = `<div class="empty-state">No practices logged yet.<br>Tap Train to get started.</div>`;
    return;
  }
  box.innerHTML = sessions.map(s => {
    const durText = formatDuration(s.durationMinutes);
    return `<div class="card tappable" data-id="${s.id}">
      <div class="card-top"><div class="card-title">${formatDate(s.date)}</div>${durText ? `<div class="card-sub">${durText}</div>` : ''}</div>
      <div class="card-summary">${s.entries.length} skill${s.entries.length === 1 ? '' : 's'} trained — ${escapeHtml(s.entries.map(e => e.name).join(', '))}</div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-id]').forEach(card => card.addEventListener('click', () => openHistoryDetail(card.dataset.id)));
}

function openHistoryDetail(id) {
  openHistorySessionId = id;
  const s = state.sessions.find(x => x.id === id);
  if (!s) return;
  const box = document.getElementById('historyDetailContent');
  const durMinutes = s.durationMinutes || 0;
  box.innerHTML = `<h2>${formatDate(s.date)}</h2>
    <p class="hint" style="margin-bottom:16px;">${s.entries.length} skill${s.entries.length === 1 ? '' : 's'} trained</p>
    <h3 class="section-label" style="margin-top:0;">Session Length</h3>
    <div class="two-col" style="max-width:280px;">
      <div class="field">
        <label for="historyDurationHours">Hours</label>
        <input type="number" inputmode="numeric" id="historyDurationHours" placeholder="0" min="0" value="${durMinutes ? Math.floor(durMinutes / 60) : ''}">
      </div>
      <div class="field">
        <label for="historyDurationMinutes">Minutes</label>
        <input type="number" inputmode="numeric" id="historyDurationMinutes" placeholder="0" min="0" max="59" value="${durMinutes ? durMinutes % 60 : ''}">
      </div>
    </div>
    <div class="workout-detail">
    ${s.entries.map(e => {
      let html = `<div class="ex-row"><div class="ex-name">${escapeHtml(e.name)}</div>`;
      if (e.best != null) html += `<div class="set-line"><span class="label">Best</span><span>${e.best} ${escapeHtml(e.unit)}</span></div>`;
      if (e.goalTarget != null) {
        const done = (e.goalSetResults || []).filter(Boolean).length;
        html += `<div class="set-line"><span class="label">Goal</span><span>${e.goalTarget} ${escapeHtml(e.unit)} × ${e.goalSetsDesired} — ${done}/${e.goalSetsDesired}</span></div>`;
      }
      if (e.notes) html += `<div class="set-line"><span class="label">Notes</span><span>"${escapeHtml(e.notes)}"</span></div>`;
      html += '</div>';
      return html;
    }).join('')}
    </div>`;
  document.getElementById('historyDurationHours').addEventListener('change', onHistoryDurationChange);
  document.getElementById('historyDurationMinutes').addEventListener('change', onHistoryDurationChange);
  showView('view-history-detail');
}

function onHistoryDurationChange() {
  const s = state.sessions.find(x => x.id === openHistorySessionId);
  if (!s) return;
  const h = Number(document.getElementById('historyDurationHours').value) || 0;
  const m = Number(document.getElementById('historyDurationMinutes').value) || 0;
  const total = h * 60 + m;
  s.durationMinutes = total || null;
  saveLocalData();
  renderWeekStatBar();
  persist();
}

// =====================================================================
// SETTINGS
// =====================================================================
function openSettings() {
  document.getElementById('ghUser').value = settings.ghUser || '';
  document.getElementById('ghRepo').value = settings.ghRepo || '';
  document.getElementById('ghBranch').value = settings.ghBranch || 'main';
  document.getElementById('ghToken').value = settings.ghToken || '';
  document.getElementById('settingsStatus').textContent = '';
  document.getElementById('librarySearch').value = '';
  libraryEditingId = null;
  renderTrickLibrary();
  renderCategoryManager();
  showView('view-settings');
}

// ---------- Trick library ----------
function renderTrickLibrary() {
  const query = document.getElementById('librarySearch').value.trim().toLowerCase();
  const box = document.getElementById('trickLibraryManager');
  let list = [...state.tricks];
  if (query) list = list.filter(t => t.name.toLowerCase().includes(query));
  list.sort((a, b) => (a.archived === b.archived ? a.name.localeCompare(b.name) : (a.archived ? 1 : -1)));

  if (!list.length) {
    box.innerHTML = `<div class="empty-state" style="padding:24px 10px;">No tricks yet.</div>`;
    return;
  }

  box.innerHTML = list.map(t => {
    const editing = libraryEditingId === t.id;
    let html = `<div class="lib-trick-card${t.archived ? ' archived' : ''}" data-id="${t.id}">
      <div class="lib-trick-top" data-id="${t.id}">
        <div class="cx-info"><b>${escapeHtml(t.name) || '(unnamed)'}</b><span>${escapeHtml(t.category || 'Uncategorized')} · ${escapeHtml(t.unit)}${t.archived ? ' · archived' : ''}</span></div>
        <span class="chev">${editing ? '︿' : '›'}</span>
      </div>`;
    if (editing) {
      html += `<div class="lib-trick-edit">
        <div class="field"><label>Name</label><input type="text" class="lib-name-input" value="${escapeHtml(t.name)}"></div>
        <div class="field"><label>Category</label><select class="lib-cat-select">${categoryOptionsHtml(t.category)}</select></div>
        <div class="field"><label>Measured in</label>
          <select class="lib-unit-select">${unitOptionsHtml(t.unit)}</select>
          <input type="text" class="lib-unit-custom" placeholder="Custom unit name" value="${escapeHtml(t.unit)}" style="margin-top:8px;" ${UNIT_PRESETS.includes(t.unit) ? 'hidden' : ''}>
        </div>
        <div class="btn-row">
          <button type="button" class="btn small ${t.archived ? '' : 'danger'} lib-archive-btn">${t.archived ? 'Unarchive' : 'Archive'}</button>
          <button type="button" class="btn small lib-close-btn">Close</button>
        </div>
      </div>`;
    }
    html += `</div>`;
    return html;
  }).join('');

  box.querySelectorAll('.lib-trick-top').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      libraryEditingId = libraryEditingId === id ? null : id;
      renderTrickLibrary();
    });
  });

  if (libraryEditingId) {
    const card = box.querySelector(`.lib-trick-card[data-id="${libraryEditingId}"]`);
    const trick = state.tricks.find(t => t.id === libraryEditingId);
    if (card && trick) {
      const nameInput = card.querySelector('.lib-name-input');
      const catSelect = card.querySelector('.lib-cat-select');
      const unitSelect = card.querySelector('.lib-unit-select');
      const unitCustom = card.querySelector('.lib-unit-custom');

      nameInput.addEventListener('blur', () => {
        const v = nameInput.value.trim();
        if (v) trick.name = v;
        saveLocalData();
        persist();
        renderTrickLibrary();
      });
      catSelect.addEventListener('change', () => {
        trick.category = catSelect.value;
        saveLocalData();
        persist();
      });
      unitSelect.addEventListener('change', () => {
        if (unitSelect.value === '__custom') {
          unitCustom.hidden = false;
          unitCustom.focus();
        } else {
          unitCustom.hidden = true;
          trick.unit = unitSelect.value;
          saveLocalData();
          persist();
          renderTrickLibrary();
        }
      });
      unitCustom.addEventListener('blur', () => {
        if (unitSelect.value !== '__custom') return;
        const v = unitCustom.value.trim();
        if (v) trick.unit = v;
        saveLocalData();
        persist();
      });
      card.querySelector('.lib-archive-btn').addEventListener('click', () => {
        trick.archived = !trick.archived;
        saveLocalData();
        persist();
        renderTrickLibrary();
      });
      card.querySelector('.lib-close-btn').addEventListener('click', () => {
        libraryEditingId = null;
        renderTrickLibrary();
      });
    }
  }
}

function addLibraryTrick() {
  const t = { id: uuid(), name: '', category: '', unit: 'catches', createdAt: todayISO(), archived: false };
  state.tricks.push(t);
  libraryEditingId = t.id;
  saveLocalData();
  renderTrickLibrary();
  const input = document.querySelector('.lib-name-input');
  if (input) input.focus();
}

// ---------- Categories ----------
function renderCategoryManager() {
  const box = document.getElementById('categoryManager');
  box.innerHTML = state.categories.map((c, i) => `
    <div class="current-ex-card">
      <div class="cx-info"><b>${escapeHtml(c)}</b></div>
      <button type="button" class="btn small danger" data-i="${i}">Remove</button>
    </div>
  `).join('');
  box.querySelectorAll('button[data-i]').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.categories.splice(Number(btn.dataset.i), 1);
      renderCategoryManager();
      await persist();
    });
  });
}

async function addCategory() {
  const input = document.getElementById('newCategoryInput');
  const val = input.value.trim();
  if (!val) return;
  if (state.categories.some(c => c.toLowerCase() === val.toLowerCase())) { input.value = ''; return; }
  state.categories.push(val);
  input.value = '';
  renderCategoryManager();
  await persist();
}

// ---------- GitHub settings form ----------
async function saveSettingsFromForm() {
  settings.ghUser = document.getElementById('ghUser').value.trim();
  settings.ghRepo = document.getElementById('ghRepo').value.trim();
  settings.ghBranch = document.getElementById('ghBranch').value.trim() || 'main';
  settings.ghToken = document.getElementById('ghToken').value.trim();
  saveSettings();
  document.getElementById('settingsStatus').textContent = 'Saved. Syncing…';
  localStorage.removeItem(LS_SHA);
  await refreshFromGitHub(true);
  document.getElementById('settingsStatus').textContent = 'Saved.';
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `juggling-data-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// =====================================================================
// VIEW SWITCHING
// =====================================================================
const ALL_VIEWS = ['view-train', 'view-add-trick', 'view-trick-log', 'view-finish',
  'view-priorities', 'view-add-priority', 'view-progress', 'view-progress-detail',
  'view-history', 'view-history-detail', 'view-settings'];
const TOP_LEVEL_VIEWS = ['view-train', 'view-priorities', 'view-progress', 'view-history'];
const VIEW_TO_TAB = { 'view-train': 'train', 'view-priorities': 'priorities', 'view-progress': 'progress', 'view-history': 'history' };
const VIEW_TITLES = {
  'view-train': 'Train',
  'view-add-trick': 'Add a Trick',
  'view-trick-log': 'Log Trick',
  'view-finish': 'Finish Practice',
  'view-priorities': 'Priorities',
  'view-add-priority': 'Add Priority',
  'view-progress': 'Progress',
  'view-progress-detail': 'Progress',
  'view-history': 'History',
  'view-history-detail': 'Practice',
  'view-settings': 'Settings'
};

function showView(id) {
  ALL_VIEWS.forEach(v => { document.getElementById(v).hidden = (v !== id); });
  document.getElementById('pageTitle').textContent = VIEW_TITLES[id] || 'Juggling Log';
  document.getElementById('mainTabs').hidden = !TOP_LEVEL_VIEWS.includes(id);
  if (TOP_LEVEL_VIEWS.includes(id)) setActiveTab(id);
  window.scrollTo(0, 0);
}

function setActiveTab(id) {
  const tab = VIEW_TO_TAB[id];
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

// =====================================================================
// WIRE EVENTS
// =====================================================================
function wireEvents() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === 'train') { renderTrain(); showView('view-train'); }
      else if (tab === 'priorities') { renderPriorities(); showView('view-priorities'); }
      else if (tab === 'progress') { document.getElementById('progressSearch').value = ''; renderProgressList(); showView('view-progress'); }
      else if (tab === 'history') { renderHistoryList(); showView('view-history'); }
    });
  });

  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('backFromSettings').addEventListener('click', () => { renderTrain(); showView('view-train'); });

  // Train
  document.getElementById('startPracticeBtn').addEventListener('click', startNewSession);
  document.getElementById('discardSessionBtn').addEventListener('click', discardSession);
  document.getElementById('addTrickToSessionBtn').addEventListener('click', openAddTrickView);
  document.getElementById('finishPracticeBtn').addEventListener('click', openFinishView);

  // Add trick
  document.getElementById('backFromAddTrick').addEventListener('click', () => showView('view-train'));
  const trickPicker = document.getElementById('trickPicker');
  trickPicker.addEventListener('input', updateTrickSuggestions);
  trickPicker.addEventListener('focus', updateTrickSuggestions);
  document.addEventListener('click', e => {
    const wrap = document.getElementById('trickPickerWrap');
    if (wrap && !wrap.contains(e.target)) {
      document.getElementById('trickSuggestions').hidden = true;
    }
  });
  document.getElementById('newTrickUnit').addEventListener('change', () => {
    const v = document.getElementById('newTrickUnit').value;
    const custom = document.getElementById('newTrickUnitCustom');
    custom.hidden = v !== '__custom';
    if (v === '__custom') custom.focus();
  });
  document.getElementById('createNewTrickBtn').addEventListener('click', createNewTrickFromForm);

  // Trick log
  document.getElementById('backFromTrickLog').addEventListener('click', () => { showView('view-train'); renderSessionTrickList(); });
  document.getElementById('doneWithTrickBtn').addEventListener('click', () => { showView('view-train'); renderSessionTrickList(); });
  document.getElementById('trickBestInput').addEventListener('input', e => {
    const entry = currentSession.entries[trickLogActiveIndex];
    const v = e.target.value;
    entry.best = v === '' ? null : Number(v);
    saveDraft();
    updatePrIndicator();
  });
  document.getElementById('trickNotesInput').addEventListener('input', e => {
    const entry = currentSession.entries[trickLogActiveIndex];
    entry.notes = e.target.value;
    saveDraft();
  });

  // Finish
  document.getElementById('backFromFinish').addEventListener('click', () => showView('view-train'));
  document.getElementById('savePracticeBtn').addEventListener('click', savePractice);
  const onFinishDurationInput = () => {
    const h = Number(document.getElementById('finishHoursInput').value) || 0;
    const m = Number(document.getElementById('finishMinutesInput').value) || 0;
    currentSession.durationMinutes = (h * 60 + m) || null;
    currentSession.durationManuallySet = true;
    saveDraft();
  };
  document.getElementById('finishHoursInput').addEventListener('input', onFinishDurationInput);
  document.getElementById('finishMinutesInput').addEventListener('input', onFinishDurationInput);

  // Priorities
  document.getElementById('addPriorityBtn').addEventListener('click', openAddPriorityView);
  document.getElementById('backFromAddPriority').addEventListener('click', () => showView('view-priorities'));
  document.getElementById('prioritySearch').addEventListener('input', renderPriorityPickList);

  // Progress
  document.getElementById('progressSearch').addEventListener('input', renderProgressList);
  document.getElementById('backFromProgressDetail').addEventListener('click', () => {
    showView(progressReturnTo === 'priorities' ? 'view-priorities' : 'view-progress');
  });
  document.getElementById('startTrainingFromProgressBtn').addEventListener('click', startTrainingFromProgress);

  // History
  document.getElementById('backFromHistoryDetail').addEventListener('click', () => { renderHistoryList(); showView('view-history'); });
  document.getElementById('deleteSessionBtn').addEventListener('click', async () => {
    if (!confirm('Delete this practice? This cannot be undone.')) return;
    state.sessions = state.sessions.filter(s => s.id !== openHistorySessionId);
    saveLocalData();
    renderHistoryList();
    showView('view-history');
    await persist();
  });

  // Settings
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettingsFromForm);
  document.getElementById('syncNowBtn').addEventListener('click', () => refreshFromGitHub(false));
  document.getElementById('librarySearch').addEventListener('input', renderTrickLibrary);
  document.getElementById('addLibraryTrickBtn').addEventListener('click', addLibraryTrick);
  document.getElementById('addCategoryBtn').addEventListener('click', addCategory);
  document.getElementById('exportBtn').addEventListener('click', exportData);

  window.addEventListener('online', () => { if (localStorage.getItem(LS_PENDING)) ghPushLocal(); });
}

// ---------- Service worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
