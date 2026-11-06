require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 40 }));

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'bheemaiah_expense_tracker',
  waitForConnections: true, connectionLimit: 10, decimalNumbers: true
});
const SECRET = process.env.JWT_SECRET || 'development_only_change_this_secret';
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Please log in to continue.' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { return res.status(401).json({ message: 'Session expired. Please log in again.' }); }
};
const validType = t => t === 'income' || t === 'expense';

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || name.trim().length < 2 || name.length > 50 || !email || !/^\S+@\S+\.\S+$/.test(email) || !password || password.length < 8)
    return res.status(400).json({ message: 'Enter a name, valid email and password (at least 8 characters).' });
  const hash = await bcrypt.hash(password, 12);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [u] = await conn.execute('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)', [name.trim(), email.toLowerCase().trim(), hash]);
    const defaults = [['Salary','income'],['Freelance','income'],['Investment','income'],['Food','expense'],['Transport','expense'],['Shopping','expense'],['Bills','expense'],['Health','expense'],['Entertainment','expense'],['Other','expense']];
    for (const c of defaults) await conn.execute('INSERT INTO categories(user_id,category_name,category_type) VALUES(?,?,?)', [u.insertId, ...c]);
    await conn.commit();
    const token = jwt.sign({ user_id: u.insertId, name: name.trim(), email: email.toLowerCase().trim() }, SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { user_id: u.insertId, name: name.trim(), email: email.toLowerCase().trim() } });
  } catch (e) { await conn.rollback(); if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'An account with this email already exists.' }); throw e; }
  finally { conn.release(); }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await pool.execute('SELECT * FROM users WHERE email=?', [(email || '').toLowerCase().trim()]);
  if (!rows.length || !(await bcrypt.compare(password || '', rows[0].password_hash))) return res.status(401).json({ message: 'Incorrect email or password.' });
  const u = rows[0]; const token = jwt.sign({ user_id: u.user_id, name: u.name, email: u.email }, SECRET, { expiresIn: '7d' });
  res.json({ token, user: { user_id: u.user_id, name: u.name, email: u.email } });
}));

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

app.get('/api/categories', auth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT category_id,category_name,category_type FROM categories WHERE user_id=? ORDER BY category_type,category_name', [req.user.user_id]);
  res.json(rows);
}));
app.post('/api/categories', auth, asyncRoute(async (req, res) => {
  const { category_name, category_type } = req.body;
  if (!category_name || category_name.trim().length > 100 || !validType(category_type)) return res.status(400).json({ message: 'Enter a category name and valid type.' });
  try {
    const [r] = await pool.execute('INSERT INTO categories(user_id,category_name,category_type) VALUES(?,?,?)', [req.user.user_id, category_name.trim(), category_type]);
    res.status(201).json({ category_id: r.insertId, category_name: category_name.trim(), category_type });
  } catch (e) { if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'That category already exists.' }); throw e; }
}));
app.delete('/api/categories/:id', auth, asyncRoute(async (req, res) => {
  const [r] = await pool.execute('DELETE FROM categories WHERE category_id=? AND user_id=?', [req.params.id, req.user.user_id]);
  if (!r.affectedRows) return res.status(404).json({ message: 'Category not found.' });
  res.json({ message: 'Category deleted.' });
}));

app.get('/api/transactions', auth, asyncRoute(async (req, res) => {
  const { month, year, type } = req.query; let sql = `SELECT t.transaction_id,t.amount,t.transaction_type,t.description,t.transaction_date,c.category_id,c.category_name FROM transactions t JOIN categories c ON c.category_id=t.category_id WHERE t.user_id=?`;
  const p = [req.user.user_id];
  if (month && year) { sql += ' AND MONTH(t.transaction_date)=? AND YEAR(t.transaction_date)=?'; p.push(Number(month), Number(year)); }
  if (validType(type)) { sql += ' AND t.transaction_type=?'; p.push(type); }
  sql += ' ORDER BY t.transaction_date DESC,t.transaction_id DESC';
  const [rows] = await pool.execute(sql, p); res.json(rows);
}));
app.post('/api/transactions', auth, asyncRoute(async (req, res) => {
  const { category_id, amount, transaction_type, description = '', transaction_date } = req.body;
  if (!validType(transaction_type) || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > 99999999.99 || !category_id || !/^\d{4}-\d{2}-\d{2}$/.test(transaction_date || '') || description.length > 255)
    return res.status(400).json({ message: 'Please provide valid transaction details.' });
  const [cats] = await pool.execute('SELECT category_id FROM categories WHERE category_id=? AND user_id=? AND category_type=?', [category_id, req.user.user_id, transaction_type]);
  if (!cats.length) return res.status(400).json({ message: 'Choose a category matching the transaction type.' });
  const [r] = await pool.execute('INSERT INTO transactions(user_id,category_id,amount,transaction_type,description,transaction_date) VALUES(?,?,?,?,?,?)', [req.user.user_id, category_id, Number(amount), transaction_type, description.trim(), transaction_date]);
  res.status(201).json({ transaction_id: r.insertId, message: 'Transaction added.' });
}));
app.put('/api/transactions/:id', auth, asyncRoute(async (req, res) => {
  const { category_id, amount, transaction_type, description = '', transaction_date } = req.body;
  if (!validType(transaction_type) || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || !category_id || !/^\d{4}-\d{2}-\d{2}$/.test(transaction_date || '') || description.length > 255) return res.status(400).json({ message: 'Invalid transaction details.' });
  const [cats] = await pool.execute('SELECT category_id FROM categories WHERE category_id=? AND user_id=? AND category_type=?', [category_id, req.user.user_id, transaction_type]);
  if (!cats.length) return res.status(400).json({ message: 'Choose a matching category.' });
  const [r] = await pool.execute('UPDATE transactions SET category_id=?,amount=?,transaction_type=?,description=?,transaction_date=? WHERE transaction_id=? AND user_id=?', [category_id, Number(amount), transaction_type, description.trim(), transaction_date, req.params.id, req.user.user_id]);
  if (!r.affectedRows) return res.status(404).json({ message: 'Transaction not found.' }); res.json({ message: 'Transaction updated.' });
}));
app.delete('/api/transactions/:id', auth, asyncRoute(async (req, res) => {
  const [r] = await pool.execute('DELETE FROM transactions WHERE transaction_id=? AND user_id=?', [req.params.id, req.user.user_id]);
  if (!r.affectedRows) return res.status(404).json({ message: 'Transaction not found.' }); res.json({ message: 'Transaction deleted.' });
}));

