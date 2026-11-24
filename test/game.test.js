'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('../src/game');

const COLOR_IDS = game.COLORS.map((c) => c.id);

// Salary 3000, expenses 1950 → cash flow 1050. Savings 500.
const CARD = {
  title: 'Engineer', salary: 3000, perChildExpense: 200, savings: 500,
  expenses: { taxes: 600, homeMortgage: 400, schoolLoan: 0, carLoan: 100, creditCard: 100, retail: 50, other: 700 },
  liabilities: { homeMortgage: 40000, schoolLoan: 0, carLoan: 5000, creditCard: 3000, retail: 1000 },
};

function setup(n = 2, { started = true } = {}) {
  const state = game.createState();
  const players = [];
  for (let i = 0; i < n; i++) {
    const res = game.join(state, null, { name: `P${i}`, color: COLOR_IDS[i] });
    assert.ok(res.ok, res.error);
    if (started) assert.ok(game.setupProfession(state, res.player.id, CARD).ok);
    players.push(res.player);
  }
  return { state, players };
}

const ok = (res) => { assert.ok(res.ok, res.error); return res; };
const summary = (state, p) => require('../src/statement').summarize(p, state.settings);

// ---- joining (carried over from Monopoly) ----

test('join: host, 6-player limit, duplicates, secrets stripped', () => {
  const { state, players } = setup(6, { started: false });
  assert.equal(players[0].isHost, true);
  assert.equal(players[1].isHost, false);
  assert.match(game.join(state, null, { name: 'Late', color: COLOR_IDS[6] }).error, /full/i);
  const s2 = game.createState();
  game.join(s2, null, { name: 'Ann', color: 'red' });
  assert.equal(game.join(s2, null, { name: 'ann', color: 'blue' }).ok, false);
  assert.equal(game.join(s2, null, { name: 'Bob', color: 'red' }).ok, false);
  for (const p of game.publicState(state).players) assert.equal('secret' in p, false);
  assert.equal(game.findBySecret(state, players[2].secret).id, players[2].id);
});

// ---- setup ----

test('setup: starts with savings + one Payday, enters Rat Race; validates', () => {
  const { state, players: [a] } = setup(1, { started: false });
  assert.equal(game.payday(state, a.id).ok, false); // must set up first
  assert.equal(game.setupProfession(state, a.id, { ...CARD, salary: 0 }).ok, false);
  assert.equal(game.setupProfession(state, a.id, { ...CARD, title: '' }).ok, false);
  assert.equal(game.setupProfession(state, a.id, { ...CARD, expenses: { ...CARD.expenses, taxes: -5 } }).ok, false);
  assert.equal(a.stage, 'setup');
  ok(game.setupProfession(state, a.id, CARD));
  assert.equal(a.stage, 'ratRace');
  assert.equal(a.cash, 1550);

  // editing later doesn't touch cash
  ok(game.setupProfession(state, a.id, { ...CARD, salary: 4000 }));
  assert.equal(a.cash, 1550);
  assert.equal(summary(state, a).monthlyCashFlow, 2050);
});

test('setup: savings-only setting', () => {
  const { state, players: [a] } = setup(1, { started: false });
  ok(game.updateSettings(state, a.id, { startWithPayday: false }));
  ok(game.setupProfession(state, a.id, CARD));
  assert.equal(a.cash, 500);
});

test('setup: host can edit another player, others cannot', () => {
  const { state, players: [host, b] } = setup(2);
  ok(game.setupProfession(state, host.id, { ...CARD, playerId: b.id, salary: 5000 }));
  assert.equal(b.profession.salary, 5000);
  assert.equal(game.setupProfession(state, b.id, { ...CARD, playerId: host.id }).ok, false);
});

// ---- Rat Race ----

test('payday, doodad, charity, baby, downsized', () => {
  const { state, players: [a] } = setup(1);
  ok(game.payday(state, a.id));
  assert.equal(a.cash, 2600);
  ok(game.doodad(state, a.id, { amount: 100, note: 'New golf clubs' }));
  assert.equal(a.cash, 2500);
  ok(game.charity(state, a.id));
  assert.equal(a.cash, 2200); // 10% of 3000
  assert.equal(a.charityTurns, 3);
  ok(game.baby(state, a.id));
  ok(game.baby(state, a.id));
  ok(game.baby(state, a.id));
  assert.match(game.baby(state, a.id).error, /3 children/);
  assert.equal(summary(state, a).totalExpenses, 2550);
  ok(game.downsized(state, a.id, { autoLoan: true })); // 2200 cash, 2550 expenses → $1,000 loan
  assert.equal(a.cash, 650);
});

