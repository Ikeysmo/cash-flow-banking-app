'use strict';

const S = window.Statement;
const SECRET_KEY = 'cashflowBankSecret';
const BANK = 'bank';

const $ = (sel) => document.querySelector(sel);
const socket = io();

let game = null;          // latest public state
let meId = null;
let selectedColor = null;
let lastCash = null;
let seenTx = null;
let seenRequests = null;
let menuItems = null;   // options of the open menu (null = a normal form sheet)
let editTarget = null;    // player id whose profession card is being edited (null = not editing)
let setupValues = null;
let sheetCfg = null;
let sheetValues = {};

// ---- helpers ---------------------------------------------------------------

const money = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const signed = (n) => `${n > 0 ? '+' : ''}${money(n)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const getSecret = () => { try { return localStorage.getItem(SECRET_KEY); } catch { return null; } };
const setSecret = (s) => { try { s ? localStorage.setItem(SECRET_KEY, s) : localStorage.removeItem(SECRET_KEY); } catch {} };
const me = () => game && game.players.find((p) => p.id === meId);
const player = (id) => game && game.players.find((p) => p.id === id);
const colorHex = (id) => (game.colors.find((c) => c.id === id) || {}).hex || '#999';
const nameOf = (id) => (id === meId ? 'You' : id === BANK ? 'Bank' : (player(id) || {}).name || 'Former player');
const num = (v) => (v === '' || v === undefined || v === null ? 0 : Number(v));

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('hide'), 3600);
  setTimeout(() => el.remove(), 4100);
}

const emit = (type, payload) => new Promise((resolve) => socket.emit('action', { type, payload }, resolve));

// Sends an action. If the server says a bank loan is needed, offers it and retries.
async function act(type, payload = {}, { quiet = false } = {}) {
  let res = await emit(type, payload);
  if (!res.ok && res.needLoan) {
    const pay = Math.round(res.needLoan * game.settings.loanRatePercent / 100);
    if (confirm(`${res.error}.\n\nTake a ${money(res.needLoan)} bank loan? It adds ${money(pay)}/month to your expenses.`)) {
      res = await emit(type, { ...payload, autoLoan: true });
    } else {
      return { ok: false, error: res.error, cancelled: true };
    }
  }
  if (!res.ok && !quiet) toast(res.error, 'bad');
  return res;
}

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ---- connection --------------------------------------------------------------

socket.on('connect', () => {
  $('#offline').hidden = true;
  const secret = getSecret();
  if (!secret) { meId = null; render(); return; }
  socket.emit('resume', { secret }, (res) => {
    if (res.ok) meId = res.playerId;
    else { setSecret(null); meId = null; }
    render();
  });
});

socket.on('disconnect', () => { $('#offline').hidden = false; });

socket.on('state', (state) => {
  game = state;
  if (meId && !me()) { meId = null; setSecret(null); }
  if (editTarget && !player(editTarget)) editTarget = null;
  notify();
  render();
});

socket.on('kicked', () => {
  setSecret(null);
  meId = null;
  toast('You were removed from the game by the host', 'bad');
  render();
});

function notify() {
  if (!seenTx) {
    seenTx = new Set(game.transactions.map((t) => t.id));
    seenRequests = new Set(game.pendingRequests.map((r) => r.id));
    return;
  }
  for (const tx of [...game.transactions].reverse()) {
    if (seenTx.has(tx.id)) continue;
    seenTx.add(tx.id);
    if (tx.text.includes('WON')) toast(`🏆 ${nameOf(tx.actorId)} ${tx.text}`, 'good');
    else if (tx.type === 'fastTrack' && tx.actorId !== meId) toast(`🚀 ${nameOf(tx.actorId)} escaped the Rat Race!`, 'good');
    if (!meId || tx.actorId === meId || !tx.playerIds.includes(meId)) continue;
    const d = tx.deltas[meId] || 0;
    toast(`${nameOf(tx.actorId)} ${tx.text}${d ? ` (${signed(d)} to you)` : ''}`, d > 0 ? 'good' : d < 0 ? 'bad' : '');
  }
  for (const r of game.pendingRequests) {
    if (seenRequests.has(r.id)) continue;
    seenRequests.add(r.id);
    if (r.toId === meId) toast(`${nameOf(r.fromId)} requests ${money(r.amount)}`, 'warn');
  }
}

// ---- generic form fields ----------------------------------------------------
// Field: { name, label, type: 'number'|'text'|'choice'|'heading', options, placeholder, decimal, showIf, hint }

function visibleFields(fields, values) {
  return fields.filter((f) => !f.showIf || f.showIf(values));
}

function renderFields(container, fields, values) {
  container.innerHTML = visibleFields(fields, values).map((f) => {
    if (f.type === 'heading') return `<h3 class="field-heading">${esc(f.label)}</h3>`;
    if (f.type === 'choice') {
      return `<div class="field"><span class="field-label">${esc(f.label)}</span><div class="chips">${f.options.map(([v, l]) =>
        `<button type="button" class="btn chip ${values[f.name] === v ? 'selected' : ''}" data-choice="${f.name}" data-value="${esc(v)}">${l}</button>`).join('')}</div></div>`;
    }
    const isNum = f.type === 'number';
    return `<label class="field">${esc(f.label)}${f.hint ? ` <span class="muted small">${esc(f.hint)}</span>` : ''}
      <span class="${isNum && !f.noDollar ? 'money-input' : ''}">
        <input name="${f.name}" type="${isNum ? 'number' : 'text'}" ${isNum ? `step="${f.decimal ? 'any' : '1'}" inputmode="${f.decimal || f.negative ? 'decimal' : 'numeric'}"` : 'maxlength="40"'}
          placeholder="${esc(f.placeholder ?? (isNum ? '0' : ''))}" value="${esc(values[f.name] ?? '')}">
      </span></label>`;
  }).join('');
}

// ---- bottom sheet ----------------------------------------------------------

function openSheet(cfg) {
  sheetCfg = cfg;
  menuItems = null;
  $('#sheet-submit').hidden = false;
  sheetValues = { ...(cfg.values || {}) };
  $('#sheet-title').textContent = cfg.title;
  $('#sheet-help').textContent = cfg.help || '';
  $('#sheet-help').hidden = !cfg.help;
  $('#sheet-submit').textContent = cfg.submitLabel || 'Confirm';
  $('#sheet-error').textContent = '';
  renderFields($('#sheet-fields'), cfg.fields, sheetValues);
  updateSheetPreview();
  $('#sheet').showModal();
  const first = $('#sheet-fields input');
  if (first && !cfg.noAutofocus) setTimeout(() => first.focus(), 60);
}

// A menu reuses the sheet: big option rows, no submit button.
function openMenu(title, items, help = '') {
  sheetCfg = null;
  menuItems = items;
  $('#sheet-title').textContent = title;
  $('#sheet-help').textContent = help;
  $('#sheet-help').hidden = !help;
  $('#sheet-error').textContent = '';
  $('#sheet-preview').hidden = true;
  $('#sheet-submit').hidden = true;
  $('#sheet-fields').innerHTML = `<div class="menu">${items.map((it, i) => `
    <button type="button" class="menu-item" data-menuitem="${i}" ${it.disabled ? 'disabled' : ''}>
      <span class="menu-label">${it.label}</span>${it.sub ? `<span class="menu-sub">${it.sub}</span>` : ''}
    </button>`).join('')}</div>`;
  $('#sheet').showModal();
}

function updateSheetPreview() {
  const html = sheetCfg && sheetCfg.preview ? sheetCfg.preview(sheetValues) : '';
  $('#sheet-preview').innerHTML = html || '';
  $('#sheet-preview').hidden = !html;
}

$('#sheet-fields').addEventListener('input', (e) => { if (e.target.name) sheetValues[e.target.name] = e.target.value; $('#sheet-error').textContent = ''; updateSheetPreview(); });
$('#sheet-fields').addEventListener('click', (e) => {
  const item = e.target.closest('[data-menuitem]');
  if (item && menuItems) {
    const run = menuItems[Number(item.dataset.menuitem)].run;
    $('#sheet').close();
    run();
    return;
  }
  const b = e.target.closest('[data-choice]');
  if (!b) return;
  sheetValues[b.dataset.choice] = b.dataset.value;
  $('#sheet-error').textContent = '';
  renderFields($('#sheet-fields'), sheetCfg.fields, sheetValues);
  updateSheetPreview();
});

$('#sheet-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cfg = sheetCfg;
  if (!cfg) return; // menu mode has nothing to submit
  const err = $('#sheet-error');
  err.textContent = '';
  const out = cfg.submit(sheetValues);
  if (out && out.error) { err.textContent = out.error; return; }
  const [type, payload] = out;
  $('#sheet-submit').disabled = true;
  const res = await act(type, payload, { quiet: true });
  $('#sheet-submit').disabled = false;
  if (!res.ok) { if (!res.cancelled) err.textContent = res.error; return; }
  $('#sheet').close();
  if (cfg.success) toast(cfg.success(sheetValues, res), 'good');
});
$('#sheet').addEventListener('click', (e) => { if (e.target === $('#sheet')) $('#sheet').close(); });

// ---- profession setup --------------------------------------------------------

function setupFields() {
  return [
    { name: 'title', label: 'Profession', type: 'text', placeholder: 'e.g. Teacher' },
    { name: 'salary', label: 'Salary', type: 'number' },
    { name: 'savings', label: 'Savings', type: 'number', hint: '(starting cash)' },
    { name: 'perChildExpense', label: 'Per child expense', type: 'number' },
    { type: 'heading', label: 'Monthly expenses' },
    ...S.EXPENSE_LINES.map(([k, l]) => ({ name: `expenses.${k}`, label: l, type: 'number' })),
    { type: 'heading', label: 'Liabilities (balances owed)' },
    ...S.LIABILITY_LINES.map(([k, l]) => ({ name: `liabilities.${k}`, label: l, type: 'number' })),
  ];
}

function professionFromValues(v) {
  const expenses = {};
  for (const [k] of S.EXPENSE_LINES) expenses[k] = num(v[`expenses.${k}`]);
  const liabilities = {};
  for (const [k] of S.LIABILITY_LINES) liabilities[k] = num(v[`liabilities.${k}`]);
  return { title: (v.title || '').trim(), salary: num(v.salary), savings: num(v.savings), perChildExpense: num(v.perChildExpense), expenses, liabilities };
}

function valuesFromProfession(prof) {
  if (!prof) return {};
  const v = { title: prof.title, salary: prof.salary, savings: prof.savings, perChildExpense: prof.perChildExpense };
  for (const [k] of S.EXPENSE_LINES) v[`expenses.${k}`] = prof.expenses[k] || '';
  for (const [k] of S.LIABILITY_LINES) v[`liabilities.${k}`] = prof.liabilities[k] || '';
  return v;
}

function renderSetupPreview() {
  const target = player(editTarget || meId);
  const p = { ...target, profession: professionFromValues(setupValues) };
  const s = S.summarize(p, game.settings);
  const starting = target.stage === 'setup';
  const startCash = p.profession.savings + (game.settings.startWithPayday ? Math.max(s.monthlyCashFlow, 0) : 0);
  $('#setup-preview').innerHTML = `
    <div class="row"><span>Total income</span><strong>${money(s.totalIncome)}</strong></div>
    <div class="row"><span>Total expenses</span><strong>${money(s.totalExpenses)}</strong></div>
    <div class="row big"><span>Monthly cash flow</span><strong class="${s.monthlyCashFlow < 0 ? 'neg' : 'pos'}">${signed(s.monthlyCashFlow)}</strong></div>
    ${starting ? `<div class="row"><span>Starting cash</span><strong>${money(startCash)}</strong></div>` : ''}`;
}

function renderPicker() {
  const current = (setupValues.title || '').trim().toLowerCase();
  $('#profession-picker').innerHTML = window.PROFESSIONS.map((prof, i) => {
    const cf = S.summarize({ profession: prof, assets: [], children: 0, bankLoan: 0, paidOff: {} }, game.settings).monthlyCashFlow;
    const selected = prof.title.toLowerCase() === current;
    return `<button type="button" class="prof ${selected ? 'selected' : ''}" data-preset="${i}" role="option" aria-selected="${selected}">
      <strong>${esc(prof.title)}</strong>
      <span>Salary ${money(prof.salary)}</span>
      <span class="${cf < 0 ? 'neg' : 'pos'}">${signed(cf)}/mo</span>
    </button>`;
  }).join('');
}

function applyPreset(i) {
  const prof = window.PROFESSIONS[i];
  Object.assign(setupValues, valuesFromProfession(prof));
  renderFields($('#setup-fields'), setupFields(), setupValues);
  renderPicker();
  renderSetupPreview();
}

let setupBoundFor = null;
function renderSetup() {
  const target = player(editTarget || meId);
  const key = `${target.id}:${target.stage}`;
  if (setupBoundFor !== key) {
    setupBoundFor = key;
    setupValues = valuesFromProfession(target.profession);
    renderFields($('#setup-fields'), setupFields(), setupValues);
    $('#setup-error').textContent = '';
  }
  const starting = target.stage === 'setup' && !editTarget;
  $('#setup-title').textContent = editTarget && editTarget !== meId ? `Edit ${target.name}'s card` : starting ? 'Your profession' : 'Edit your card';
  $('#setup-help').textContent = starting
    ? 'Tap the profession you drew to fill in its numbers, then check them against your card.'
    : 'Pick a card or fix any typos. This changes the card numbers only; cash is not touched.';
  $('#setup-submit').textContent = starting ? 'Start playing' : 'Save card';
  $('#setup-cancel').hidden = starting;
  renderPicker();
  renderSetupPreview();
}

