// Storage layer. Uses Postgres when DATABASE_URL is set (recommended on Railway),
// otherwise a JSON file in DATA_DIR (handy locally, or with a Railway volume).
const fs = require('fs');
const path = require('path');

const FIELDS = ['agency', 'rank', 'owner', 'phone', 'status', 'notes'];
const HISTORY_MAX = 60;

function pushHistory(history, entry) {
  const h = Array.isArray(history) ? history.slice() : [];
  h.push(entry);
  return h.slice(-HISTORY_MAX);
}

/* ------------------------------ Postgres ------------------------------ */
function pgStore(url) {
  const { Pool } = require('pg');
  const ssl = /sslmode=require/.test(url) || process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString: url, ssl, max: 5 });
  const q = (text, params) => pool.query(text, params);

  const toApi = (r) => ({
    id: r.id,
    agency: r.agency,
    rank: r.rank,
    owner: r.owner,
    phone: r.phone,
    status: r.status,
    notes: r.notes,
    history: r.history || [],
    addedBy: r.added_by,
    updatedBy: r.updated_by,
    callCount: r.call_count,
    lastCalledAt: r.last_called_at == null ? null : Number(r.last_called_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    deleted: r.deleted,
  });

  return {
    kind: 'postgres',
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        agency TEXT NOT NULL DEFAULT '',
        rank INTEGER,
        owner TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        notes TEXT NOT NULL DEFAULT '',
        history JSONB NOT NULL DEFAULT '[]'::jsonb,
        added_by TEXT NOT NULL DEFAULT '',
        updated_by TEXT NOT NULL DEFAULT '',
        call_count INTEGER NOT NULL DEFAULT 0,
        last_called_at BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        deleted BOOLEAN NOT NULL DEFAULT FALSE
      )`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS contacts_phone_live ON contacts(phone) WHERE NOT deleted`);
      await q(`CREATE INDEX IF NOT EXISTS contacts_updated_at ON contacts(updated_at)`);
      await q(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL)`);
    },
    async changedSince(since) {
      const r = await q(`SELECT * FROM contacts WHERE updated_at >= $1 ORDER BY updated_at`, [since]);
      return r.rows.map(toApi);
    },
    async settings() {
      const r = await q(`SELECT key, value FROM settings`);
      const out = {};
      r.rows.forEach((x) => (out[x.key] = x.value));
      return out;
    },
    async setSettings(obj, now) {
      for (const [k, v] of Object.entries(obj)) {
        await q(
          `INSERT INTO settings(key, value, updated_at) VALUES ($1,$2,$3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
          [k, String(v), now]
        );
      }
    },
    async insertMany(list, now) {
      const inserted = [];
      const skipped = [];
      const client = await pool.connect();
      try {
        for (const c of list) {
          const hist = JSON.stringify([{ s: c.status, at: now, by: c.addedBy }]);
          const r = await client.query(
            `INSERT INTO contacts(id, agency, rank, owner, phone, status, notes, history, added_by, updated_by, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9,$10,$10) ON CONFLICT DO NOTHING`,
            [c.id, c.agency, c.rank, c.owner, c.phone, c.status, c.notes, hist, c.addedBy, now]
          );
          if (r.rowCount) { inserted.push(c.id); continue; }
          // Same id already there (a retried request) counts as success.
          const same = await client.query(`SELECT id FROM contacts WHERE id = $1`, [c.id]);
          if (same.rowCount) { inserted.push(c.id); continue; }
          const dup = await client.query(`SELECT id, agency FROM contacts WHERE phone = $1 AND NOT deleted`, [c.phone]);
          skipped.push({ id: c.id, phone: c.phone, existingId: dup.rows[0]?.id || null, existingAgency: dup.rows[0]?.agency || '' });
        }
      } finally {
        client.release();
      }
      return { inserted, skipped };
    },
    async update(id, fields, by, now) {
      const cur = (await q(`SELECT * FROM contacts WHERE id = $1`, [id])).rows[0];
      if (!cur || cur.deleted) return { notFound: true };
      const sets = [];
      const vals = [];
      const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      for (const f of FIELDS) if (f in fields) add(f, fields[f]);
      if ('status' in fields && fields.status !== cur.status) {
        add('history', JSON.stringify(pushHistory(cur.history, { s: fields.status, at: now, by })));
      }
      if (fields.call) { add('call_count', cur.call_count + 1); add('last_called_at', now); }
      add('updated_by', by);
      add('updated_at', now);
      vals.push(id);
      try {
        const r = await q(`UPDATE contacts SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
        return { contact: toApi(r.rows[0]) };
      } catch (e) {
        if (e.code === '23505') {
          const dup = await q(`SELECT id, agency FROM contacts WHERE phone = $1 AND NOT deleted`, [fields.phone]);
          return { conflict: true, existingId: dup.rows[0]?.id, existingAgency: dup.rows[0]?.agency };
        }
        throw e;
      }
    },
    async remove(id, by, now) {
      const r = await q(`UPDATE contacts SET deleted = TRUE, updated_by = $2, updated_at = $3 WHERE id = $1 AND NOT deleted`, [id, by, now]);
      return { ok: r.rowCount > 0 };
    },
  };
}

/* ------------------------------ JSON file ----------------------------- */
function fileStore(dir) {
  const file = path.join(dir, 'skyhigh.json');
  let data = { contacts: {}, settings: {} };
  let timer = null;

  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    }, 150);
  };
  const livePhone = (phone, exceptId) =>
    Object.values(data.contacts).find((c) => !c.deleted && c.phone === phone && c.id !== exceptId);

  return {
    kind: 'file',
    async init() {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));
    },
    async changedSince(since) {
      return Object.values(data.contacts).filter((c) => c.updatedAt >= since).sort((a, b) => a.updatedAt - b.updatedAt);
    },
    async settings() { return { ...data.settings }; },
    async setSettings(obj) { Object.assign(data.settings, obj); save(); },
    async insertMany(list, now) {
      const inserted = [];
      const skipped = [];
      for (const c of list) {
        if (data.contacts[c.id]) { inserted.push(c.id); continue; }
        const dup = livePhone(c.phone);
        if (dup) { skipped.push({ id: c.id, phone: c.phone, existingId: dup.id, existingAgency: dup.agency }); continue; }
        data.contacts[c.id] = {
          ...c, history: [{ s: c.status, at: now, by: c.addedBy }], updatedBy: c.addedBy,
          callCount: 0, lastCalledAt: null, createdAt: now, updatedAt: now, deleted: false,
        };
        inserted.push(c.id);
      }
      save();
      return { inserted, skipped };
    },
    async update(id, fields, by, now) {
      const cur = data.contacts[id];
      if (!cur || cur.deleted) return { notFound: true };
      if ('phone' in fields) {
        const dup = livePhone(fields.phone, id);
        if (dup) return { conflict: true, existingId: dup.id, existingAgency: dup.agency };
      }
      const next = { ...cur };
      for (const f of FIELDS) if (f in fields) next[f] = fields[f];
      if ('status' in fields && fields.status !== cur.status) next.history = pushHistory(cur.history, { s: fields.status, at: now, by });
      if (fields.call) { next.callCount = (cur.callCount || 0) + 1; next.lastCalledAt = now; }
      next.updatedBy = by;
      next.updatedAt = now;
      data.contacts[id] = next;
      save();
      return { contact: next };
    },
    async remove(id, by, now) {
      const cur = data.contacts[id];
      if (!cur || cur.deleted) return { ok: false };
      data.contacts[id] = { ...cur, deleted: true, updatedBy: by, updatedAt: now };
      save();
      return { ok: true };
    },
  };
}

module.exports = process.env.DATABASE_URL
  ? pgStore(process.env.DATABASE_URL)
  : fileStore(process.env.DATA_DIR || path.join(__dirname, 'data'));