test('downsized pays total expenses and sets 2 skipped turns; endTurn counts down', () => {
  const { state, players: [a] } = setup(1);
  ok(game.payday(state, a.id)); // 2600 cash
  ok(game.downsized(state, a.id));
  assert.equal(a.cash, 650);
  assert.equal(a.turnsSkipped, 2);
  ok(game.endTurn(state, a.id));
  ok(game.endTurn(state, a.id));
  assert.equal(a.turnsSkipped, 0);
  assert.equal(game.endTurn(state, a.id).ok, false);
});

test('not enough cash: fails with needLoan, rolls back; autoLoan takes the loan', () => {
  const { state, players: [a] } = setup(1);
  const res = game.downsized(state, a.id); // costs 1950, has 1550
  assert.equal(res.ok, false);
  assert.equal(res.needLoan, 1000);
  assert.equal(a.cash, 1550);
  assert.equal(a.turnsSkipped, 0);
  assert.equal(state.transactions.length, 1); // only setup

  ok(game.downsized(state, a.id, { autoLoan: true }));
  assert.equal(a.bankLoan, 1000);
  assert.equal(a.cash, 600);
  assert.equal(summary(state, a).totalExpenses, 2050);
});

test('negative payday needs a loan', () => {
  const { state, players: [a] } = setup(1);
  ok(game.takeLoan(state, a.id, { amount: 20000 })); // +2000/mo expenses → cash flow -950
  assert.equal(summary(state, a).monthlyCashFlow, -950);
  a.cash = 500;
  assert.equal(game.payday(state, a.id).needLoan, 1000);
  ok(game.payday(state, a.id, { autoLoan: true }));
  assert.equal(a.cash, 550);
  assert.equal(a.bankLoan, 21000);
});

test('loans: $1,000 units, repay needs cash and cannot exceed loan', () => {
  const { state, players: [a] } = setup(1);
  assert.equal(game.takeLoan(state, a.id, { amount: 1500 }).ok, false);
  ok(game.takeLoan(state, a.id, { amount: 3000 }));
  assert.equal(a.cash, 4550);
  assert.equal(game.repayLoan(state, a.id, { amount: 4000 }).ok, false);
  ok(game.repayLoan(state, a.id, { amount: 2000 }));
  assert.equal(a.bankLoan, 1000);
  assert.equal(a.cash, 2550);
});

test('pay off a liability removes its expense', () => {
  const { state, players: [a] } = setup(1);
  assert.equal(game.payOffLiability(state, a.id, { kind: 'schoolLoan' }).ok, false); // $0 owed
  assert.equal(game.payOffLiability(state, a.id, { kind: 'carLoan' }).ok, false); // 5000 > 1550 cash
  ok(game.payOffLiability(state, a.id, { kind: 'retail' }));
  assert.equal(a.cash, 550);
  assert.equal(summary(state, a).totalExpenses, 1900);
  assert.equal(game.payOffLiability(state, a.id, { kind: 'retail' }).ok, false);
});

// ---- assets ----

test('buy and sell stock, including partial sale', () => {
  const { state, players: [a] } = setup(1);
  ok(game.buyAsset(state, a.id, { type: 'stock', name: 'OK4U', shares: 100, price: 5 }));
  assert.equal(a.cash, 1050);
  const id = a.assets[0].id;
  ok(game.sellAsset(state, a.id, { assetId: id, price: 30, shares: 40 }));
  assert.equal(a.cash, 2250);
  assert.equal(a.assets[0].shares, 60);
  assert.equal(game.sellAsset(state, a.id, { assetId: id, price: 30, shares: 61 }).ok, false);
  ok(game.sellAsset(state, a.id, { assetId: id, price: 1 }));
  assert.equal(a.assets.length, 0);
  assert.equal(a.cash, 2310);
});

test('gold coins: bought per coin, no income, sold per coin, untouched by stock splits', () => {
  const { state, players: [a] } = setup(1);
  ok(game.buyAsset(state, a.id, { type: 'gold', shares: 2, price: 500 }));
  assert.equal(a.assets[0].name, 'Gold coins');
  assert.equal(a.cash, 550);
  assert.equal(summary(state, a).passiveIncome, 0);
  assert.equal(game.stockSplit(state, a.id, { name: 'Gold coins', kind: 'split' }).ok, false);
  assert.match(game.sellAsset(state, a.id, { assetId: a.assets[0].id, price: 4000, shares: 3 }).error, /2 coins/);
  ok(game.sellAsset(state, a.id, { assetId: a.assets[0].id, price: 4000, shares: 1 }));
  assert.equal(a.cash, 4550);
  assert.equal(a.assets[0].shares, 1);
});

