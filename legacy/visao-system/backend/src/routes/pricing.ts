import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { calculatePricing } from '../pricing/engine';

const router = Router();

// Get all pricing rules
router.get('/rules', (_req: Request, res: Response) => {
  const rules = db.prepare(`
    SELECT * FROM pricing_rules ORDER BY category_name, cost_up_to ASC
  `).all();
  res.json({ success: true, data: rules });
});

// Update a pricing rule
router.put('/rules/:id', (req: Request, res: Response) => {
  const { category_name, cost_up_to, suggested_price, sort_order } = req.body;
  db.prepare(`
    UPDATE pricing_rules SET
      category_name = COALESCE(?, category_name),
      cost_up_to = COALESCE(?, cost_up_to),
      suggested_price = COALESCE(?, suggested_price),
      sort_order = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(category_name, cost_up_to, suggested_price, sort_order, req.params.id);
  const updated = db.prepare('SELECT * FROM pricing_rules WHERE id = ?').get(req.params.id);
  res.json({ success: true, data: updated });
});

// Add a new pricing rule
router.post('/rules', (req: Request, res: Response) => {
  const { category_name, cost_up_to, suggested_price, sort_order = 0 } = req.body;
  if (!category_name || cost_up_to == null || suggested_price == null) {
    return res.status(400).json({ success: false, error: 'Campos obrigatórios: category_name, cost_up_to, suggested_price' });
  }
  const id = uuidv4();
  db.prepare(`INSERT INTO pricing_rules (id, category_name, cost_up_to, suggested_price, sort_order) VALUES (?, ?, ?, ?, ?)`)
    .run(id, category_name, cost_up_to, suggested_price, sort_order);
  const created = db.prepare('SELECT * FROM pricing_rules WHERE id = ?').get(id);
  res.status(201).json({ success: true, data: created });
});

// Delete a pricing rule
router.delete('/rules/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM pricing_rules WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Regra removida' });
});

// Get all strategies
router.get('/strategies', (_req: Request, res: Response) => {
  const strategies = db.prepare('SELECT * FROM pricing_strategies ORDER BY id').all();
  res.json({ success: true, data: strategies });
});

// Update a strategy (for custom)
router.put('/strategies/:id', (req: Request, res: Response) => {
  const { description, custom_margin_pct, custom_markup } = req.body;
  db.prepare(`
    UPDATE pricing_strategies SET
      description = COALESCE(?, description),
      custom_margin_pct = COALESCE(?, custom_margin_pct),
      custom_markup = COALESCE(?, custom_markup)
    WHERE id = ?
  `).run(description, custom_margin_pct, custom_markup, req.params.id);
  const updated = db.prepare('SELECT * FROM pricing_strategies WHERE id = ?').get(req.params.id);
  res.json({ success: true, data: updated });
});

// Calculate pricing for ad-hoc request (Assistente)
router.post('/calculate', (req: Request, res: Response) => {
  const { purchase_price, category_name, strategy } = req.body;
  if (purchase_price == null) {
    return res.status(400).json({ success: false, error: 'purchase_price é obrigatório' });
  }

  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
  const costSettings = {
    packagingCost: req.body.packaging_cost ?? settings.packaging_cost,
    cardFeePct: req.body.card_fee_pct ?? settings.card_fee_pct,
    commissionPct: req.body.commission_pct ?? settings.commission_pct,
    taxPct: req.body.tax_pct ?? settings.tax_pct,
    extraCostsPct: req.body.extra_costs_pct ?? settings.extra_costs_pct,
    activeStrategy: strategy || settings.active_strategy,
  };

  const result = calculatePricing({ purchasePrice: purchase_price, categoryName: category_name, settings: costSettings, strategy });
  res.json({ success: true, data: result });
});

export default router;
