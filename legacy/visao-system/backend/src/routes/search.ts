import { Router, Request, Response } from 'express';
import db from '../db/database';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const { q } = req.query;
  if (!q || String(q).length < 2) {
    return res.json({ success: true, data: { products: [], suppliers: [], invoices: [] } });
  }

  const search = `%${q}%`;

  const products = db.prepare(`
    SELECT id, code, name, category_name, supplier_name, final_price, purchase_price, status
    FROM products
    WHERE name LIKE ? OR code LIKE ? OR category_name LIKE ? OR supplier_name LIKE ? OR invoice_number LIKE ?
    ORDER BY name ASC LIMIT 20
  `).all(search, search, search, search, search);

  const suppliers = db.prepare(`
    SELECT id, name, fantasy_name, cnpj, city, state
    FROM suppliers
    WHERE name LIKE ? OR fantasy_name LIKE ? OR cnpj LIKE ?
    LIMIT 10
  `).all(search, search, search);

  const invoices = db.prepare(`
    SELECT id, number, supplier_name, issue_date, total_value, items_count
    FROM invoices
    WHERE number LIKE ? OR supplier_name LIKE ?
    LIMIT 10
  `).all(search, search);

  res.json({ success: true, data: { products, suppliers, invoices } });
});

export default router;
