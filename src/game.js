'use strict';

// Pure Cashflow game logic: no I/O. Every action takes (state, actorId, payload)
// and returns { ok: true, tx? } or { ok: false, error, needLoan? }.
//
// Money-moving actions run inside withTx(): it snapshots every affected
// player's statement first, so a failed action rolls back cleanly and a
// successful one can be undone by restoring the snapshot.

const crypto = require('node:crypto');
const S = require('./statement');

const BANK = 'bank';
const MAX_PLAYERS = 6;
const MAX_AMOUNT = 100_000_000;
const MAX_TRANSACTIONS = 300;
const FAST_TRACK_GOAL = 50_000;

const COLORS = [
  { id: 'red', hex: '#e53935' },
  { id: 'blue', hex: '#1e88e5' },
  { id: 'green', hex: '#43a047' },
  { id: 'yellow', hex: '#fdd835' },
  { id: 'purple', hex: '#8e24aa' },
  { id: 'orange', hex: '#fb8c00' },
  { id: 'pink', hex: '#ec407a' },
  { id: 'teal', hex: '#00897b' },
];

// Fields restored by undo (identity fields like name/color/isHost are not).
const STATEMENT_KEYS = ['stage', 'cash', 'profession', 'paidOff', 'bankLoan', 'children', 'assets',
  'turnsSkipped', 'charityTurns', 'fastTrack'];

class GameError extends Error {
  constructor(message, extra = {}) { super(message); this.extra = extra; }
}

const newId = () => crypto.randomBytes(6).toString('hex');
const newSecret = () => crypto.randomBytes(24).toString('hex');
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
const clone = (v) => structuredClone(v);
const fmt = (n) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US')}`;

function createState() {
  return {
    settings: { ...S.DEFAULT_SETTINGS },
    players: [],
    pendingRequests: [],
    transactions: [],
  };
}

function freshStatement() {
  return {
    stage: 'setup', cash: 0, paidOff: {}, bankLoan: 0, children: 0, assets: [],
    turnsSkipped: 0, charityTurns: 0, fastTrack: null,
  };
}

// ---- input helpers ---------------------------------------------------------

function toNumber(v) {
  return typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
}

function int(value, label, { min = 0, max = MAX_AMOUNT, allowNegative = false } = {}) {
  const n = toNumber(value === undefined || value === null || value === '' ? 0 : value);
  const lo = allowNegative ? -max : min;
  if (!Number.isInteger(n) || n < lo || n > max) {
    throw new GameError(`${label} must be a whole number${allowNegative ? '' : ` of at least ${min}`}`);
  }
  return n;
}

function positive(value, label) {
  return int(value, label, { min: 1 });
}

function text(value, label, maxLen = 40) {
  const t = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLen) : '';
  if (!t) throw new GameError(`Enter ${label}`);
  return t;
}

const note = (v) => (typeof v === 'string' ? v.trim().slice(0, 60) : '');

// ---- lookups ---------------------------------------------------------------

function getPlayer(state, id) {
  return state.players.find((p) => p.id === id) || null;
}

function findBySecret(state, secret) {
  if (typeof secret !== 'string' || !secret) return null;
  return state.players.find((p) => p.secret === secret) || null;
}

function mustPlayer(state, id) {
  const p = getPlayer(state, id);
  if (!p) throw new GameError('Not in game');
  return p;
}

function mustHost(state, id) {
  const p = mustPlayer(state, id);
  if (!p.isHost) throw new GameError('Host only');
  return p;
}

function mustStage(p, ...stages) {
  if (stages.includes(p.stage)) return;
  const names = { setup: 'set up your profession first', ratRace: 'only in the Rat Race', fastTrack: 'only on the Fast Track', won: 'the game is won' };
  throw new GameError(p.stage === 'setup' ? 'Set up your profession first' : `That's ${names[stages[0]]}`);
}

// ---- transactions ----------------------------------------------------------

function snapshot(p) {
  const s = {};
  for (const k of STATEMENT_KEYS) s[k] = clone(p[k]);
  return s;
}

function restore(p, snap) {
  for (const k of STATEMENT_KEYS) p[k] = clone(snap[k]);
}