$('#setup-fields').addEventListener('input', (e) => {
  if (!e.target.name) return;
  setupValues[e.target.name] = e.target.value;
  if (e.target.name === 'title') renderPicker();
  renderSetupPreview();
});

$('#profession-picker').addEventListener('click', (e) => {
  const b = e.target.closest('[data-preset]');
  if (b) applyPreset(Number(b.dataset.preset));
});

$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = professionFromValues(setupValues);
  if (editTarget && editTarget !== meId) payload.playerId = editTarget;
  const res = await act('setupProfession', payload, { quiet: true });
  if (!res.ok) { $('#setup-error').textContent = res.error; return; }
  const wasEditing = !!editTarget;
  editTarget = null;
  setupBoundFor = null;
  toast(wasEditing ? 'Card saved' : 'Welcome to the Rat Race!', 'good');
  render();
  window.scrollTo(0, 0);
});

// ---- rendering -----------------------------------------------------------------

function render() {
  if (!game) return;
  const self = me();
  const inSetup = !!self && (self.stage === 'setup' || !!editTarget);
  $('#join-view').hidden = !!self;
  $('#setup-view').hidden = !inSetup;
  $('#main-view').hidden = !self || inSetup;
  if (!self) { setupBoundFor = null; renderJoin(); return; }
  if (inSetup) renderSetup();
  else renderMain(self);
}

