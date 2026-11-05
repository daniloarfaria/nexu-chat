import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { calculatePricing, calculateBreakdown } from '../pricing/engine';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const { search, category, supplier, invoice, status, limit = 100, offset = 0 } = req.query;

  let query = `
    SELECT p.*, c.name as category_display
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (search) {
    query += ` AND (p.name LIKE ? OR p.code LIKE ? OR p.description LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (category) { query += ` AND p.category_id = ?`; params.push(category); }
  if (supplier) { query += ` AND p.supplier_id = ?`; params.push(supplier); }
  if (invoice) { query += ` AND p.invoice_id = ?`; params.push(invoice); }
  if (status) { query += ` AND p.status = ?`; params.push(status); }

  query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  const products = db.prepare(query).all(...params);
  const total = db.prepare(`SELECT COUNT(*) as count FROM products WHERE 1=1`).get() as { count: number };

  res.json({ success: true, data: products, total: total.count });
});

router.get('/:id', (req: Request, res: Response) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ success: false, error: 'Produto não encontrado' });

  // Generate full pricing analysis
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
  const p = product as any;

  const pricingResult = calculatePricing({
    purchasePrice: p.purchase_price,
    categoryName: p.category_name,
    settings: {
      packagingCost: p.packaging_cost,
      cardFeePct: p.card_fee_pct,
      commissionPct: p.commission_pct,
      taxPct: p.tax_pct,
      extraCostsPct: p.extra_costs_pct,
      activeStrategy: settings.active_strategy,
    },
  });

  res.json({ success: true, data: { ...p, pricing: pricingResult } });
});

router.post('/', (req: Request, res: Response) => {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;

  const {
    code, name, category_id, category_name, subcategory, supplier_id, supplier_name,
    material, plating, color, stone, description, notes,
    quantity = 1, purchase_price = 0, purchase_date, invoice_id, invoice_number,
    final_price, min_price, promo_price,
    packaging_cost, card_fee_pct, commission_pct, tax_pct, extra_costs_pct,
  } = req.body;

  if (!name) return res.status(400).json({ success: false, error: 'Nome é obrigatório' });

  const costSettings = {
    packagingCost: packaging_cost ?? settings.packaging_cost,
    cardFeePct: card_fee_pct ?? settings.card_fee_pct,
    commissionPct: commission_pct ?? settings.commission_pct,
    taxPct: tax_pct ?? settings.tax_pct,
    extraCostsPct: extra_costs_pct ?? settings.extra_costs_pct,
    activeStrategy: settings.active_strategy,
  };

  const pricing = calculatePricing({ purchasePrice: purchase_price, categoryName: category_name, settings: costSettings });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO products (
      id, code, name, category_id, category_name, subcategory, supplier_id, supplier_name,
      material, plating, color, stone, description, notes,
      quantity, purchase_price, packaging_cost, tax_pct, card_fee_pct, commission_pct, extra_costs_pct,
      total_cost, suggested_price, final_price, min_price, promo_price,
      markup, margin_pct, profit,
      purchase_date, invoice_id, invoice_number
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?
    )
  `).run(
    id, code, name, category_id, category_name, subcategory, supplier_id, supplier_name,
    material, plating, color, stone, description, notes,
    quantity, purchase_price,
    costSettings.packagingCost, costSettings.taxPct, costSettings.cardFeePct, costSettings.commissionPct, costSettings.extraCostsPct,
    pricing.breakdown.totalCost,
    pricing.balanced.price,
    final_price ?? pricing.recommended.price,
    min_price ?? pricing.conservative.price,
    promo_price ?? null,
    pricing.recommended.markup,
    pricing.recommended.marginPct,
    pricing.recommended.profit,
    purchase_date, invoice_id, invoice_number
  );

  const created = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.status(201).json({ success: true, data: created });
});

router.put('/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ success: false, error: 'Produto não encontrado' });

  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
  const body = req.body;

  const purchase_price = body.purchase_price ?? existing.purchase_price;
  const category_name = body.category_name ?? existing.category_name;

  const costSettings = {
    packagingCost: body.packaging_cost ?? existing.packaging_cost ?? settings.packaging_cost,
    cardFeePct: body.card_fee_pct ?? existing.card_fee_pct ?? settings.card_fee_pct,
    commissionPct: body.commission_pct ?? existing.commission_pct ?? settings.commission_pct,
    taxPct: body.tax_pct ?? existing.tax_pct ?? settings.tax_pct,
    extraCostsPct: body.extra_costs_pct ?? existing.extra_costs_pct ?? settings.extra_costs_pct,
    activeStrategy: settings.active_strategy,
  };

  const pricing = calculatePricing({ purchasePrice: purchase_price, categoryName: category_name, settings: costSettings });

  db.prepare(`
    UPDATE products SET
      code = COALESCE(?, code),
      name = COALESCE(?, name),
      category_id = COALESCE(?, category_id),
      category_name = COALESCE(?, category_name),
      subcategory = COALESCE(?, subcategory),
      supplier_id = COALESCE(?, supplier_id),
      supplier_name = COALESCE(?, supplier_name),
      material = COALESCE(?, material),
      plating = COALESCE(?, plating),
      color = COALESCE(?, color),
      stone = COALESCE(?, stone),
      description = COALESCE(?, description),
      notes = COALESCE(?, notes),
      quantity = COALESCE(?, quantity),
      purchase_price = ?,
      packaging_cost = ?,
      tax_pct = ?,
      card_fee_pct = ?,
      commission_pct = ?,
      extra_costs_pct = ?,
      total_cost = ?,
      suggested_price = ?,
      final_price = COALESCE(?, final_price),
      min_price = COALESCE(?, min_price),
      promo_price = COALESCE(?, promo_price),
      markup = ?,
      margin_pct = ?,
      profit = ?,
      purchase_date = COALESCE(?, purchase_date),
      status = COALESCE(?, status),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    body.code, body.name, body.category_id, body.category_name, body.subcategory,
    body.supplier_id, body.supplier_name, body.material, body.plating, body.color,
    body.stone, body.description, body.notes, body.quantity,
    purchase_price,
    costSettings.packagingCost, costSettings.taxPct, costSettings.cardFeePct, costSettings.commissionPct, costSettings.extraCostsPct,
    pricing.breakdown.totalCost, pricing.balanced.price,
    body.final_price, body.min_price, body.promo_price,
    pricing.recommended.markup, pricing.recommended.marginPct, pricing.recommended.profit,
    body.purchase_date, body.status,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json({ success: true, data: updated });
});

router.delete('/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Produto removido' });
});

export default router;
