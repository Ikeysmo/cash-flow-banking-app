'use strict';

// The 12 CASHFLOW 101 profession cards. Field names match the setup form
// (see EXPENSE_LINES / LIABILITY_LINES in src/statement.js).
// Source: github.com/k1ny-github/cashflow-101 (professions.js). Its author
// checked Doctor and Nurse against photos of the physical cards; the rest
// agree with an independent dataset on salary and loan balances.
// Players can still edit every number before starting if their edition differs.
window.PROFESSIONS = [
  { title: 'Doctor', salary: 13200, savings: 400, perChildExpense: 640,
    expenses: { taxes: 3420, homeMortgage: 1900, schoolLoan: 750, carLoan: 380, creditCard: 270, retail: 50, other: 2880 },
    liabilities: { homeMortgage: 202000, schoolLoan: 150000, carLoan: 19000, creditCard: 9000, retail: 1000 } },
  { title: 'Airline Pilot', salary: 9500, savings: 400, perChildExpense: 480,
    expenses: { taxes: 2350, homeMortgage: 1330, schoolLoan: 0, carLoan: 300, creditCard: 660, retail: 50, other: 2210 },
    liabilities: { homeMortgage: 143000, schoolLoan: 0, carLoan: 15000, creditCard: 22000, retail: 1000 } },
  { title: 'Lawyer', salary: 7500, savings: 400, perChildExpense: 380,
    expenses: { taxes: 1830, homeMortgage: 1100, schoolLoan: 390, carLoan: 220, creditCard: 180, retail: 50, other: 1650 },
    liabilities: { homeMortgage: 115000, schoolLoan: 78000, carLoan: 11000, creditCard: 6000, retail: 1000 } },
  { title: 'Engineer', salary: 4900, savings: 400, perChildExpense: 250,
    expenses: { taxes: 1050, homeMortgage: 700, schoolLoan: 60, carLoan: 140, creditCard: 120, retail: 50, other: 1090 },
    liabilities: { homeMortgage: 75000, schoolLoan: 12000, carLoan: 7000, creditCard: 4000, retail: 1000 } },
  { title: 'Business Manager', salary: 4600, savings: 400, perChildExpense: 240,
    expenses: { taxes: 910, homeMortgage: 700, schoolLoan: 60, carLoan: 120, creditCard: 90, retail: 50, other: 1000 },
    liabilities: { homeMortgage: 75000, schoolLoan: 12000, carLoan: 6000, creditCard: 3000, retail: 1000 } },
  { title: 'Teacher', salary: 3300, savings: 400, perChildExpense: 180,
    expenses: { taxes: 630, homeMortgage: 500, schoolLoan: 60, carLoan: 100, creditCard: 90, retail: 50, other: 760 },
    liabilities: { homeMortgage: 50000, schoolLoan: 12000, carLoan: 5000, creditCard: 3000, retail: 1000 } },
  { title: 'Nurse', salary: 3100, savings: 480, perChildExpense: 170,
    expenses: { taxes: 600, homeMortgage: 400, schoolLoan: 30, carLoan: 100, creditCard: 90, retail: 50, other: 710 },
    liabilities: { homeMortgage: 47000, schoolLoan: 6000, carLoan: 5000, creditCard: 3000, retail: 1000 } },
  { title: 'Police Officer', salary: 3000, savings: 520, perChildExpense: 160,
    expenses: { taxes: 580, homeMortgage: 400, schoolLoan: 0, carLoan: 100, creditCard: 60, retail: 50, other: 690 },
    liabilities: { homeMortgage: 46000, schoolLoan: 0, carLoan: 5000, creditCard: 2000, retail: 1000 } },
  { title: 'Truck Driver', salary: 2500, savings: 750, perChildExpense: 140,
    expenses: { taxes: 460, homeMortgage: 400, schoolLoan: 0, carLoan: 80, creditCard: 60, retail: 50, other: 570 },
    liabilities: { homeMortgage: 38000, schoolLoan: 0, carLoan: 4000, creditCard: 2000, retail: 1000 } },
  { title: 'Secretary', salary: 2500, savings: 710, perChildExpense: 140,
    expenses: { taxes: 460, homeMortgage: 400, schoolLoan: 0, carLoan: 80, creditCard: 60, retail: 50, other: 570 },
    liabilities: { homeMortgage: 38000, schoolLoan: 0, carLoan: 4000, creditCard: 2000, retail: 1000 } },
  { title: 'Mechanic', salary: 2000, savings: 670, perChildExpense: 110,
    expenses: { taxes: 360, homeMortgage: 300, schoolLoan: 0, carLoan: 60, creditCard: 60, retail: 50, other: 450 },
    liabilities: { homeMortgage: 31000, schoolLoan: 0, carLoan: 3000, creditCard: 2000, retail: 1000 } },
  { title: 'Janitor', salary: 1600, savings: 560, perChildExpense: 70,
    expenses: { taxes: 280, homeMortgage: 200, schoolLoan: 0, carLoan: 60, creditCard: 60, retail: 50, other: 300 },
    liabilities: { homeMortgage: 20000, schoolLoan: 0, carLoan: 4000, creditCard: 2000, retail: 1000 } },
];