function renderJoin() {
  const full = game.players.length >= game.settings.maxPlayers;
  $('#join-count').textContent = full
    ? `Game full (${game.players.length}/${game.settings.maxPlayers})`
    : `${game.players.length}/${game.settings.maxPlayers} players` +
      (game.players.length ? ` — ${game.players.map((p) => p.name).join(', ')}` : " — you'll be the host");
  $('#join-btn').disabled = full;
  const taken = new Set(game.players.map((p) => p.color));
  if (selectedColor && taken.has(selectedColor)) selectedColor = null;
  if (!selectedColor) selectedColor = (game.colors.find((c) => !taken.has(c.id)) || {}).id || null;
  $('#color-picker').innerHTML = game.colors.map((c) => `
    <button type="button" class="swatch ${c.id === selectedColor ? 'selected' : ''}" data-color="${c.id}"
      style="--c:${c.hex}" ${taken.has(c.id) ? 'disabled' : ''} aria-label="${c.id}"></button>`).join('');
}

function stageLabel(p) {
  if (p.stage === 'setup') return 'Setting up';
  if (p.stage === 'fastTrack') return '🚀 Fast Track';
  if (p.stage === 'won') return '🏆 Won';
  return p.profession ? esc(p.profession.title) : 'Rat Race';
}

function renderMain(self) {
  const s = self.summary;
  const ft = self.fastTrack;
  const onFT = self.stage === 'fastTrack' || self.stage === 'won';

  // winners
  const winners = game.players.filter((p) => p.stage === 'won');
  $('#win-banner').innerHTML = winners.length
    ? `<div class="banner win">🏆 ${winners.map((w) => esc(w.id === meId ? 'You' : w.name)).join(' & ')} won the game!</div>` : '';

  // hero
  const hero = $('#hero');
  hero.style.setProperty('--player', colorHex(self.color));
  let stats;
  if (onFT) {
    const gained = ft.cashflowDayIncome - ft.startIncome;
    const pct = Math.min(100, Math.max(0, (gained / game.settings.fastTrackGoal) * 100));
    stats = `
      <div class="hero-stats"><span>CASHFLOW Day income</span><strong>${money(ft.cashflowDayIncome)}</strong></div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="hero-small">${signed(gained)} of ${money(game.settings.fastTrackGoal)} needed to win — or buy your Dream</div>`;
  } else {
    const pct = s.totalExpenses > 0 ? Math.min(100, (s.passiveIncome / s.totalExpenses) * 100) : 0;
    stats = `
      <div class="hero-stats"><span>Monthly cash flow</span><strong>${signed(s.monthlyCashFlow)}</strong></div>
      <div class="progress"><div style="width:${Math.max(0, pct)}%"></div></div>
      <div class="hero-small">Passive income ${money(s.passiveIncome)} of ${money(s.totalExpenses)} expenses — beat it to escape the Rat Race</div>`;
  }
  hero.innerHTML = `
    <div class="hero-top">
      <span class="token" style="background:${colorHex(self.color)}"></span>
      <span>${esc(self.name)}</span>
      <span class="badge">${stageLabel(self)}</span>
      ${self.isHost ? '<span class="badge">Host</span>' : ''}
    </div>
    <div class="hero-label">Cash</div>
    <div class="balance ${self.cash < 0 ? 'neg' : ''}" id="me-balance">${money(self.cash)}</div>
    ${stats}`;
  const balEl = $('#me-balance');
  if (lastCash !== null && self.cash !== lastCash) balEl.classList.add(self.cash > lastCash ? 'flash-up' : 'flash-down');
  lastCash = self.cash;

  // escape banner
  $('#escape-banner').innerHTML = self.stage === 'ratRace' && s.canEscape
    ? `<div class="banner escape"><div>🎉 <strong>Your passive income beats your expenses!</strong><br>You can leave the Rat Race.</div>
       <button class="btn primary" data-click="enterFastTrack">Enter the Fast Track</button></div>` : '';

  // reminders
  const rem = [];
  if (self.turnsSkipped > 0) rem.push(`😬 Downsized: skip ${self.turnsSkipped} more turn${self.turnsSkipped > 1 ? 's' : ''}`);
  else if (self.charityTurns > 0) rem.push(`🎲 Charity: roll 2 dice for ${self.charityTurns} more turn${self.charityTurns > 1 ? 's' : ''}`);
  $('#reminders').innerHTML = rem.length
    ? `<div class="banner reminder"><span>${rem.join('<br>')}</span><button class="btn small" data-click="endTurn">Turn done</button></div>` : '';

  // actions
  let buttons;
  if (self.stage === 'ratRace') {
    buttons = [
      ['click:payday', `💵 Payday<small>${signed(s.monthlyCashFlow)}</small>`, 'wide primary'],
      ['click:buy', '🏠 Deal<small>buy</small>'],
      ['menu:market', '📈 Market<small>sell · split</small>'],
      ['click:doodad', '🛍️ Doodad'],
      ['menu:life', '🎲 Life event<small>charity · baby · downsized</small>'],
      ['click:loan', `🏦 Bank loan<small>${money(self.bankLoan)} owed</small>`],
      ['menu:money', '💸 Money<small>pay · request · collect</small>'],
    ];
  } else if (self.stage === 'fastTrack') {
    buttons = [
      ['click:cashflowDay', `💵 CASHFLOW Day<small>${signed(ft.cashflowDayIncome)}</small>`, 'wide primary'],
      ['click:ftBuy', '🏢 Buy business'],
      ['click:dream', '🌟 Bought my Dream'],
      ['menu:badLuck', '🎲 Bad luck<small>audit · lawsuit · divorce</small>'],
      ['menu:money', '💸 Money<small>pay · request · collect</small>', 'span3'],
    ];
  } else {
    buttons = [['click:pay', '💸 Pay'], ['click:request', '🙋 Request']];
  }
  $('#actions').innerHTML = buttons.map(([key, label, cls = '']) => {
    const [kind, name] = key.split(':');
    return `<button class="btn action ${cls}" data-${kind}="${name}">${label}</button>`;
  }).join('');

  // requests
  const reqs = game.pendingRequests.filter((r) => r.toId === meId || r.fromId === meId);
  $('#requests').innerHTML = reqs.map((r) => r.toId === meId ? `
    <div class="request incoming">
      <div><strong>${esc(nameOf(r.fromId))}</strong> requests <strong>${money(r.amount)}</strong>${r.note ? `<br><span class="muted">${esc(r.note)}</span>` : ''}</div>
      <div class="req-buttons">
        <button class="btn" data-respond="${r.id}" data-accept="0">Decline</button>
        <button class="btn primary" data-respond="${r.id}" data-accept="1">Pay</button>
      </div>
    </div>` : `
    <div class="request outgoing">
      <div>Waiting on <strong>${esc(nameOf(r.toId))}</strong> for <strong>${money(r.amount)}</strong>${r.note ? ` <span class="muted">— ${esc(r.note)}</span>` : ''}</div>
      <button class="btn" data-respond="${r.id}" data-accept="0">Cancel</button>
    </div>`).join('');

  renderStatement(self);
  renderPlayers();
  renderHistory(self);
  renderHost(self);
}