// Runs mutate() against the listed players. On GameError everything is rolled
// back; on success a transaction is recorded with the before-snapshots.
function withTx(state, actorId, playerIds, type, mutate) {
  const ids = [...new Set(playerIds)];
  const before = {};
  try {
    for (const id of ids) before[id] = snapshot(mustPlayer(state, id));
    const description = mutate();
    const deltas = {};
    for (const id of ids) deltas[id] = getPlayer(state, id).cash - before[id].cash;
    const tx = {
      id: newId(), type, actorId, playerIds: ids, text: description, deltas,
      createdAt: Date.now(), undone: false, before,
    };
    state.transactions.unshift(tx);
    if (state.transactions.length > MAX_TRANSACTIONS) state.transactions.length = MAX_TRANSACTIONS;
    return { ok: true, tx };
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
    for (const id of Object.keys(before)) restore(getPlayer(state, id), before[id]);
    return fail(err.message, err.extra);
  }
}

// Removes cash. If short in the Rat Race, either takes the bank loan needed
// (autoLoan) or fails with needLoan so the client can offer it.
// Returns a suffix describing any loan taken.
function spend(state, p, amount, autoLoan) {
  if (p.cash >= amount) { p.cash -= amount; return ''; }
  const unit = state.settings.loanUnit;
  const loan = Math.ceil((amount - p.cash) / unit) * unit;
  if (!autoLoan || p.stage !== 'ratRace') {
    throw new GameError(`Not enough cash: you need ${fmt(amount - p.cash)} more`,
      p.stage === 'ratRace' ? { needLoan: loan } : {});
  }
  p.bankLoan += loan;
  p.cash += loan - amount;
  return ` (took a ${fmt(loan)} bank loan)`;
}

// ---- joining & setup ---------------------------------------------------------

function join(state, _actorId, { name, color } = {}) {
  if (state.players.length >= MAX_PLAYERS) return fail(`Game full (${MAX_PLAYERS}/${MAX_PLAYERS})`);
  const trimmed = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!trimmed) return fail('Enter a name');
  if (trimmed.length > 20) return fail('Name must be 20 characters or fewer');
  const lower = trimmed.toLowerCase();
  if (lower === 'bank') return fail('That name is reserved');
  if (state.players.some((p) => p.name.toLowerCase() === lower)) return fail('That name is taken');
  if (!COLORS.some((c) => c.id === color)) return fail('Pick a token colour');
  if (state.players.some((p) => p.color === color)) return fail('That colour is taken');

  const player = {
    id: newId(), secret: newSecret(), name: trimmed, color,
    isHost: state.players.length === 0, connected: false,
    profession: null,
    ...freshStatement(),
  };
  state.players.push(player);
  return { ok: true, player };
}

function parseProfession(payload) {
  const expenses = {};
  for (const [key, label] of S.EXPENSE_LINES) expenses[key] = int(payload.expenses?.[key], label);
  const liabilities = {};
  for (const [key, label] of S.LIABILITY_LINES) liabilities[key] = int(payload.liabilities?.[key], label);
  return {
    title: text(payload.title, 'your profession title', 30),
    salary: positive(payload.salary, 'Salary'),
    perChildExpense: int(payload.perChildExpense, 'Per child expense'),
    savings: int(payload.savings, 'Savings'),
    expenses,
    liabilities,
  };
}

// First call (stage "setup") starts the player in the Rat Race; later calls
// edit the card values without touching cash. Host may edit anyone's.
function setupProfession(state, actorId, payload = {}) {
  const targetId = payload.playerId || actorId;
  return withTx(state, actorId, [targetId], 'setup', () => {
    if (targetId !== actorId) mustHost(state, actorId);
    const p = mustPlayer(state, targetId);
    p.profession = parseProfession(payload);
    if (p.stage === 'setup') {
      const cf = S.summarize(p, state.settings).monthlyCashFlow;
      p.cash = p.profession.savings + (state.settings.startWithPayday ? Math.max(cf, 0) : 0);
      p.stage = 'ratRace';
      return `started as ${p.profession.title} with ${fmt(p.cash)}`;
    }
    return `updated ${targetId === actorId ? 'their' : `${p.name}'s`} profession card`;
  });
}

