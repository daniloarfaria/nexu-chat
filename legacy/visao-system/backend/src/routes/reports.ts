import { Router, Request, Response } from 'express';
import db from '../db/database';

const router = Router();

// Dashboard summary
router.get('/dashboard', (_req: Request, res: Response) => {
  const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE status = ?').get('active') as any;
  const totalInvested = db.prepare('SELECT SUM(purchase_price * quantity) as total FROM products WHERE status = ?').get('active') as any;
  const totalPotential = db.prepare('SELECT SUM(final_price * quantity) as total FROM products WHERE status = ?').get('active') as any;
  const totalProfit = db.prepare('SELECT SUM(profit * quantity) as total FROM products WHERE status = ?').get('active') as any;
  const avgMargin = db.prepare('SELECT AVG(margin_pct) as avg FROM products WHERE status = ?').get('active') as any;
  const recentInvoices = db.prepare(`
    SELECT i.*, s.fantasy_name as supplier_fantasy
    FROM invoices i LEFT JOIN suppliers s ON s.id = i.supplier_id
    ORDER BY i.import_date DESC LIMIT 5
  `).all();
  const recentProducts = db.prepare(`
    SELECT * FROM products WHERE status = 'active' ORDER BY created_at DESC LIMIT 8
  `).all();

  res.json({
    success: true,
    data: {
      totalProducts: totalProducts.count,
      totalInvested: totalInvested.total || 0,
      totalPotentialSales: totalPotential.total || 0,
      totalPotentialProfit: totalProfit.total || 0,
      avgMarginPct: avgMargin.avg || 0,
      recentInvoices,
      recentProducts,
    }
  });
});

// Detailed reports
router.get('/products', (_req: Request, res: Response) => {
  const byCategory = db.prepare(`
    SELECT category_name, COUNT(*) as count,
      SUM(purchase_price * quantity) as invested,
      SUM(final_price * quantity) as potential_sales,
      AVG(margin_pct) as avg_margin,
      AVG(markup) as avg_markup
    FROM products WHERE status = 'active'
    GROUP BY category_name ORDER BY count DESC
  `).all();

  const topProfitable = db.prepare(`
    SELECT name, category_name, purchase_price, final_price, profit, margin_pct, markup
    FROM products WHERE status = 'active'
    ORDER BY profit DESC LIMIT 10
  `).all();

  const lowestMargin = db.prepare(`
    SELECT name, category_name, purchase_price, final_price, profit, margin_pct
    FROM products WHERE status = 'active' AND margin_pct IS NOT NULL
    ORDER BY margin_pct ASC LIMIT 10
  `).all();

  const bySupplier = db.prepare(`
    SELECT supplier_name, COUNT(*) as products_count,
      SUM(purchase_price * quantity) as invested,
      AVG(margin_pct) as avg_margin
    FROM products WHERE status = 'active'
    GROUP BY supplier_name ORDER BY invested DESC
  `).all();

  const priceDistribution = db.prepare(`
    SELECT
      CASE
        WHEN final_price <= 39.90 THEN 'Até R$39,90'
        WHEN final_price <= 69.90 THEN 'R$40 - R$69,90'
        WHEN final_price <= 99.90 THEN 'R$70 - R$99,90'
        WHEN final_price <= 149.90 THEN 'R$100 - R$149,90'
        ELSE 'Acima de R$150'
      END as range,
      COUNT(*) as count
    FROM products WHERE status = 'active'
    GROUP BY range ORDER BY MIN(final_price)
  `).all();

  const summary = db.prepare(`
    SELECT
      AVG(final_price) as avg_price,
      AVG(margin_pct) as avg_margin,
      AVG(markup) as avg_markup,
      SUM(purchase_price * quantity) as total_invested,
      SUM(final_price * quantity) as total_potential,
      SUM(profit * quantity) as total_profit,
      COUNT(*) as total_products
    FROM products WHERE status = 'active'
  `).get();

  res.json({
    success: true,
    data: { byCategory, topProfitable, lowestMargin, bySupplier, priceDistribution, summary }
  });
});

export default router;