test('stock dividends count as passive income', () => {
  const { state, players: [a] } = setup(1);
  ok(game.buyAsset(state, a.id, { type: 'stock', name: 'CD', shares: 10, price: 100, dividend: 2 }));
  assert.equal(summary(state, a).passiveIncome, 20);
});

test('buy and sell real estate: down payment, mortgage, cash flow, sale minus mortgage', () => {
  const { state, players: [a] } = setup(1);
  ok(game.buyAsset(state, a.id, { type: 'realEstate', name: '3Br/2Ba', cost: 65000, downPayment: 1000, cashFlow: 200 }));
  assert.equal(a.cash, 550);
  assert.equal(a.assets[0].mortgage, 64000);
  assert.equal(summary(state, a).passiveIncome, 200);
  assert.equal(game.buyAsset(state, a.id, { type: 'realEstate', name: 'X', cost: 100, downPayment: 200, cashFlow: 0 }).ok, false);
  ok(game.sellAsset(state, a.id, { assetId: a.assets[0].id, price: 90000 }));
  assert.equal(a.cash, 26550);
  assert.equal(summary(state, a).passiveIncome, 0);
});

test('selling real estate below the mortgage costs cash', () => {
  const { state, players: [a] } = setup(1);
  ok(game.buyAsset(state, a.id, { type: 'realEstate', name: 'Condo', cost: 50000, downPayment: 0, cashFlow: -100 }));
  ok(game.sellAsset(state, a.id, { assetId: a.assets[0].id, price: 49000 }));
  assert.equal(a.cash, 550);
});

test('business with no mortgage', () => {
  const { state, players: [a] } = setup(1);
  ok(game.buyAsset(state, a.id, { type: 'business', name: 'Car wash', cost: 1000, downPayment: 1000, cashFlow: 300 }));
  assert.equal(a.cash, 550);
  ok(game.sellAsset(state, a.id, { assetId: a.assets[0].id, price: 5000 }));
  assert.equal(a.cash, 5550);
});

test('stock split and reverse split hit every holder', () => {
  const { state, players: [a, b, c] } = setup(3);
  ok(game.buyAsset(state, a.id, { type: 'stock', name: 'MYT4U', shares: 100, price: 10 }));
  ok(game.buyAsset(state, b.id, { type: 'stock', name: 'myt4u', shares: 51, price: 10 }));
  ok(game.stockSplit(state, c.id, { name: 'MYT4U', kind: 'split' }));
  assert.equal(a.assets[0].shares, 200);
  assert.equal(b.assets[0].shares, 102);
  assert.equal(a.assets[0].costPerShare, 5);
  ok(game.stockSplit(state, c.id, { name: 'MYT4U', kind: 'reverse' }));
  assert.equal(a.assets[0].shares, 100);
  assert.equal(b.assets[0].shares, 51);
  assert.equal(game.stockSplit(state, c.id, { name: 'NOPE', kind: 'split' }).ok, false);
});

// ---- players & bank ----

test('pay players and bank; requests', () => {
  const { state, players: [a, b] } = setup(2);
  ok(game.pay(state, a.id, { toId: b.id, amount: 500 }));
  assert.equal(a.cash, 1050);
  assert.equal(b.cash, 2050);
  ok(game.pay(state, a.id, { toId: game.BANK, amount: 50 }));
  assert.equal(a.cash, 1000);
  assert.equal(game.pay(state, a.id, { toId: a.id, amount: 5 }).ok, false);
  ok(game.collect(state, a.id, { amount: 250 }));
  assert.equal(a.cash, 1250);

  const { request } = ok(game.requestMoney(state, a.id, { fromPlayerId: b.id, amount: 3000 }));
  const res = game.respondRequest(state, b.id, { requestId: request.id, accept: true });
  assert.equal(res.needLoan, 1000);
  assert.equal(state.pendingRequests.length, 1);
  ok(game.respondRequest(state, b.id, { requestId: request.id, accept: true, autoLoan: true }));
  assert.equal(state.pendingRequests.length, 0);
  assert.equal(a.cash, 4250);
  assert.equal(b.bankLoan, 1000);
});

// ---- Fast Track ----

test('escape, Fast Track ×100 income, win at +$50,000', () => {
  const { state, players: [a] } = setup(1);
  assert.equal(game.enterFastTrack(state, a.id).ok, false);
  ok(game.buyAsset(state, a.id, { type: 'business', name: 'Big biz', cost: 1000, downPayment: 1000, cashFlow: 2000 }));
  assert.equal(summary(state, a).canEscape, true);
  ok(game.enterFastTrack(state, a.id));
  assert.equal(a.stage, 'fastTrack');
  assert.equal(a.fastTrack.cashflowDayIncome, 200000);
  assert.equal(a.cash, 200000);
  assert.equal(game.payday(state, a.id).ok, false);

  ok(game.cashflowDay(state, a.id));
  assert.equal(a.cash, 400000);
  ok(game.fastTrackLoss(state, a.id, { kind: 'audit' }));
  assert.equal(a.cash, 200000);
  ok(game.buyFastTrackBusiness(state, a.id, { name: 'Pizza franchise', cost: 100000, cashFlow: 30000 }));
  assert.equal(a.stage, 'fastTrack');
  ok(game.buyFastTrackBusiness(state, a.id, { name: 'Software co', cost: 100000, cashFlow: 20000 }));
  assert.equal(a.stage, 'won');
});

