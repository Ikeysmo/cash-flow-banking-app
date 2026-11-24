'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/statement');

const player = (over = {}) => ({
  profession: {
    salary: 3000, perChildExpense: 200, savings: 500,
    expenses: { taxes: 600, homeMortgage: 400, schoolLoan: 0, carLoan: 100, creditCard: 100, retail: 50, other: 700 },
    liabilities: { homeMortgage: 40000, schoolLoan: 0, carLoan: 5000, creditCard: 3000, retail: 1000 },
  },
  paidOff: {}, bankLoan: 0, children: 0, assets: [],
  ...over,
});

test('base income, expenses and cash flow', () => {
  const s = S.summarize(player());
  assert.equal(s.totalIncome, 3000);
  assert.equal(s.totalExpenses, 1950);
  assert.equal(s.monthlyCashFlow, 1050);
  assert.equal(s.canEscape, false);
});

test('children, bank loan interest and paid-off liabilities change expenses', () => {
  assert.equal(S.summarize(player({ children: 2 })).totalExpenses, 2350);
  assert.equal(S.summarize(player({ bankLoan: 3000 })).totalExpenses, 2250);
  assert.equal(S.summarize(player({ bankLoan: 3000 }), { ...S.DEFAULT_SETTINGS, loanRatePercent: 5 }).totalExpenses, 2100);
  assert.equal(S.summarize(player({ paidOff: { carLoan: true } })).totalExpenses, 1850);
});

test('passive income from real estate, business and stock dividends', () => {
  const p = player({ assets: [
    { type: 'realEstate', cashFlow: 200 },
    { type: 'business', cashFlow: -50 },
    { type: 'stock', shares: 100, dividend: 0.5 },
  ] });
  const s = S.summarize(p);
  assert.equal(s.passiveIncome, 200);
  assert.equal(s.totalIncome, 3200);
});

test('escape when passive income exceeds total expenses (strictly)', () => {
  assert.equal(S.summarize(player({ assets: [{ type: 'business', cashFlow: 1950 }] })).canEscape, false);
  assert.equal(S.summarize(player({ assets: [{ type: 'business', cashFlow: 1951 }] })).canEscape, true);
  assert.equal(S.summarize({ assets: [] }).canEscape, false); // no profession yet
});