// ---- Rat Race ----------------------------------------------------------------

function payday(state, actorId, { autoLoan } = {}) {
  return withTx(state, actorId, [actorId], 'payday', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'ratRace');
    const cf = S.summarize(p, state.settings).monthlyCashFlow;
    if (cf >= 0) { p.cash += cf; return `collected Payday: +${fmt(cf)}`; }
    return `had a negative Payday: ${fmt(cf)}${spend(state, p, -cf, autoLoan)}`;
  });
}

function doodad(state, actorId, { amount, note: n, autoLoan } = {}) {
  return withTx(state, actorId, [actorId], 'doodad', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'ratRace');
    const amt = positive(amount, 'Amount');
    const loan = spend(state, p, amt, autoLoan);
    return `paid ${fmt(amt)} for a Doodad${note(n) ? `: ${note(n)}` : ''}${loan}`;
  });
}

function charity(state, actorId, { autoLoan } = {}) {
  return withTx(state, actorId, [actorId], 'charity', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'ratRace');
    const amt = Math.round(S.summarize(p, state.settings).totalIncome / 10);
    const loan = spend(state, p, amt, autoLoan);
    p.charityTurns = 3;
    return `gave ${fmt(amt)} to Charity (2 dice for 3 turns)${loan}`;
  });
}

function baby(state, actorId) {
  return withTx(state, actorId, [actorId], 'baby', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'ratRace');
    if (p.children >= 3) throw new GameError('You already have the maximum of 3 children');
    p.children += 1;
    return `had a baby! (+${fmt(p.profession.perChildExpense)}/mo expenses)`;
  });
}

function downsized(state, actorId, { autoLoan } = {}) {
  return withTx(state, actorId, [actorId], 'downsized', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'ratRace');
    const amt = S.summarize(p, state.settings).totalExpenses;
    const loan = spend(state, p, amt, autoLoan);
    p.turnsSkipped = 2;
    return `was Downsized: paid ${fmt(amt)} and loses 2 turns${loan}`;
  });
}

// Counts down Charity / Downsized reminders. Not a money transaction.
function endTurn(state, actorId) {
  const p = getPlayer(state, actorId);
  if (!p) return fail('Not in game');
  if (p.turnsSkipped > 0) p.turnsSkipped -= 1;
  else if (p.charityTurns > 0) p.charityTurns -= 1;
  else return fail('Nothing to count down');
  return { ok: true };
}

function loanAmount(state, amount) {
  const amt = positive(amount, 'Loan amount');
  const unit = state.settings.loanUnit;
  if (amt % unit) throw new GameError(`Loans are in ${fmt(unit)} units`);
  return amt;
}

function takeLoan(state, actorId, { amount } = {}) {
  return withTx(state, actorId, [actorId], 'loan', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'ratRace');
    const amt = loanAmount(state, amount);
    p.bankLoan += amt;
    p.cash += amt;
    return `took a ${fmt(amt)} bank loan`;
  });
}

function repayLoan(state, actorId, { amount } = {}) {
  return withTx(state, actorId, [actorId], 'repayLoan', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'ratRace');
    const amt = loanAmount(state, amount);
    if (amt > p.bankLoan) throw new GameError(`Your bank loan is only ${fmt(p.bankLoan)}`);
    spend(state, p, amt, false);
    p.bankLoan -= amt;
    return `repaid ${fmt(amt)} of their bank loan`;
  });
}

function payOffLiability(state, actorId, { kind } = {}) {
  return withTx(state, actorId, [actorId], 'payOff', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'ratRace');
    const line = S.LIABILITY_LINES.find(([k]) => k === kind);
    if (!line) throw new GameError('Unknown liability');
    const balance = p.profession.liabilities[kind];
    if (p.paidOff[kind] || !balance) throw new GameError('Nothing owed on that');
    spend(state, p, balance, false);
    p.paidOff[kind] = true;
    return `paid off their ${line[1].toLowerCase()} (${fmt(balance)}), saving ${fmt(p.profession.expenses[kind])}/mo`;
  });
}

