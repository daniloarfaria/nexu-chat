import { Router, Request, Response } from 'express';
import db from '../db/database';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  res.json({ success: true, data: settings });
});

router.put('/', (req: Request, res: Response) => {
  const { packaging_cost, card_fee_pct, commission_pct, tax_pct, extra_costs_pct, active_strategy } = req.body;

  db.prepare(`
    UPDATE settings SET
      packaging_cost = COALESCE(?, packaging_cost),
      card_fee_pct = COALESCE(?, card_fee_pct),
      commission_pct = COALESCE(?, commission_pct),
      tax_pct = COALESCE(?, tax_pct),
      extra_costs_pct = COALESCE(?, extra_costs_pct),
      active_strategy = COALESCE(?, active_strategy),
      updated_at = datetime('now')
    WHERE id = 1
  `).run(packaging_cost, card_fee_pct, commission_pct, tax_pct, extra_costs_pct, active_strategy);

  const updated = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  res.json({ success: true, data: updated });
});

export default router;