test('Fast Track: no bank loans, divorce loses all cash, buying the dream wins', () => {
  const { state, players: [a] } = setup(1);
  ok(game.buyAsset(state, a.id, { type: 'business', name: 'Biz', cost: 1000, downPayment: 1000, cashFlow: 2000 }));
  ok(game.enterFastTrack(state, a.id));
  const r = game.buyFastTrackBusiness(state, a.id, { name: 'Huge', cost: 999999, cashFlow: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.needLoan, undefined);
  ok(game.fastTrackLoss(state, a.id, { kind: 'divorce' }));
  assert.equal(a.cash, 0);
  ok(game.cashflowDay(state, a.id));
  ok(game.buyDream(state, a.id, { name: 'Yacht', cost: 150000 }));
  assert.equal(a.stage, 'won');
});

// ---- undo ----

test('undo restores a sale exactly', () => {
  const { state, players: [a] } = setup(1);
  ok(game.buyAsset(state, a.id, { type: 'realEstate', name: 'House', cost: 50000, downPayment: 1000, cashFlow: 100 }));
  const before = structuredClone({ cash: a.cash, assets: a.assets });
  const { tx } = ok(game.sellAsset(state, a.id, { assetId: a.assets[0].id, price: 80000 }));
  ok(game.undo(state, a.id, { txId: tx.id }));
  assert.deepEqual({ cash: a.cash, assets: a.assets }, before);
  assert.equal(tx.undone, true);
  assert.equal(game.undo(state, a.id, { txId: tx.id }).ok, false);
});

test('undo: out-of-order is blocked; permissions; split undo restores all holders', () => {
  const { state, players: [host, b, c] } = setup(3);
  const t1 = ok(game.doodad(state, b.id, { amount: 100 })).tx;
  const t2 = ok(game.doodad(state, b.id, { amount: 200 })).tx;
  ok(game.doodad(state, c.id, { amount: 5 })); // other player doesn't block b
  assert.match(game.undo(state, b.id, { txId: t1.id }).error, /newer/);
  assert.equal(game.undo(state, c.id, { txId: t2.id }).ok, false); // not actor or host
  ok(game.undo(state, b.id, { txId: t2.id }));
  ok(game.undo(state, host.id, { txId: t1.id })); // host may, and t1 is now newest
  assert.equal(b.cash, 1550);

  ok(game.buyAsset(state, b.id, { type: 'stock', name: 'ON2U', shares: 10, price: 1 }));
  ok(game.buyAsset(state, c.id, { type: 'stock', name: 'ON2U', shares: 20, price: 1 }));
  const split = ok(game.stockSplit(state, host.id, { name: 'ON2U', kind: 'split' })).tx;
  ok(game.undo(state, host.id, { txId: split.id }));
  assert.equal(b.assets[0].shares, 10);
  assert.equal(c.assets[0].shares, 20);

  const pub = game.publicState(state);
  assert.equal('before' in pub.transactions[0], false);
});

// ---- host ----

test('host-only actions are rejected for non-hosts', () => {
  const { state, players: [, b] } = setup(2);
  for (const [name, payload] of [
    ['adjustCash', { playerId: b.id, delta: 100 }],
    ['kickPlayer', { playerId: b.id }],
    ['updateSettings', { loanUnit: 500 }],
    ['resetGame', {}],
    ['makeHost', { playerId: b.id }],
  ]) {
    assert.equal(game.actions[name](state, b.id, payload).ok, false, name);
  }
});

test('reset returns everyone to setup but keeps their profession card', () => {
  const { state, players: [host, b] } = setup(2);
  ok(game.buyAsset(state, b.id, { type: 'stock', name: 'X', shares: 1, price: 1 }));
  ok(game.adjustCash(state, host.id, { playerId: b.id, delta: -500 }));
  ok(game.resetGame(state, host.id));
  assert.equal(b.stage, 'setup');
  assert.equal(b.cash, 0);
  assert.equal(b.assets.length, 0);
  assert.equal(b.profession.title, 'Engineer');
  assert.equal(state.transactions.length, 0);
});
