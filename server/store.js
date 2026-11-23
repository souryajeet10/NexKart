import { DatabaseSync } from 'node:sqlite';

const sample = [
  ['A0010001', 'Biscuit Packet', 2000, 100, 'Snacks'],
  ['A0010002', 'Chocolate', 5000, 50, 'Snacks'],
  ['A0010003', 'Chips Packet', 3000, 80, 'Snacks'],
  ['A0010004', 'Soap', 4000, 125, 'Personal care'],
  ['A0010005', 'Juice Pack', 6000, 250, 'Beverages'],
];

export function openStore(filename, { seedDemo = process.env.NODE_ENV !== 'production' } = {}) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      price INTEGER NOT NULL, grams INTEGER NOT NULL, category TEXT NOT NULL, image TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, started TEXT NOT NULL, ended TEXT, status TEXT NOT NULL,
      receipt TEXT
    );
    CREATE TABLE IF NOT EXISTS session_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session INTEGER NOT NULL REFERENCES sessions(id),
      product TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS scans (
      event TEXT PRIMARY KEY, session INTEGER NOT NULL REFERENCES sessions(id),
      uid TEXT NOT NULL, time TEXT NOT NULL, result TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS verification_events (
      id INTEGER PRIMARY KEY, session INTEGER NOT NULL REFERENCES sessions(id),
      time TEXT NOT NULL, operation TEXT NOT NULL, expected REAL NOT NULL, actual REAL NOT NULL,
      result TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY, session INTEGER NOT NULL REFERENCES sessions(id),
      time TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY, session INTEGER NOT NULL REFERENCES sessions(id),
      time TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL
    );
  `);
  // Additive migration: preserve existing scan audit records.
  if (!db.prepare('PRAGMA table_info(scans)').all().some(column => column.name === 'response')) {
    db.exec('ALTER TABLE scans ADD COLUMN response TEXT');
  }
  const sql = (query) => db.prepare(query);
  const get = (key) => JSON.parse(sql('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? 'null');
  const set = (key, value) => sql('INSERT OR REPLACE INTO settings VALUES (?, ?)').run(key, JSON.stringify(value));
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (seedDemo && !get('seeded')) transaction(() => {
    for (const row of sample) sql("INSERT INTO products(uid,name,price,grams,category,image) VALUES (?,?,?,?,?,'')").run(...row);
    set('seeded', true);
  });
  return { sql, get, set, transaction, close: () => db.close() };
}
