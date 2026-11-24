# Cashflow Banking App

A real-time banker and financial-statement tracker for a physical game of Cashflow 101. One computer on your Wi-Fi runs the server, and up to 6 players open its URL on their phones. The app works out income, expenses, cash flow and Paydays for you.

> **Vibecoded.** This whole project was vibecoded with [Claude Code](https://claude.com/claude-code). I described what I wanted and the AI wrote it all: the code, the tests and this README.

## Features

**Setup**
- **Pick your profession** from the 12 standard cards (swipe through them), or type in the numbers from your own card. A live preview shows your cash flow and starting cash (savings + one Payday).

**Rat Race**: actions are grouped by the board square you land on.
- **Payday** collects your monthly cash flow.
- **Deal**: buy stocks (OK4U, ON2U, MYT4U, GRO4US, or any symbol you type), gold coins, real estate or a business. The app works out the mortgage and the change to your passive income.
- **Market**: sell anything you own, or apply a stock split or reverse split to everyone holding that stock.
- **Doodad**: pay for one.
- **Life event**: Charity (10% of income, with a "2 dice for 3 turns" reminder), Baby (up to 3) or Downsized (pay your expenses and skip 2 turns).
- **Bank loans** in $1,000 units at 10% a month. When you can't afford something, the app offers the loan you'd need.
- **Money**: pay a player or the Bank, request money from a player, or collect from the Bank.
- **Pay off** a liability from your statement, which removes its monthly payment.

**Statement**
- Income, expenses, assets and liabilities, on their own page you swipe to. On wide screens it sits next to the main screen.
- A progress bar compares passive income with expenses. When passive income is bigger, an **Enter the Fast Track** button appears.

**Fast Track**
- CASHFLOW Day income starts at 100× your passive income.
- Buy Fast Track businesses, handle Tax Audit, Lawsuit and Divorce, and win by growing your CASHFLOW Day income by $50,000 or by buying your Dream.

**Everywhere**
- **Undo** any action, including sales and splits. Each action saves the affected statements first, so undo puts them back exactly.
- **History** shows the newest 5 actions, and you scroll up for older ones.
- **Host controls**: loan settings, edit anyone's profession card, adjust cash, remove a player, hand over host, reset the game.
- **Rejoining and saved game**: players get back in after a refresh, and the game is saved to `data/game.json`.

## Running it

Needs [Node.js](https://nodejs.org/) 18 or later.

```bash
npm install
npm start
```

The server prints the address to open, for example `http://192.168.0.11:3001`. It uses port 3001, so it can run alongside the Monopoly app on 3000. Open the address on each phone on the same Wi-Fi.

If phones can't connect, your firewall is probably blocking the port. On Fedora:

```bash
sudo firewall-cmd --add-port=3001/tcp --permanent && sudo firewall-cmd --reload
```

Other commands:

- `npm run dev`: restarts the server automatically when you edit code
- `npm test`: runs the unit tests

## Things to check against your edition

- **Profession numbers** in `public/professions.js` come from the open-source [k1ny-github/cashflow-101](https://github.com/k1ny-github/cashflow-101) project. Its author checked Doctor and Nurse against photos of real cards. Check the others against yours; every number can be edited before you start.
- **Fast Track losses** are set to half your cash for Tax Audit and Lawsuit, and all of it for Divorce. Change `LOSSES` in `src/game.js` if your edition differs.
- **Entering the Fast Track** replaces your cash with your new CASHFLOW Day income.

## How it's built

- `server.js`: Express and Socket.IO. Each player is identified by a secret stored on their phone.
- `src/statement.js`: income, expenses and cash-flow maths, shared by the server and the browser
- `src/game.js`: all the game actions as plain functions, which makes them easy to test
- `src/store.js`: saves the game to a JSON file
- `public/`: the phone screens, in plain HTML, CSS and JavaScript with no build step
- `test/`: unit tests using Node's built-in test runner

---

This is an unofficial fan project. It isn't affiliated with or endorsed by the makers of CASHFLOW; CASHFLOW is a trademark of its respective owner.