function row(label, value, cls = '', button = '') {
  return `<li class="srow ${cls}"><span class="slabel">${label}</span><span class="sval">${value}</span>${button}</li>`;
}

function assetLine(a) {
  if (a.type === 'stock' || a.type === 'gold') {
    const inc = S.assetIncome(a);
    return `${a.shares.toLocaleString('en-US')} ${a.type === 'gold' ? 'coins' : 'shares'} @ ${money(a.costPerShare)}${inc ? ` · ${signed(inc)}/mo` : ''}`;
  }
  return `Cost ${money(a.cost)} · down ${money(a.downPayment)}${a.mortgage ? ` · mortgage ${money(a.mortgage)}` : ''} · ${signed(a.cashFlow)}/mo`;
}

const TYPE_LABEL = { stock: 'Stock', gold: 'Gold', realEstate: 'Real estate', business: 'Business' };

function section(title, total, body, extra = '') {
  return `<section class="card"><h2 class="stmt-head"><span>${title}</span>${total ? `<span class="stmt-total">${total}</span>` : ''}</h2>
    <ul class="statement">${body}</ul>${extra}</section>`;
}

function renderStatement(self) {
  const el = $('#statement');
  if (self.stage === 'fastTrack' || self.stage === 'won') {
    const ft = self.fastTrack;
    el.innerHTML = section('Fast Track', money(ft.cashflowDayIncome),
      row('Starting CASHFLOW Day income', money(ft.startIncome)) +
      ft.businesses.map((b) => row(esc(b.name), signed(b.cashFlow), '', `<span class="muted small">cost ${money(b.cost)}</span>`)).join('') +
      row('CASHFLOW Day income', money(ft.cashflowDayIncome), 'total'));
    return;
  }
  const s = self.summary;
  const prof = self.profession;

  const income = row('Salary', money(s.salary)) +
    self.assets.filter((a) => S.assetIncome(a) !== 0).map((a) => row(esc(a.name), signed(S.assetIncome(a)))).join('') +
    row('Passive income', money(s.passiveIncome), 'sub') +
    row('Total income', money(s.totalIncome), 'total');

  const expenses = S.expenseLines(self, game.settings).filter((l) => l.amount || l.paidOff || l.key === 'children')
    .map((l) => row(esc(l.label), l.paidOff ? '<span class="muted">paid off</span>' : money(l.amount))).join('') +
    row('Total expenses', money(s.totalExpenses), 'total') +
    row('Monthly cash flow', signed(s.monthlyCashFlow), `total ${s.monthlyCashFlow < 0 ? 'neg' : 'pos'}`);

  const assets = self.assets.length
    ? self.assets.map((a) => `<li class="asset"><div><strong>${esc(a.name)}</strong> <span class="badge">${TYPE_LABEL[a.type]}</span>
        <div class="muted small">${assetLine(a)}</div></div><button class="btn small" data-sell="${a.id}">Sell</button></li>`).join('')
    : '<li class="muted empty">No assets yet. Tap <strong>Deal</strong> when you land on one.</li>';

  const owed = S.LIABILITY_LINES.filter(([k]) => prof.liabilities[k] && !self.paidOff[k]).reduce((t, [k]) => t + prof.liabilities[k], 0) +
    self.bankLoan + self.assets.reduce((t, a) => t + (a.mortgage || 0), 0);
  const liabilities = S.LIABILITY_LINES.filter(([k]) => prof.liabilities[k]).map(([k, l]) => {
    const paid = self.paidOff[k];
    return row(esc(l), paid ? '<span class="muted">paid off</span>' : money(prof.liabilities[k]), '',
      paid ? '' : `<button class="btn small" data-payoff="${k}">Pay off</button>`);
  }).join('') +
    row('Bank loan', money(self.bankLoan), '', self.bankLoan ? '<button class="btn small" data-click="repay">Repay</button>' : '') +
    self.assets.filter((a) => a.mortgage).map((a) => row(`${esc(a.name)} mortgage`, money(a.mortgage), 'muted')).join('');

  el.innerHTML =
    section('Income', `${money(s.totalIncome)}/mo`, income) +
    section('Expenses', `${money(s.totalExpenses)}/mo`, expenses) +
    section('Assets', self.assets.length ? `${self.assets.length}` : '', assets) +
    section('Liabilities', money(owed), liabilities) +
    `<button class="link small edit-card" data-click="editCard">Edit profession card</button>`;
}

