# Bheemaiah Personal Expense Tracker Management System

A responsive full-stack personal finance tracker built with HTML, CSS, vanilla JavaScript, Express.js and MySQL.

## Features
- User registration and login (passwords hashed with bcrypt)
- Dashboard with income, expense, balance and monthly summaries
- Create, edit, delete and filter transactions
- User-defined income and expense categories
- Monthly category budgets with spending progress
- Annual income and expense reports with charts
- Responsive layout for desktop and mobile
- Per-user data access enforced by authenticated API routes

## Tech stack
- Frontend: HTML5, CSS3, JavaScript, Chart.js
- Backend: Node.js, Express.js
- Database: MySQL 8+
- Authentication: JWT and bcryptjs

## Requirements
- Node.js 18+
- MySQL 8+ and MySQL Workbench

## Setup
1. Clone this repository:
   ```bash
   git clone https://github.com/bheemaiah1018/Bheemaiah-Personal-Expense-Tracker.git
   cd Bheemaiah-Personal-Expense-Tracker
   ```
2. Run `db/schema.sql` in MySQL Workbench.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Copy `.env.example` to `.env` and update the MySQL credentials. Set `JWT_SECRET` to a long random value.
5. Start the server:
   ```bash
   npm start
   ```
6. Open http://localhost:3000.

## Database
The SQL script creates `bheemaiah_expense_tracker` and the following tables:
- `users`
- `categories`
- `transactions`
- `budgets`

Each new account receives starter income and expense categories automatically.

## Project structure
```
.
├── db/
│   └── schema.sql
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── .env.example
├── .gitignore
├── package.json
├── server.js
└── README.md
```

## Notes
- Never commit your real `.env` file or database credentials.
- The included Chart.js and icon assets are loaded from public CDNs, so an internet connection is needed for those visual assets.
- This is an educational mini-project. Use HTTPS and a production secrets manager before public deployment.
