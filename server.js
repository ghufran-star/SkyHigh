const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.APP_SECRET || 'skyhigh-shared';
const STATUSES = ['new', 'no_answer', 'callback', 'wa_dropped', 'positive', 'meeting_set', 'meeting_done', 'rejected', 'wrong_number'];

const tokenFor = (p) => crypto.createHmac('sha256', SECRET).update('skyhigh:' + p).digest('hex');
const VALID_TOKEN = PASSWORD ? tokenFor(PASSWORD) : 'open';
const safeEq = (a, b) => {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const rank = (v) => {
  const n = parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 && n < 1e6 ? n : null;
};
const phone = (v) => {
  const s = String(v == null ? '' : v).trim();
  const digits = s.replace(/\D/g, '');
  return digits.length >= 6 ? (s.startsWith('+') || digits.length > 10 ? '+' : '') + digits : '';
};
const status = (v) => (STATUSES.includes(v) ? v : 'new');
const who = (req) => {
  let u = req.get('x-user') || '';
  try { u = decodeURIComponent(u); } catch { /* keep raw */ }
  return str(u, 40) || 'Someone';
};

function cleanNew(c, by) {
  return {
    id: /^[\w-]{6,64}$/.test(c?.id || '') ? c.id : crypto.randomUUID(),
    agency: str(c?.agency, 200),
    rank: rank(c?.rank),
    owner: str(c?.owner, 120),
    phone: phone(c?.phone),
    status: status(c?.status),
    notes: str(c?.notes, 5000),
    addedBy: str(c?.addedBy, 40) || by,
  };
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, store: db.kind }));

app.post('/api/login', (req, res) => {
  if (!PASSWORD) return res.json({ token: VALID_TOKEN, open: true });
  if (safeEq(req.body?.password || '', PASSWORD)) return res.json({ token: VALID_TOKEN });
  setTimeout(() => res.status(401).json({ error: 'Wrong password' }), 700);
});

app.use('/api', (req, res, next) => {
  if (safeEq(req.get('x-auth') || '', VALID_TOKEN)) return next();
  res.status(401).json({ error: 'Not signed in' });
});

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(500).json({ error: 'Server error' });
});

// Everything changed since `since` (ms). Clients poll this to stay in sync.
app.get('/api/sync', wrap(async (req, res) => {
  const now = Date.now();
  const since = Math.max(0, Number(req.query.since) || 0);
  const [contacts, settings] = await Promise.all([db.changedSince(since), db.settings()]);
  res.json({ now, contacts: since ? contacts : contacts.filter((c) => !c.deleted), settings });
}));

// Add one ({contact}) or many ({contacts:[...]}). Duplicates by phone are skipped.
app.post('/api/contacts', wrap(async (req, res) => {
  const by = who(req);
  const raw = Array.isArray(req.body?.contacts) ? req.body.contacts : [req.body?.contact];
  if (raw.length > 5000) return res.status(413).json({ error: 'Send at most 5000 at a time' });
  const list = raw.map((c) => cleanNew(c, by));
  const bad = list.filter((c) => !c.phone);
  const good = list.filter((c) => c.phone);
  const r = await db.insertMany(good, Date.now());
  const result = { inserted: r.inserted, skipped: r.skipped, invalid: bad.map((c) => c.id) };
  if (raw.length === 1 && !r.inserted.length) {
    return res.status(bad.length ? 400 : 409).json({ error: bad.length ? 'Phone number is missing' : 'Already saved', ...result });
  }
  res.json(result);
}));

app.patch('/api/contacts/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const f = {};
  if ('agency' in b) f.agency = str(b.agency, 200);
  if ('rank' in b) f.rank = rank(b.rank);
  if ('owner' in b) f.owner = str(b.owner, 120);
  if ('notes' in b) f.notes = str(b.notes, 5000);
  if ('status' in b) f.status = status(b.status);
  if ('phone' in b) {
    f.phone = phone(b.phone);
    if (!f.phone) return res.status(400).json({ error: 'Phone number is not valid' });
  }
  if (b.call) f.call = true;
  const r = await db.update(req.params.id, f, who(req), Date.now());
  if (r.notFound) return res.status(404).json({ error: 'Contact not found (maybe deleted)' });
  if (r.conflict) return res.status(409).json({ error: `That number is already saved${r.existingAgency ? ' under ' + r.existingAgency : ''}`, existingId: r.existingId });
  res.json({ contact: r.contact });
}));

app.delete('/api/contacts/:id', wrap(async (req, res) => {
  await db.remove(req.params.id, who(req), Date.now());
  res.json({ ok: true });
}));

app.put('/api/settings', wrap(async (req, res) => {
  const allowed = ['waTemplate'];
  const obj = {};
  for (const k of allowed) if (k in (req.body || {})) obj[k] = str(req.body[k], 2000);
  await db.setSettings(obj, Date.now());
  res.json({ settings: await db.settings() });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (/\.(html|js|css|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

db.init()
  .then(() => app.listen(PORT, () => console.log(`Sky High on :${PORT} (store: ${db.kind}${PASSWORD ? '' : ', NO PASSWORD SET'})`)))
  .catch((e) => {
    console.error('Failed to start', e);
    process.exit(1);
  });