function renderPlayers() {
  $('#players').innerHTML = game.players.map((p) => {
    const sub = p.stage === 'ratRace' ? `${signed(p.summary.monthlyCashFlow)}/mo · passive ${money(p.summary.passiveIncome)}/${money(p.summary.totalExpenses)}`
      : (p.stage === 'fastTrack' || p.stage === 'won') ? `CASHFLOW Day ${money(p.fastTrack.cashflowDayIncome)}` : '';
    return `<li class="${p.id === meId ? 'me' : ''}">
      <span class="token" style="background:${colorHex(p.color)}"></span>
      <span class="pname">${esc(p.name)}${p.id === meId ? ' (you)' : ''} <span class="badge">${stageLabel(p)}</span>
        ${sub ? `<br><span class="muted small">${sub}</span>` : ''}</span>
      <span class="dot ${p.connected ? 'on' : ''}" title="${p.connected ? 'Online' : 'Offline'}"></span>
      <span class="pbal">${money(p.cash)}</span>
    </li>`;
  }).join('');
}

function renderHistory(self) {
  const txs = game.transactions;
  renderHistoryList($('#history'), txs.length ? [...txs].reverse().map((t) => {
    const canUndo = !t.undone && t.type !== 'undo' && !t.blocked && (t.actorId === meId || self.isHost);
    const d = t.deltas[meId];
    return `<li class="${t.undone ? 'undone' : ''}">
      <div class="tx-main"><span><strong>${esc(nameOf(t.actorId))}</strong> ${esc(t.text)}</span>
        ${d ? `<span class="tx-amt ${d > 0 ? 'in' : 'out'}">${signed(d)}</span>` : ''}</div>
      <div class="tx-sub muted"><span>${timeAgo(t.createdAt)}</span>${canUndo ? `<button class="link" data-undo="${t.id}">Undo</button>` : ''}</div>
    </li>`;
  }).join('') : '<li class="muted empty">No transactions yet</li>');
}

function renderHost(self) {
  $('#host-panel').hidden = !self.isHost;
  if (!self.isHost) return;
  const f = $('#settings-form');
  if (!f.contains(document.activeElement)) {
    f.startWithPayday.checked = game.settings.startWithPayday;
    f.loanUnit.value = game.settings.loanUnit;
    f.loanRatePercent.value = game.settings.loanRatePercent;
  }
  $('#host-players').innerHTML = game.players.map((p) => `
    <li>
      <span class="token" style="background:${colorHex(p.color)}"></span>
      <span class="pname">${esc(p.name)}</span>
      <span class="host-buttons">
        ${p.profession ? `<button class="btn small" data-editcard="${p.id}">Edit card</button>` : ''}
        <button class="btn small" data-adjust="${p.id}">Adjust cash</button>
        ${p.id === meId ? '' : `<button class="btn small" data-makehost="${p.id}">Make host</button>
        <button class="btn small danger" data-kick="${p.id}">Remove</button>`}
      </span>
    </li>`).join('');
}

// ---- sheets for each action ------------------------------------------------------

const amountField = (label = 'Amount') => ({ name: 'amount', label, type: 'number' });
const noteField = (placeholder = 'Optional') => ({ name: 'note', label: 'Note', type: 'text', placeholder });
const otherPlayers = () => game.players.filter((p) => p.id !== meId);
const needPositive = (v, label = 'an amount') => (num(v) > 0 && Number.isInteger(num(v)) ? null : { error: `Enter ${label}` });

function cashAfter(delta) {
  const c = me().cash + delta;
  return `<div class="row"><span>Cash after</span><strong class="${c < 0 ? 'neg' : ''}">${money(c)}</strong></div>` +
    (c < 0 ? `<p class="muted small">You'll be offered a bank loan to cover the difference.</p>` : '');
}

const DEFAULT_SYMBOLS = ['OK4U', 'ON2U', 'MYT4U', 'GRO4US'];
const OTHER = '__other';
const isUnits = (a) => a.type === 'stock' || a.type === 'gold';
const unitWord = (a) => (a.type === 'gold' ? 'coins' : 'shares');

