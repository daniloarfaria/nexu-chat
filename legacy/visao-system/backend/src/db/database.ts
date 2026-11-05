// Using Node.js 22.5+ built-in SQLite module (no native compilation needed!)
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'visao.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign keys for better performance
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      packaging_cost REAL NOT NULL DEFAULT 5.00,
      card_fee_pct REAL NOT NULL DEFAULT 3.00,
      commission_pct REAL NOT NULL DEFAULT 5.00,
      tax_pct REAL NOT NULL DEFAULT 8.00,
      extra_costs_pct REAL NOT NULL DEFAULT 0.00,
      active_strategy TEXT NOT NULL DEFAULT 'balanced',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      fantasy_name TEXT,
      cnpj TEXT,
      email TEXT,
      phone TEXT,
      city TEXT,
      state TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      series TEXT,
      supplier_id TEXT REFERENCES suppliers(id),
      supplier_name TEXT,
      issue_date TEXT,
      import_date TEXT NOT NULL DEFAULT (datetime('now')),
      total_value REAL,
      total_discount REAL DEFAULT 0,
      xml_filename TEXT,
      items_count INTEGER DEFAULT 0,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT NOT NULL,
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      category_name TEXT,
      subcategory TEXT,
      supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
      supplier_name TEXT,
      material TEXT,
      plating TEXT,
      color TEXT,
      stone TEXT,
      description TEXT,
      notes TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      purchase_price REAL NOT NULL DEFAULT 0,
      packaging_cost REAL NOT NULL DEFAULT 5.00,
      tax_pct REAL NOT NULL DEFAULT 8.00,
      card_fee_pct REAL NOT NULL DEFAULT 3.00,
      commission_pct REAL NOT NULL DEFAULT 5.00,
      extra_costs_pct REAL NOT NULL DEFAULT 0.00,
      total_cost REAL NOT NULL DEFAULT 0,
      suggested_price REAL,
      final_price REAL,
      min_price REAL,
      promo_price REAL,
      markup REAL,
      margin_pct REAL,
      profit REAL,
      purchase_date TEXT,
      invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
      invoice_number TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
      item_number INTEGER,
      code TEXT,
      name TEXT NOT NULL,
      ncm TEXT,
      unit TEXT,
      quantity REAL NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      gross_value REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      net_value REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pricing_rules (
      id TEXT PRIMARY KEY,
      category_name TEXT NOT NULL,
      cost_up_to REAL NOT NULL,
      suggested_price REAL NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pricing_strategies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      price_level_offset INTEGER NOT NULL DEFAULT 0,
      is_custom INTEGER NOT NULL DEFAULT 0,
      custom_margin_pct REAL,
      custom_markup REAL
    );
  `);

  // Seed default settings
  const settingsExist = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (!settingsExist) {
    db.prepare(`
      INSERT INTO settings (id, packaging_cost, card_fee_pct, commission_pct, tax_pct, extra_costs_pct, active_strategy)
      VALUES (1, 5.00, 3.00, 5.00, 8.00, 0.00, 'balanced')
    `).run();
  }

  const strategiesExist = db.prepare('SELECT id FROM pricing_strategies LIMIT 1').get();
  if (!strategiesExist) {
    const insertStrategy = db.prepare(`
      INSERT INTO pricing_strategies (id, name, label, description, price_level_offset, is_custom)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertStrategy.run('economic', 'economic', 'Econômica', 'Maior giro, margens menores. Ideal para aumentar o volume de vendas.', -1, 0);
    insertStrategy.run('balanced', 'balanced', 'Equilibrada', 'Estratégia padrão. Equilíbrio entre giro e lucro. Recomendada para a maioria dos produtos.', 0, 0);
    insertStrategy.run('premium', 'premium', 'Premium', 'Maior margem. Posicionamento de boutique para o público Equipe da Visão.', 1, 0);
    insertStrategy.run('custom', 'custom', 'Personalizada', 'Configure sua própria margem e markup.', 0, 1);
  }

  const rulesExist = db.prepare('SELECT id FROM pricing_rules LIMIT 1').get();
  if (!rulesExist) seedPricingRules();

  const catsExist = db.prepare('SELECT id FROM categories LIMIT 1').get();
  if (!catsExist) seedCategories();
}

function seedPricingRules(): void {
  const insert = db.prepare(`
    INSERT INTO pricing_rules (id, category_name, cost_up_to, suggested_price, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);
  const rules: [string, string, number, number, number][] = [
    ['rule-b1', 'Brincos', 12, 39.90, 1], ['rule-b2', 'Brincos', 18, 49.90, 2],
    ['rule-b3', 'Brincos', 25, 59.90, 3], ['rule-b4', 'Brincos', 35, 79.90, 4],
    ['rule-b5', 'Brincos', 45, 99.90, 5],
    ['rule-a1', 'Anéis', 20, 59.90, 1], ['rule-a2', 'Anéis', 30, 79.90, 2],
    ['rule-a3', 'Anéis', 45, 99.90, 3], ['rule-a4', 'Anéis', 60, 129.90, 4],
    ['rule-c1', 'Colares', 25, 69.90, 1], ['rule-c2', 'Colares', 35, 89.90, 2],
    ['rule-c3', 'Colares', 50, 119.90, 3], ['rule-c4', 'Colares', 70, 149.90, 4],
    ['rule-p1', 'Pulseiras', 20, 59.90, 1], ['rule-p2', 'Pulseiras', 35, 79.90, 2],
    ['rule-p3', 'Pulseiras', 50, 99.90, 3], ['rule-p4', 'Pulseiras', 70, 129.90, 4],
    ['rule-cj1', 'Conjuntos', 40, 99.90, 1], ['rule-cj2', 'Conjuntos', 60, 149.90, 2],
    ['rule-cj3', 'Conjuntos', 90, 199.90, 3], ['rule-cj4', 'Conjuntos', 120, 249.90, 4],
    ['rule-ai1', 'Aço Inox', 20, 49.90, 1], ['rule-ai2', 'Aço Inox', 35, 69.90, 2],
    ['rule-ai3', 'Aço Inox', 50, 89.90, 3], ['rule-ai4', 'Aço Inox', 70, 119.90, 4],
  ];
  for (const rule of rules) insert.run(...rule);
}

function seedCategories(): void {
  const insert = db.prepare('INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)');
  const cats: [string, string, null][] = [
    ['cat-brincos', 'Brincos', null], ['cat-aneis', 'Anéis', null],
    ['cat-colares', 'Colares', null], ['cat-pulseiras', 'Pulseiras', null],
    ['cat-conjuntos', 'Conjuntos', null], ['cat-aco-inox', 'Aço Inox', null],
    ['cat-outros', 'Outros', null],
  ];
  for (const c of cats) insert.run(...c);
}

export default db;
