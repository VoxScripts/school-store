import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import path from 'path';
import morgan from 'morgan';
import fs from 'fs';
import ejsMate from 'ejs-mate'; // layout engine

const app = express();
const PORT = process.env.PORT || 3000;

// --- View Engine Setup ---
app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

// --- DB Init ---
const dbFile = path.join(process.cwd(), 'db', 'store.db');
const firstRun = !fs.existsSync(dbFile);
const db = new Database(dbFile);

db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price REAL NOT NULL,
  image_url TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_class TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','card')),
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','cancelled')),
  total_amount REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  name TEXT NOT NULL,
  unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal REAL NOT NULL
);
`);

if (firstRun) {
  const seed = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'db', 'seed.json'), 'utf-8'));
  const ins = db.prepare('INSERT INTO products (name,description,price,image_url,active) VALUES (?,?,?,?,1)');
  const tx = db.transaction((rows) => {
    for (const r of rows) ins.run(r.name, r.description, r.price, r.image_url);
  });
  tx(seed.products);
  console.log('Seeded demo products.');
}

// --- Middleware ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));
app.use(express.static(path.join(process.cwd(), 'public')));

// 🔥 Persistent 30-day cookie to keep cart saved
app.use(
  session({
    secret: 'school-store-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      sameSite: 'lax',
      secure: false // change to true ON RENDER (HTTPS)
    }
  })
);

// Default locals (layout-safe)
app.use((req, res, next) => {
  res.locals.title = 'School Store';
  res.locals.cart = req.session.cart || [];
  next();
});

// --- Helpers ---
function ensureAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  return res.redirect('/admin/login');
}
function fmtMoney(n) {
  return Number(n).toFixed(2);
}
function getCart(req) {
  if (!req.session.cart) req.session.cart = [];
  return req.session.cart;
}
function cartTotal(cart) {
  return cart.reduce((s, i) => s + i.price * i.qty, 0);
}

// --- Public Routes ---
app.get('/', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE active=1 ORDER BY id DESC').all();
  res.render('home', { products, cart: getCart(req) });
});

// Add to cart
app.post('/cart/add', (req, res) => {
  const { id } = req.body;
  const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id);
  if (!p) {
    if (req.accepts('json')) return res.status(404).json({ ok: false });
    return res.redirect('/');
  }
  const cart = getCart(req);
  const existing = cart.find((i) => i.id === p.id);
  if (existing) existing.qty += 1;
  else cart.push({ id: p.id, name: p.name, price: p.price, image_url: p.image_url, qty: 1 });

  if (req.accepts('json')) {
    const count = cart.reduce((s, i) => s + i.qty, 0);
    return res.json({ ok: true, count });
  }

  res.redirect('/cart');
});

app.get('/cart', (req, res) => {
  res.render('cart', { cart: getCart(req) });
});

app.post('/cart/update', (req, res) => {
  const cart = getCart(req);
  const { id, qty } = req.body;
  const item = cart.find((i) => i.id == id);
  if (item) {
    const q = Math.max(0, parseInt(qty || '0', 10));
    if (q === 0) req.session.cart = cart.filter((i) => i.id != id);
    else item.qty = q;
  }
  res.redirect('/cart');
});

app.post('/cart/clear', (req, res) => {
  req.session.cart = [];
  res.redirect('/cart');
});

app.get('/checkout', (req, res) => {
  const cart = getCart(req);
  if (cart.length === 0) return res.redirect('/');
  const total = cartTotal(cart);
  res.render('checkout', { cart, total, fmtMoney });
});

app.post('/checkout', (req, res) => {
  const cart = getCart(req);
  if (cart.length === 0) return res.redirect('/');
  const { customer_name, customer_phone, customer_class, payment_method } = req.body;

  if (!customer_name || !customer_phone || !customer_class || !payment_method) {
    return res.redirect('/checkout');
  }

  const total = cartTotal(cart);
  const insOrder = db.prepare(
    `INSERT INTO orders
    (customer_name, customer_phone, customer_class, payment_method, status, total_amount)
    VALUES (?,?,?,?, 'unpaid', ?)`
  );
  const result = insOrder.run(customer_name, customer_phone, customer_class, payment_method, total);
  const orderId = result.lastInsertRowid;

  const insItem = db.prepare(
    'INSERT INTO order_items (order_id, product_id, name, unit_price, quantity, subtotal) VALUES (?,?,?,?,?,?)'
  );
  const tx = db.transaction((items) => {
    for (const i of items) {
      insItem.run(orderId, i.id, i.name, i.price, i.qty, i.price * i.qty);
    }
  });
  tx(cart);

  req.session.cart = [];

  if (payment_method === 'cash') {
    return res.redirect(`/order/placed/${orderId}`);
  } else {
    const base = process.env.ZIINA_BASE_URL || '';
    const url = base ? `${base}?amount=${fmtMoney(total)}` : `/order/placed/${orderId}`;
    return res.render('redirect-card', { url, total, fmtMoney });
  }
});

app.get('/order/placed/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.redirect('/');
  res.render('order-placed', { order, shaikh: process.env.SCHOOL_SHAIKH_NAME || 'Shaikh' });
});

// --- Admin Auth ---
app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin-login', { error: 'Invalid credentials' });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --- Admin Dashboard ---
app.get('/admin', ensureAdmin, (req, res) => {
  const productCount = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  const orderCount = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const unpaid = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='unpaid'").get().c;
  res.render('admin-dashboard', { productCount, orderCount, unpaid });
});

// --- Products CRUD ---
app.get('/admin/items', ensureAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  res.render('admin-items', { rows });
});
app.get('/admin/items/new', ensureAdmin, (req, res) => {
  res.render('admin-item-form', { item: null });
});
app.post('/admin/items', ensureAdmin, (req, res) => {
  const { name, description, price, image_url } = req.body;
  db.prepare('INSERT INTO products (name,description,price,image_url,active) VALUES (?,?,?,?,1)').run(
    name,
    description || '',
    parseFloat(price || '0'),
    image_url || ''
  );
  res.redirect('/admin/items');
});
app.get('/admin/items/:id/edit', ensureAdmin, (req, res) => {
  const item = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!item) return res.redirect('/admin/items');
  res.render('admin-item-form', { item });
});
app.post('/admin/items/:id/update', ensureAdmin, (req, res) => {
  const { name, description, price, image_url } = req.body;
  db.prepare('UPDATE products SET name=?, description=?, price=?, image_url=? WHERE id=?').run(
    name,
    description || '',
    parseFloat(price || '0'),
    image_url || '',
    req.params.id
  );
  res.redirect('/admin/items');
});
app.post('/admin/items/:id/toggle-active', ensureAdmin, (req, res) => {
  const row = db.prepare('SELECT active FROM products WHERE id=?').get(req.params.id);
  if (row) db.prepare('UPDATE products SET active=? WHERE id=?').run(row.active ? 0 : 1, req.params.id);
  res.redirect('/admin/items');
});

// --- Orders ---
app.get('/admin/orders', ensureAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  res.render('admin-orders', { rows, fmtMoney });
});
app.get('/admin/orders/:id', ensureAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.redirect('/admin/orders');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  res.render('admin-order-detail', { order, items, fmtMoney });
});

// Toggle Paid/Unpaid (with page reload)
app.post('/admin/orders/:id/toggle-paid', ensureAdmin, (req, res) => {
  const order = db.prepare('SELECT status FROM orders WHERE id=?').get(req.params.id);
  if (order) {
    const next = order.status === 'paid' ? 'unpaid' : 'paid';
    db.prepare('UPDATE orders SET status=? WHERE id=?').run(next, req.params.id);
  }
  res.redirect(`/admin/orders/${req.params.id}`);
});

app.post('/admin/orders/:id/mark-cancelled', ensureAdmin, (req, res) => {
  db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(req.params.id);
  res.redirect(`/admin/orders/${req.params.id}`);
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`School Store running on http://localhost:${PORT}`);
});