const SHEETS = {
  doodad: () => ({
    title: 'Doodad', submitLabel: 'Pay',
    fields: [amountField('Cost'), noteField('e.g. New golf clubs')],
    preview: (v) => cashAfter(-num(v.amount)),
    submit: (v) => needPositive(v.amount) || ['doodad', { amount: num(v.amount), note: v.note }],
  }),
  buy: () => {
    // The four standard tickers, plus anything already owned at the table.
    const held = game.players.flatMap((p) => p.assets.filter((a) => a.type === 'stock').map((a) => a.name.toUpperCase()));
    const symbols = [...new Set([...DEFAULT_SYMBOLS, ...held])];
    const isStock = (v) => v.type === 'stock';
    const isGold = (v) => v.type === 'gold';
    const perUnit = (v) => isStock(v) || isGold(v);
    const symbolOf = (v) => (v.symbol === OTHER ? (v.customSymbol || '').trim().toUpperCase() : v.symbol);
    return {
      title: 'Buy a deal', submitLabel: 'Buy', values: { type: 'stock' }, noAutofocus: true,
      fields: [
        { name: 'type', label: 'Type', type: 'choice', options: [['stock', '📈 Stock / fund / CD'], ['gold', '🪙 Gold coins'], ['realEstate', '🏠 Real estate'], ['business', '🏢 Business']] },
        { name: 'symbol', label: 'Symbol', type: 'choice', options: [...symbols.map((x) => [x, esc(x)]), [OTHER, 'Other…']], showIf: isStock },
        { name: 'customSymbol', label: 'Other symbol', type: 'text', placeholder: 'e.g. 2BIGPOWER', showIf: (v) => isStock(v) && v.symbol === OTHER },
        { name: 'name', label: 'Name', type: 'text', placeholder: 'Gold coins', hint: '(optional)', showIf: isGold },
        { name: 'name', label: 'Name', type: 'text', placeholder: 'e.g. 3Br/2Ba house', showIf: (v) => !perUnit(v) },
        { name: 'shares', label: 'Shares', type: 'number', noDollar: true, showIf: isStock },
        { name: 'shares', label: 'Coins', type: 'number', noDollar: true, showIf: isGold },
        { name: 'price', label: 'Price per share', type: 'number', showIf: isStock },
        { name: 'price', label: 'Price per coin', type: 'number', showIf: isGold },
        { name: 'dividend', label: 'Dividend per share / month', type: 'number', decimal: true, hint: '(if any)', showIf: isStock },
        { name: 'cost', label: 'Cost', type: 'number', showIf: (v) => !perUnit(v) },
        { name: 'downPayment', label: 'Down payment', type: 'number', showIf: (v) => !perUnit(v) },
        { name: 'cashFlow', label: 'Cash flow / month', type: 'number', negative: true, hint: '(negative if it costs you)', showIf: (v) => !perUnit(v) },
      ],
      preview: (v) => {
        if (perUnit(v)) {
          const total = num(v.shares) * num(v.price);
          const inc = isStock(v) ? Math.round(num(v.shares) * num(v.dividend)) : 0;
          return `<div class="row"><span>Total cost</span><strong>${money(total)}</strong></div>` +
            (inc ? `<div class="row"><span>Passive income</span><strong class="pos">${signed(inc)}/mo</strong></div>` : '') + cashAfter(-total);
        }
        return `<div class="row"><span>Mortgage</span><strong>${money(Math.max(0, num(v.cost) - num(v.downPayment)))}</strong></div>
          <div class="row"><span>Passive income</span><strong class="${num(v.cashFlow) < 0 ? 'neg' : 'pos'}">${signed(num(v.cashFlow))}/mo</strong></div>` + cashAfter(-num(v.downPayment));
      },
      submit: (v) => {
        if (isStock(v)) {
          if (!symbolOf(v)) return { error: v.symbol === OTHER ? 'Type the symbol' : 'Pick a symbol' };
          return needPositive(v.shares, 'the number of shares') ||
            ['buyAsset', { type: 'stock', name: symbolOf(v), shares: num(v.shares), price: num(v.price), dividend: num(v.dividend) }];
        }
        if (isGold(v)) return needPositive(v.shares, 'the number of coins') || ['buyAsset', { type: 'gold', name: v.name, shares: num(v.shares), price: num(v.price) }];
        if (!(v.name || '').trim()) return { error: 'Enter a name' };
        return needPositive(v.cost, 'the cost') || ['buyAsset', { type: v.type, name: v.name, cost: num(v.cost), downPayment: num(v.downPayment), cashFlow: num(v.cashFlow) }];
      },
      success: (v) => `Bought ${isStock(v) ? symbolOf(v) : (v.name || '').trim() || 'Gold coins'}`,
    };
  },
  sell: (asset) => ({
    title: `Sell ${asset.name}`, submitLabel: 'Sell', values: isUnits(asset) ? { shares: asset.shares } : {},
    help: isUnits(asset) ? `You own ${asset.shares.toLocaleString('en-US')} ${unitWord(asset)} (bought @ ${money(asset.costPerShare)}).`
      : `Bought for ${money(asset.cost)}. The ${money(asset.mortgage)} mortgage is paid off from the sale.`,
    fields: isUnits(asset)
      ? [{ name: 'shares', label: asset.type === 'gold' ? 'Coins to sell' : 'Shares to sell', type: 'number', noDollar: true },
        { name: 'price', label: asset.type === 'gold' ? 'Price per coin' : 'Price per share', type: 'number' }]
      : [{ name: 'price', label: 'Sale price', type: 'number' }],
    preview: (v) => {
      const proceeds = isUnits(asset) ? num(v.shares) * num(v.price) : num(v.price) - asset.mortgage;
      return `<div class="row"><span>You receive</span><strong class="${proceeds < 0 ? 'neg' : 'pos'}">${money(proceeds)}</strong></div>` + cashAfter(proceeds);
    },
    submit: (v) => (v.price === '' || v.price === undefined ? { error: 'Enter the price' } :
      ['sellAsset', { assetId: asset.id, price: num(v.price), ...(isUnits(asset) ? { shares: num(v.shares) } : {}) }]),
    success: () => `Sold ${asset.name}`,
  }),
  market: () => {
    const symbols = [...new Set(game.players.flatMap((p) => p.assets.filter((a) => a.type === 'stock').map((a) => a.name.toUpperCase())))];
    return {
      title: 'Stock split', submitLabel: 'Apply to everyone', noAutofocus: true,
      help: 'Applies to every player who owns this stock.',
      values: { kind: 'split', name: symbols[0] || '' },
      fields: [
        symbols.length ? { name: 'name', label: 'Stock', type: 'choice', options: symbols.map((s) => [s, esc(s)]) }
          : { name: 'name', label: 'Symbol', type: 'text', placeholder: 'Nobody owns any stock yet' },
        { name: 'kind', label: 'Market card', type: 'choice', options: [['split', '2-for-1 split (double shares)'], ['reverse', '1-for-2 reverse split (halve shares)']] },
      ],
      submit: (v) => ['stockSplit', { name: v.name, kind: v.kind }],
      success: (v) => `${v.name} ${v.kind === 'split' ? 'split' : 'reverse split'} applied`,
    };
  },
  loan: (mode = 'take') => {
    const unit = game.settings.loanUnit;
    return {
      title: 'Bank loan', submitLabel: 'Confirm', values: { mode, amount: unit }, noAutofocus: true,
      help: `Loans come in ${money(unit)} units at ${game.settings.loanRatePercent}% a month. You owe ${money(me().bankLoan)}.`,
      fields: [
        { name: 'mode', label: '', type: 'choice', options: [['take', 'Borrow'], ['repay', 'Repay']] },
        { name: 'amount', label: 'Amount', type: 'number' },
      ],
      preview: (v) => {
        const amt = num(v.amount) * (v.mode === 'repay' ? -1 : 1);
        const newLoan = me().bankLoan + amt;
        return `<div class="row"><span>Loan after</span><strong>${money(newLoan)}</strong></div>
          <div class="row"><span>Loan payment</span><strong>${money(Math.round(newLoan * game.settings.loanRatePercent / 100))}/mo</strong></div>` + cashAfter(amt);
      },
      submit: (v) => needPositive(v.amount) || [v.mode === 'repay' ? 'repayLoan' : 'takeLoan', { amount: num(v.amount) }],
      success: (v) => (v.mode === 'repay' ? `Repaid ${money(num(v.amount))}` : `Borrowed ${money(num(v.amount))}`),
    };
  },
  pay: () => ({
    title: 'Pay', submitLabel: 'Pay', noAutofocus: true,
    values: { to: otherPlayers()[0]?.id || BANK },
    fields: [
      { name: 'to', label: 'To', type: 'choice', options: [...otherPlayers().map((p) => [p.id, `<span class="token" style="background:${colorHex(p.color)}"></span>${esc(p.name)}`]), [BANK, '🏦 Bank']] },
      amountField(), noteField(),
    ],
    preview: (v) => cashAfter(-num(v.amount)),
    submit: (v) => needPositive(v.amount) || ['pay', { toId: v.to, amount: num(v.amount), note: v.note }],
    success: (v) => `Paid ${nameOf(v.to)} ${money(num(v.amount))}`,
  }),
  request: () => {
    const others = otherPlayers();
    if (!others.length) { toast('No other players yet', 'bad'); return null; }
    return {
      title: 'Request money', submitLabel: 'Send request', noAutofocus: true, values: { from: others[0].id },
      fields: [
        { name: 'from', label: 'From', type: 'choice', options: others.map((p) => [p.id, `<span class="token" style="background:${colorHex(p.color)}"></span>${esc(p.name)}`]) },
        amountField(), noteField('e.g. Bought my 2Br/1Ba'),
      ],
      submit: (v) => needPositive(v.amount) || ['requestMoney', { fromPlayerId: v.from, amount: num(v.amount), note: v.note }],
      success: (v) => `Requested ${money(num(v.amount))} from ${nameOf(v.from)}`,
    };
  },
  collect: () => ({
    title: 'Collect from the Bank', submitLabel: 'Collect',
    fields: [amountField(), noteField()],
    preview: (v) => cashAfter(num(v.amount)),
    submit: (v) => needPositive(v.amount) || ['collect', { amount: num(v.amount), note: v.note }],
  }),
  ftBuy: () => ({
    title: 'Buy a Fast Track business', submitLabel: 'Buy',
    fields: [{ name: 'name', label: 'Business', type: 'text' }, { name: 'cost', label: 'Cost', type: 'number' },
      { name: 'cashFlow', label: 'CASHFLOW Day income added', type: 'number' }],
    preview: (v) => {
      const ft = me().fastTrack;
      const gained = ft.cashflowDayIncome + num(v.cashFlow) - ft.startIncome;
      return `<div class="row"><span>New CASHFLOW Day</span><strong>${money(ft.cashflowDayIncome + num(v.cashFlow))}</strong></div>
        <div class="row"><span>Progress</span><strong>${money(gained)} / ${money(game.settings.fastTrackGoal)}</strong></div>` + cashAfter(-num(v.cost));
    },
    submit: (v) => needPositive(v.cost, 'the cost') || ['buyFastTrackBusiness', { name: v.name, cost: num(v.cost), cashFlow: num(v.cashFlow) }],
  }),
  ftExpense: () => ({
    title: 'Fast Track expense', submitLabel: 'Pay',
    fields: [amountField(), noteField()],
    preview: (v) => cashAfter(-num(v.amount)),
    submit: (v) => needPositive(v.amount) || ['fastTrackLoss', { kind: 'custom', amount: num(v.amount), note: v.note }],
  }),
  dream: () => ({
    title: 'Buy your Dream', submitLabel: 'Buy it & win',
    fields: [{ name: 'name', label: 'Dream', type: 'text', placeholder: 'e.g. Around-the-world cruise' }, { name: 'cost', label: 'Cost', type: 'number' }],
    preview: (v) => cashAfter(-num(v.cost)),
    submit: (v) => needPositive(v.cost, 'the cost') || ['buyDream', { name: v.name, cost: num(v.cost) }],
  }),
  adjust: (p) => ({
    title: `Adjust ${p.name}'s cash`, submitLabel: 'Apply', values: { sign: '1' }, noAutofocus: true,
    fields: [{ name: 'sign', label: '', type: 'choice', options: [['1', 'Add'], ['-1', 'Subtract']] }, amountField(), noteField('Reason')],
    submit: (v) => needPositive(v.amount) || ['adjustCash', { playerId: p.id, delta: num(v.amount) * Number(v.sign), note: v.note }],
  }),
};