app.get('/api/budgets', auth, asyncRoute(async (req, res) => {
  const month = Number(req.query.month) || new Date().getMonth() + 1, year = Number(req.query.year) || new Date().getFullYear();
  const [rows] = await pool.execute(`SELECT b.budget_id,b.category_id,c.category_name,b.monthly_limit,b.month,b.year,COALESCE(SUM(t.amount),0) AS spent FROM budgets b JOIN categories c ON c.category_id=b.category_id LEFT JOIN transactions t ON t.category_id=b.category_id AND t.user_id=b.user_id AND t.transaction_type='expense' AND MONTH(t.transaction_date)=b.month AND YEAR(t.transaction_date)=b.year WHERE b.user_id=? AND b.month=? AND b.year=? GROUP BY b.budget_id,c.category_name ORDER BY c.category_name`, [req.user.user_id, month, year]);
  res.json(rows);
}));
app.post('/api/budgets', auth, asyncRoute(async (req, res) => {
  const { category_id, monthly_limit, month, year } = req.body;
  if (!category_id || !Number.isFinite(Number(monthly_limit)) || Number(monthly_limit) <= 0 || !Number.isInteger(Number(month)) || month < 1 || month > 12 || !Number.isInteger(Number(year)) || year < 2000 || year > 2200) return res.status(400).json({ message: 'Enter a valid category, limit, month and year.' });
  const [cats] = await pool.execute("SELECT category_id FROM categories WHERE category_id=? AND user_id=? AND category_type='expense'", [category_id, req.user.user_id]);
  if (!cats.length) return res.status(400).json({ message: 'Budgets can only be set for your expense categories.' });
  await pool.execute('INSERT INTO budgets(user_id,category_id,monthly_limit,month,year) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE monthly_limit=VALUES(monthly_limit)', [req.user.user_id, category_id, Number(monthly_limit), Number(month), Number(year)]);
  res.status(201).json({ message: 'Budget saved.' });
}));
app.delete('/api/budgets/:id', auth, asyncRoute(async (req, res) => {
  const [r] = await pool.execute('DELETE FROM budgets WHERE budget_id=? AND user_id=?', [req.params.id, req.user.user_id]);
  if (!r.affectedRows) return res.status(404).json({ message: 'Budget not found.' }); res.json({ message: 'Budget deleted.' });
}));

app.get('/api/dashboard', auth, asyncRoute(async (req, res) => {
  const month = Number(req.query.month) || new Date().getMonth() + 1, year = Number(req.query.year) || new Date().getFullYear(), uid = req.user.user_id;
  const [[totals]] = await pool.execute(`SELECT COALESCE(SUM(CASE WHEN transaction_type='income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN transaction_type='expense' THEN amount ELSE 0 END),0) expenses FROM transactions WHERE user_id=? AND MONTH(transaction_date)=? AND YEAR(transaction_date)=?`, [uid, month, year]);
  const [trend] = await pool.execute(`SELECT DATE_FORMAT(transaction_date,'%Y-%m-%d') day, SUM(CASE WHEN transaction_type='income' THEN amount ELSE 0 END) income, SUM(CASE WHEN transaction_type='expense' THEN amount ELSE 0 END) expenses FROM transactions WHERE user_id=? AND transaction_date >= DATE_SUB(CURDATE(),INTERVAL 6 DAY) AND transaction_date <= CURDATE() GROUP BY day ORDER BY day`, [uid]);
  const [breakdown] = await pool.execute(`SELECT c.category_name, SUM(t.amount) total FROM transactions t JOIN categories c ON c.category_id=t.category_id WHERE t.user_id=? AND t.transaction_type='expense' AND MONTH(t.transaction_date)=? AND YEAR(t.transaction_date)=? GROUP BY c.category_id,c.category_name ORDER BY total DESC`, [uid, month, year]);
  const [recent] = await pool.execute(`SELECT t.transaction_id,t.amount,t.transaction_type,t.description,t.transaction_date,c.category_name FROM transactions t JOIN categories c ON c.category_id=t.category_id WHERE t.user_id=? ORDER BY t.transaction_date DESC,t.transaction_id DESC LIMIT 6`, [uid]);
  res.json({ totals, trend, breakdown, recent, balance: Number(totals.income) - Number(totals.expenses) });
}));

app.get('/api/reports', auth, asyncRoute(async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const [monthly] = await pool.execute(`SELECT MONTH(transaction_date) month, SUM(CASE WHEN transaction_type='income' THEN amount ELSE 0 END) income, SUM(CASE WHEN transaction_type='expense' THEN amount ELSE 0 END) expenses FROM transactions WHERE user_id=? AND YEAR(transaction_date)=? GROUP BY MONTH(transaction_date) ORDER BY month`, [req.user.user_id, year]);
  res.json({ year, monthly });
}));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ message: 'Something went wrong. Check the server and database configuration.' }); });
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Bheemaiah Expense Tracker running at http://localhost:${port}`));