function buyAsset(state, actorId, payload = {}) {
  return withTx(state, actorId, [actorId], 'buy', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'ratRace');
    const name = payload.type === 'gold' && !(payload.name || '').trim() ? 'Gold coins' : text(payload.name, 'a name for the asset');
    let asset, price, desc;
    if (payload.type === 'gold') {
      // Precious metals: a number of coins at a price each, no monthly income.
      const coins = positive(payload.shares, 'Coins');
      const costPerShare = int(payload.price, 'Price per coin');
      asset = { id: newId(), type: 'gold', name, shares: coins, costPerShare, dividend: 0 };
      price = coins * costPerShare;
      desc = `bought ${coins.toLocaleString('en-US')} × ${name} @ ${fmt(costPerShare)}`;
    } else if (payload.type === 'stock') {
      const shares = positive(payload.shares, 'Shares');
      const costPerShare = int(payload.price, 'Price per share');
      const dividend = toNumber(payload.dividend || 0);
      if (typeof dividend !== 'number' || !(dividend >= 0) || dividend > 100000) throw new GameError('Dividend must be 0 or more');
      asset = { id: newId(), type: 'stock', name, shares, costPerShare, dividend };
      price = shares * costPerShare;
      desc = `bought ${shares.toLocaleString('en-US')} × ${name} @ ${fmt(costPerShare)}`;
    } else if (payload.type === 'realEstate' || payload.type === 'business') {
      const cost = positive(payload.cost, 'Cost');
      const downPayment = int(payload.downPayment, 'Down payment');
      if (downPayment > cost) throw new GameError("Down payment can't exceed the cost");
      const cashFlow = int(payload.cashFlow, 'Cash flow', { allowNegative: true });
      asset = { id: newId(), type: payload.type, name, cost, downPayment, mortgage: cost - downPayment, cashFlow };
      price = downPayment;
      desc = `bought ${name}: ${fmt(downPayment)} down, ${cashFlow >= 0 ? '+' : ''}${fmt(cashFlow)}/mo`;
    } else {
      throw new GameError('Pick stock, gold, real estate or business');
    }
    const loan = spend(state, p, price, payload.autoLoan);
    p.assets.push(asset);
    return desc + loan;
  });
}

function sellAsset(state, actorId, { assetId, price, shares, autoLoan } = {}) {
  return withTx(state, actorId, [actorId], 'sell', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'ratRace');
    const idx = p.assets.findIndex((a) => a.id === assetId);
    if (idx === -1) throw new GameError('Asset not found');
    const asset = p.assets[idx];
    const pr = int(price, 'Sale price');
    if (asset.type === 'stock' || asset.type === 'gold') {
      const unit = asset.type === 'gold' ? 'coins' : 'shares';
      const n = shares === undefined || shares === '' ? asset.shares : positive(shares, unit[0].toUpperCase() + unit.slice(1));
      if (n > asset.shares) throw new GameError(`You only have ${asset.shares} ${unit}`);
      p.cash += n * pr;
      asset.shares -= n;
      if (asset.shares === 0) p.assets.splice(idx, 1);
      return `sold ${n.toLocaleString('en-US')} × ${asset.name} @ ${fmt(pr)} for ${fmt(n * pr)}`;
    }
    const proceeds = pr - asset.mortgage;
    p.assets.splice(idx, 1);
    let loan = '';
    if (proceeds >= 0) p.cash += proceeds;
    else loan = spend(state, p, -proceeds, autoLoan);
    return `sold ${asset.name} for ${fmt(pr)} (${fmt(proceeds)} after paying off the ${fmt(asset.mortgage)} mortgage)${loan}`;
  });
}

