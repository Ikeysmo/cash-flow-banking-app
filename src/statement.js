'use strict';

// Derived financial-statement numbers. Pure functions, shared by the server
// (require) and the browser (served at /statement.js, exposes window.Statement).
(function (root) {
  const EXPENSE_LINES = [
    ['taxes', 'Taxes'],
    ['homeMortgage', 'Home mortgage payment'],
    ['schoolLoan', 'School loan payment'],
    ['carLoan', 'Car loan payment'],
    ['creditCard', 'Credit card payment'],
    ['retail', 'Retail payment'],
    ['other', 'Other expenses'],
  ];

  const LIABILITY_LINES = [
    ['homeMortgage', 'Home mortgage'],
    ['schoolLoan', 'School loans'],
    ['carLoan', 'Car loans'],
    ['creditCard', 'Credit cards'],
    ['retail', 'Retail debt'],
  ];

  const DEFAULT_SETTINGS = { startWithPayday: true, loanUnit: 1000, loanRatePercent: 10 };

  function assetIncome(asset) {
    if (asset.type === 'stock') return Math.round((asset.shares || 0) * (asset.dividend || 0));
    return asset.cashFlow || 0;
  }

  function passiveIncome(player) {
    return (player.assets || []).reduce((sum, a) => sum + assetIncome(a), 0);
  }

  function loanPayment(player, settings = DEFAULT_SETTINGS) {
    return Math.round(((player.bankLoan || 0) * settings.loanRatePercent) / 100);
  }

  // Every expense line with its current amount (paid-off liabilities drop to $0).
  function expenseLines(player, settings = DEFAULT_SETTINGS) {
    const prof = player.profession;
    if (!prof) return [];
    const paidOff = player.paidOff || {};
    const lines = EXPENSE_LINES.map(([key, label]) => ({
      key, label, amount: paidOff[key] ? 0 : (prof.expenses[key] || 0), paidOff: !!paidOff[key],
    }));
    lines.push({ key: 'children', label: `Children (${player.children || 0} × $${prof.perChildExpense || 0})`, amount: (player.children || 0) * (prof.perChildExpense || 0) });
    lines.push({ key: 'bankLoan', label: 'Bank loan payment', amount: loanPayment(player, settings) });
    return lines;
  }

  function summarize(player, settings = DEFAULT_SETTINGS) {
    const salary = player.profession ? player.profession.salary || 0 : 0;
    const passive = passiveIncome(player);
    const totalIncome = salary + passive;
    const totalExpenses = expenseLines(player, settings).reduce((s, l) => s + l.amount, 0);
    return {
      salary,
      passiveIncome: passive,
      totalIncome,
      totalExpenses,
      monthlyCashFlow: totalIncome - totalExpenses,
      canEscape: !!player.profession && passive > totalExpenses,
    };
  }

  const api = { EXPENSE_LINES, LIABILITY_LINES, DEFAULT_SETTINGS, assetIncome, passiveIncome, loanPayment, expenseLines, summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Statement = api;
})(typeof window !== 'undefined' ? window : globalThis);