const MENUS = {
  market: () => {
    const self = me();
    const sells = self.assets.map((a) => ({
      label: `Sell ${esc(a.name)}`,
      sub: isUnits(a) ? `${a.shares.toLocaleString('en-US')} ${unitWord(a)}` : a.mortgage ? `mortgage ${money(a.mortgage)}` : TYPE_LABEL[a.type],
      run: () => sheet('sell', a),
    }));
    if (!sells.length) sells.push({ label: 'Nothing to sell yet', sub: 'buy a Deal first', disabled: true, run: () => {} });
    return ['Market', [...sells, { label: '📈 Stock split / reverse split', sub: 'affects everyone', run: () => sheet('market') }],
      'Sell when a Market card makes you an offer.'];
  },
  life: () => {
    const self = me();
    return ['Life event', [
      { label: '❤️ Charity', sub: `${money(Math.round(self.summary.totalIncome / 10))}`, run: CLICKS.charity },
      { label: '👶 Baby', sub: `${self.children}/3 children`, disabled: self.children >= 3, run: CLICKS.baby },
      { label: '📉 Downsized', sub: `${money(self.summary.totalExpenses)} · lose 2 turns`, run: CLICKS.downsized },
    ]];
  },
  money: () => ['Money', [
    { label: '💸 Pay', sub: 'a player or the Bank', run: () => sheet('pay') },
    { label: '🙋 Request', sub: 'from a player', run: () => sheet('request') },
    { label: '💰 Collect', sub: 'from the Bank', run: () => sheet('collect') },
  ]],
  badLuck: () => {
    const cash = me().cash;
    return ['Bad luck', [
      { label: '🧾 Tax Audit', sub: `−${money(Math.round(cash / 2))} (half)`, run: () => lossClick('audit', 'Tax Audit', 0.5) },
      { label: '⚖️ Lawsuit', sub: `−${money(Math.round(cash / 2))} (half)`, run: () => lossClick('lawsuit', 'Lawsuit', 0.5) },
      { label: '💔 Divorce', sub: `−${money(cash)} (all)`, run: () => lossClick('divorce', 'Divorce', 1) },
      { label: '🧾 Other expense', sub: 'enter an amount', run: () => sheet('ftExpense') },
    ]];
  },
};

function sheet(name, ...args) {
  const cfg = SHEETS[name](...args);
  if (cfg) openSheet(cfg);
}

// ---- click handling -------------------------------------------------------------

async function simple(type, confirmMsg, successMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return;
  const r = await act(type);
  if (r.ok && successMsg) toast(successMsg, 'good');
}

const CLICKS = {
  payday: () => simple('payday', null, `Payday! ${signed(me().summary.monthlyCashFlow)}`),
  doodad: () => sheet('doodad'),
  charity: () => simple('charity', `Give ${money(Math.round(me().summary.totalIncome / 10))} (10% of total income) to Charity?\nYou'll roll 2 dice for the next 3 turns.`, 'Thank you for your generosity'),
  baby: () => simple('baby', `Add a child? Expenses go up ${money(me().profession.perChildExpense)}/month.`, 'Congratulations! 👶'),
  downsized: () => simple('downsized', `Downsized: pay your total expenses (${money(me().summary.totalExpenses)}) and lose 2 turns?`),
  endTurn: () => act('endTurn'),
  buy: () => sheet('buy'),
  market: () => sheet('market'),
  loan: () => sheet('loan', 'take'),
  repay: () => sheet('loan', 'repay'),
  pay: () => sheet('pay'),
  request: () => sheet('request'),
  collect: () => sheet('collect'),
  enterFastTrack: () => simple('enterFastTrack',
    `Leave the Rat Race?\n\nYour CASHFLOW Day income becomes ${money(me().summary.passiveIncome * 100)} (passive income × 100), and that becomes your cash.`,
    '🚀 Welcome to the Fast Track!'),
  cashflowDay: () => simple('cashflowDay', null, `CASHFLOW Day! ${signed(me().fastTrack.cashflowDayIncome)}`),
  ftBuy: () => sheet('ftBuy'),
  ftExpense: () => sheet('ftExpense'),
  dream: () => sheet('dream'),
  audit: () => lossClick('audit', 'Tax Audit', 0.5),
  lawsuit: () => lossClick('lawsuit', 'Lawsuit', 0.5),
  divorce: () => lossClick('divorce', 'Divorce', 1),
  editCard: () => { editTarget = meId; setupBoundFor = null; render(); window.scrollTo(0, 0); },
  closeSheet: () => $('#sheet').close(),
  reset: async () => {
    if (!confirm('Reset the game? Everyone goes back to profession setup (card numbers are kept) and history is cleared.')) return;
    const r = await act('resetGame');
    if (r.ok) toast('Game reset');
  },
};