// Market card: split/reverse split applies to every player holding the stock.
function stockSplit(state, actorId, { name, kind } = {}) {
  const target = typeof name === 'string' ? name.trim().toLowerCase() : '';
  if (!target) return fail('Enter the stock symbol');
  if (kind !== 'split' && kind !== 'reverse') return fail('Pick split or reverse split');
  const holders = state.players.filter((p) => p.assets.some((a) => a.type === 'stock' && a.name.toLowerCase() === target));
  if (!holders.length) return fail(`Nobody owns ${name.trim()}`);
  return withTx(state, actorId, [actorId, ...holders.map((p) => p.id)], 'split', () => {
    mustPlayer(state, actorId);
    for (const p of holders) {
      for (const a of p.assets) {
        if (a.type !== 'stock' || a.name.toLowerCase() !== target) continue;
        if (kind === 'split') { a.shares *= 2; a.costPerShare = Math.round(a.costPerShare / 2); a.dividend /= 2; }
        else { a.shares = Math.floor(a.shares / 2); a.costPerShare *= 2; a.dividend *= 2; }
      }
      p.assets = p.assets.filter((a) => a.type !== 'stock' || a.shares > 0);
    }
    return `applied a ${kind === 'split' ? '2-for-1 split' : '1-for-2 reverse split'} to ${name.trim()} (${holders.map((h) => h.name).join(', ')})`;
  });
}

// ---- player <-> player / bank --------------------------------------------------

function pay(state, actorId, { toId, amount, note: n, autoLoan } = {}) {
  const ids = toId === BANK ? [actorId] : [actorId, toId];
  return withTx(state, actorId, ids, 'pay', () => {
    const p = mustPlayer(state, actorId);
    if (p.stage === 'setup') mustStage(p, 'ratRace');
    if (toId === actorId) throw new GameError("Can't pay yourself");
    const to = toId === BANK ? null : getPlayer(state, toId);
    if (toId !== BANK && !to) throw new GameError('Pick who to pay');
    const amt = positive(amount, 'Amount');
    const loan = spend(state, p, amt, autoLoan);
    if (to) to.cash += amt;
    return `paid ${to ? to.name : 'the Bank'} ${fmt(amt)}${note(n) ? `: ${note(n)}` : ''}${loan}`;
  });
}

function collect(state, actorId, { amount, note: n } = {}) {
  return withTx(state, actorId, [actorId], 'collect', () => {
    const p = mustPlayer(state, actorId);
    if (p.stage === 'setup') mustStage(p, 'ratRace');
    const amt = positive(amount, 'Amount');
    p.cash += amt;
    return `collected ${fmt(amt)} from the Bank${note(n) ? `: ${note(n)}` : ''}`;
  });
}

function requestMoney(state, actorId, { fromPlayerId, amount, note: n } = {}) {
  if (!getPlayer(state, actorId)) return fail('Not in game');
  if (!getPlayer(state, fromPlayerId)) return fail('Pick a player to request from');
  if (fromPlayerId === actorId) return fail("Can't request from yourself");
  const amt = toNumber(amount);
  if (!Number.isInteger(amt) || amt <= 0 || amt > MAX_AMOUNT) return fail('Enter a whole-dollar amount greater than 0');
  const request = { id: newId(), fromId: actorId, toId: fromPlayerId, amount: amt, note: note(n), createdAt: Date.now() };
  state.pendingRequests.push(request);
  return { ok: true, request };
}

function respondRequest(state, actorId, { requestId, accept, autoLoan } = {}) {
  const idx = state.pendingRequests.findIndex((r) => r.id === requestId);
  if (idx === -1) return fail('Request no longer exists');
  const req = state.pendingRequests[idx];
  if (req.toId !== actorId && req.fromId !== actorId) return fail('Not your request');
  if (!accept) { state.pendingRequests.splice(idx, 1); return { ok: true, declined: true }; }
  if (req.toId !== actorId) return fail('Only the payer can accept');
  const res = pay(state, actorId, { toId: req.fromId, amount: req.amount, note: req.note, autoLoan });
  if (res.ok) state.pendingRequests.splice(state.pendingRequests.indexOf(req), 1);
  return res;
}

// ---- Fast Track ----------------------------------------------------------------

function enterFastTrack(state, actorId) {
  return withTx(state, actorId, [actorId], 'fastTrack', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'ratRace');
    const s = S.summarize(p, state.settings);
    if (!s.canEscape) throw new GameError('Your passive income must be greater than your total expenses');
    const income = s.passiveIncome * 100;
    p.fastTrack = { cashflowDayIncome: income, startIncome: income, businesses: [] };
    p.cash = income;
    p.stage = 'fastTrack';
    return `escaped the Rat Race! CASHFLOW Day income: ${fmt(income)}`;
  });
}

function cashflowDay(state, actorId) {
  return withTx(state, actorId, [actorId], 'cashflowDay', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'fastTrack');
    p.cash += p.fastTrack.cashflowDayIncome;
    return `collected CASHFLOW Day: +${fmt(p.fastTrack.cashflowDayIncome)}`;
  });
}

function checkWin(p) {
  if (p.fastTrack.cashflowDayIncome - p.fastTrack.startIncome >= FAST_TRACK_GOAL) {
    p.stage = 'won';
    return ' and WON by growing CASHFLOW Day income by $50,000!';
  }
  return '';
}

function buyFastTrackBusiness(state, actorId, { name, cost, cashFlow } = {}) {
  return withTx(state, actorId, [actorId], 'ftBuy', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'fastTrack');
    const biz = { id: newId(), name: text(name, 'the business name'), cost: positive(cost, 'Cost'), cashFlow: int(cashFlow, 'Cash flow') };
    spend(state, p, biz.cost, false);
    p.fastTrack.businesses.push(biz);
    p.fastTrack.cashflowDayIncome += biz.cashFlow;
    return `bought ${biz.name} for ${fmt(biz.cost)} (+${fmt(biz.cashFlow)} CASHFLOW Day income)${checkWin(p)}`;
  });
}

const LOSSES = {
  audit: { label: 'Tax Audit', fraction: 0.5 },
  lawsuit: { label: 'Lawsuit', fraction: 0.5 },
  divorce: { label: 'Divorce', fraction: 1 },
};

function fastTrackLoss(state, actorId, { kind, amount, note: n } = {}) {
  return withTx(state, actorId, [actorId], 'ftLoss', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'fastTrack');
    if (kind === 'custom') {
      const amt = positive(amount, 'Amount');
      spend(state, p, amt, false);
      return `paid ${fmt(amt)}${note(n) ? `: ${note(n)}` : ''}`;
    }
    const loss = LOSSES[kind];
    if (!loss) throw new GameError('Unknown event');
    const amt = Math.round(p.cash * loss.fraction);
    p.cash -= amt;
    return `hit ${loss.label}: lost ${fmt(amt)}`;
  });
}

function buyDream(state, actorId, { name, cost } = {}) {
  return withTx(state, actorId, [actorId], 'dream', () => {
    const p = mustPlayer(state, actorId);
    mustStage(p, 'fastTrack');
    const dream = text(name, 'your dream');
    const amt = positive(cost, 'Cost');
    spend(state, p, amt, false);
    p.stage = 'won';
    return `bought their Dream (${dream}) for ${fmt(amt)} and WON!`;
  });
}

// ---- undo ----------------------------------------------------------------------

// A tx can only be undone if no later live tx touches any of the same players.
function undoBlockers(state) {
  const blocked = new Set();
  const touched = new Set();
  for (const tx of state.transactions) {
    if (tx.type === 'undo' || tx.undone) continue;
    if (tx.playerIds.some((id) => touched.has(id))) blocked.add(tx.id);
    for (const id of tx.playerIds) touched.add(id);
  }
  return blocked;
}

function undo(state, actorId, { txId } = {}) {
  const actor = getPlayer(state, actorId);
  if (!actor) return fail('Not in game');
  const tx = state.transactions.find((t) => t.id === txId);
  if (!tx) return fail('Transaction not found');
  if (tx.type === 'undo') return fail("Can't undo an undo");
  if (tx.undone) return fail('Already undone');
  if (tx.actorId !== actorId && !actor.isHost) return fail('Only the person who made it (or the host) can undo');
  if (undoBlockers(state).has(tx.id)) return fail('Undo the newer transactions for these players first');
  if (!tx.playerIds.every((id) => getPlayer(state, id))) return fail('A player in that transaction has left the game');

  const res = withTx(state, actorId, tx.playerIds, 'undo', () => {
    for (const id of tx.playerIds) restore(getPlayer(state, id), tx.before[id]);
    return `undid: ${tx.text}`;
  });
  if (res.ok) {
    tx.undone = true;
    res.tx.undoOf = tx.id;
  }
  return res;
}