async function lossClick(kind, label, fraction) {
  const amt = Math.round(me().cash * fraction);
  if (!confirm(`${label}: lose ${money(amt)} (${fraction === 1 ? 'all' : 'half'} your cash)?`)) return;
  await act('fastTrackLoss', { kind });
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('button');
  if (!el || el.closest('#sheet-fields') || el.closest('#setup-fields')) return;
  const d = el.dataset;
  if (d.click && CLICKS[d.click]) return CLICKS[d.click]();
  if (d.menu && MENUS[d.menu]) { const [title, items, help] = MENUS[d.menu](); return openMenu(title, items, help); }
  if (d.page) return showPage(Number(d.page));
  if (d.sell) { const a = me().assets.find((x) => x.id === d.sell); if (a) sheet('sell', a); return; }
  if (d.payoff) {
    const [, label] = S.LIABILITY_LINES.find(([k]) => k === d.payoff);
    const bal = me().profession.liabilities[d.payoff];
    if (confirm(`Pay off your ${label.toLowerCase()} for ${money(bal)}? Your expenses drop by ${money(me().profession.expenses[d.payoff] || 0)}/month.`)) {
      const r = await act('payOffLiability', { kind: d.payoff });
      if (r.ok) toast(`${label} paid off`, 'good');
    }
    return;
  }
  if (d.respond) {
    const accept = d.accept === '1';
    const r = await act('respondRequest', { requestId: d.respond, accept });
    if (r.ok && accept) toast('Paid', 'good');
    return;
  }
  if (d.undo) {
    const t = game.transactions.find((x) => x.id === d.undo);
    if (t && confirm(`Undo: "${nameOf(t.actorId)} ${t.text}"?`)) {
      const r = await act('undo', { txId: d.undo });
      if (r.ok) toast('Undone');
    }
    return;
  }
  if (d.editcard) { editTarget = d.editcard; setupBoundFor = null; render(); window.scrollTo(0, 0); return; }
  if (d.adjust) return sheet('adjust', player(d.adjust));
  if (d.makehost) {
    if (confirm(`Make ${player(d.makehost).name} the host? You'll lose host controls.`)) await act('makeHost', { playerId: d.makehost });
    return;
  }
  if (d.kick) {
    if (confirm(`Remove ${player(d.kick).name} from the game?`)) await act('kickPlayer', { playerId: d.kick });
  }
});

$('#setup-cancel').addEventListener('click', () => { editTarget = null; setupBoundFor = null; render(); });

$('#color-picker').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (!b || b.disabled) return;
  selectedColor = b.dataset.color;
  renderJoin();
});

$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('#join-error').textContent = '';
  socket.emit('join', { name: $('#join-name').value, color: selectedColor }, (res) => {
    if (!res.ok) { $('#join-error').textContent = res.error; return; }
    setSecret(res.secret);
    meId = res.playerId;
    lastCash = null;
    render();
  });
});

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const r = await act('updateSettings', {
    startWithPayday: f.startWithPayday.checked, loanUnit: Number(f.loanUnit.value), loanRatePercent: Number(f.loanRatePercent.value),
  });
  if (r.ok) { toast('Settings saved', 'good'); f.querySelector('button').focus(); }
});

setInterval(() => { const self = me(); if (self && !$('#main-view').hidden && !$('#sheet').open) renderHistory(self); }, 30000);

// ---- Play / Statement pager (swipe on phones, side by side on wide screens) ----

const pager = $('#pager');
const pages = [$('#page-play'), $('#page-statement')];
let currentPage = 0;

function fitPagerHeight() {
  if (getComputedStyle(pager).overflowX === 'visible') { pager.style.height = ''; return; }
  pager.style.height = `${pages[currentPage].offsetHeight}px`;
}

function markPage(i) {
  if (i === currentPage) return;
  currentPage = i;
  document.querySelectorAll('.pager-nav [data-page]').forEach((b) => b.classList.toggle('selected', Number(b.dataset.page) === i));
  fitPagerHeight();
  const navTop = $('.pager-nav').getBoundingClientRect().top + window.scrollY;
  if (window.scrollY > navTop) window.scrollTo({ top: navTop - 8, behavior: 'smooth' });
}

function showPage(i) {
  pager.scrollTo({ left: pages[i].offsetLeft, behavior: 'smooth' });
  markPage(i);
}

pager.addEventListener('scroll', () => {
  markPage(pager.scrollLeft > pager.clientWidth / 2 ? 1 : 0);
}, { passive: true });

new ResizeObserver(fitPagerHeight).observe(pages[0]);
new ResizeObserver(fitPagerHeight).observe(pages[1]);
window.addEventListener('resize', fitPagerHeight);

// ---- history box: oldest at top, newest at bottom; shows the newest 5, scroll up for older ----
const HISTORY_VISIBLE = 5;

function renderHistoryList(el, html) {
  const ready = el.dataset.ready === '1';
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
  const prevTop = el.scrollTop;
  el.innerHTML = html;
  if (!el.offsetParent) { delete el.dataset.ready; return; } // hidden: fit when shown
  el.dataset.ready = '1';
  const items = el.children;
  if (items.length > HISTORY_VISIBLE) {
    let h = 0;
    for (let i = items.length - HISTORY_VISIBLE; i < items.length; i++) h += items[i].offsetHeight;
    el.style.maxHeight = `${h}px`;
  } else {
    el.style.maxHeight = '';
  }
  // stay pinned to the newest item unless the player has scrolled up to read older ones
  el.scrollTop = !ready || atBottom ? el.scrollHeight : prevTop;
  el.classList.toggle('more-above', el.scrollTop > 2);
}

document.querySelectorAll('.history').forEach((el) => el.addEventListener('scroll', () => {
  el.classList.toggle('more-above', el.scrollTop > 2);
}, { passive: true }));