// ---- host ----------------------------------------------------------------------

function adjustCash(state, actorId, { playerId, delta, note: n } = {}) {
  return withTx(state, actorId, [playerId], 'adjust', () => {
    mustHost(state, actorId);
    const p = mustPlayer(state, playerId);
    const d = int(delta, 'Adjustment', { allowNegative: true });
    if (!d) throw new GameError('Enter a non-zero adjustment');
    p.cash += d;
    return `adjusted ${p.name}'s cash by ${d > 0 ? '+' : ''}${fmt(d)}${note(n) ? `: ${note(n)}` : ''}`;
  });
}

function kickPlayer(state, actorId, { playerId } = {}) {
  const host = getPlayer(state, actorId);
  if (!host || !host.isHost) return fail('Host only');
  if (playerId === actorId) return fail("Host can't remove themselves");
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx === -1) return fail('Player not found');
  const [removed] = state.players.splice(idx, 1);
  state.pendingRequests = state.pendingRequests.filter((r) => r.fromId !== playerId && r.toId !== playerId);
  return { ok: true, removed };
}

function makeHost(state, actorId, { playerId } = {}) {
  const host = getPlayer(state, actorId);
  if (!host || !host.isHost) return fail('Host only');
  const target = getPlayer(state, playerId);
  if (!target) return fail('Player not found');
  host.isHost = false;
  target.isHost = true;
  return { ok: true };
}

function updateSettings(state, actorId, { startWithPayday, loanUnit, loanRatePercent } = {}) {
  const host = getPlayer(state, actorId);
  if (!host || !host.isHost) return fail('Host only');
  const unit = toNumber(loanUnit ?? state.settings.loanUnit);
  const rate = toNumber(loanRatePercent ?? state.settings.loanRatePercent);
  if (!Number.isInteger(unit) || unit <= 0 || unit > MAX_AMOUNT) return fail('Loan unit must be a whole number above 0');
  if (!Number.isInteger(rate) || rate < 0 || rate > 100) return fail('Loan rate must be 0–100%');
  state.settings.loanUnit = unit;
  state.settings.loanRatePercent = rate;
  if (typeof startWithPayday === 'boolean') state.settings.startWithPayday = startWithPayday;
  return { ok: true };
}

// Everyone goes back to setup; their profession card stays filled in for reuse.
function resetGame(state, actorId) {
  const host = getPlayer(state, actorId);
  if (!host || !host.isHost) return fail('Host only');
  for (const p of state.players) Object.assign(p, freshStatement());
  state.pendingRequests = [];
  state.transactions = [];
  return { ok: true };
}

// ---- broadcast -----------------------------------------------------------------

function publicState(state) {
  const blocked = undoBlockers(state);
  return {
    settings: { ...state.settings, maxPlayers: MAX_PLAYERS, fastTrackGoal: FAST_TRACK_GOAL },
    colors: COLORS,
    players: state.players.map(({ secret, ...rest }) => ({ ...rest, summary: S.summarize(rest, state.settings) })),
    pendingRequests: state.pendingRequests,
    transactions: state.transactions.slice(0, 100).map(({ before, ...tx }) => ({ ...tx, blocked: blocked.has(tx.id) })),
  };
}

const actions = {
  setupProfession, payday, doodad, charity, baby, downsized, endTurn, takeLoan, repayLoan, payOffLiability,
  buyAsset, sellAsset, stockSplit, pay, collect, requestMoney, respondRequest,
  enterFastTrack, cashflowDay, buyFastTrackBusiness, fastTrackLoss, buyDream, undo,
  adjustCash, kickPlayer, makeHost, updateSettings, resetGame,
};

module.exports = {
  BANK, MAX_PLAYERS, COLORS, FAST_TRACK_GOAL,
  createState, publicState, getPlayer, findBySecret, join, actions,
  ...actions,
};
