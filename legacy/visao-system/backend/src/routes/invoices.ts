import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import fs from 'fs';
import db from '../db/database';
import { parseNFe } from '../parsers/nfe-parser';
import { calculatePricing } from '../pricing/engine';

const router = Router();
const upload = multer({ dest: 'uploads/xml/' });

router.get('/', (_req: Request, res: Response) => {
  const invoices = db.prepare(`
    SELECT i.*, s.fantasy_name as supplier_fantasy
    FROM invoices i
    LEFT JOIN suppliers s ON s.id = i.supplier_id
    ORDER BY i.import_date DESC
  `).all();
  res.json({ success: true, data: invoices });
});

router.get('/:id', (req: Request, res: Response) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ success: false, error: 'NF-e não encontrada' });

  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
  const products = db.prepare('SELECT * FROM products WHERE invoice_id = ?').all(req.params.id);
  res.json({ success: true, data: { ...invoice as any, items, products } });
});

// Preview XML without saving
router.post('/preview', upload.single('xml'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Arquivo XML não enviado' });

  try {
    const xmlContent = fs.readFileSync(req.file.path, 'utf-8');
    fs.unlinkSync(req.file.path);
    const nfeData = await parseNFe(xmlContent);

    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;
    const costSettings = {
      packagingCost: settings.packaging_cost,
      cardFeePct: settings.card_fee_pct,
      commissionPct: settings.commission_pct,
      taxPct: settings.tax_pct,
      extraCostsPct: settings.extra_costs_pct,
      activeStrategy: settings.active_strategy,
    };

    const previewItems = nfeData.items.map(item => {
      const pricing = calculatePricing({
        purchasePrice: item.unitCost,
        categoryName: undefined,
        settings: costSettings,
      });
      return { ...item, pricing };
    });

    res.json({ success: true, data: { ...nfeData, items: previewItems } });
  } catch (err: any) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Import XML and save to database
router.post('/import', upload.single('xml'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Arquivo XML não enviado' });

  try {
    const xmlContent = fs.readFileSync(req.file.path, 'utf-8');
    const originalName = req.file.originalname;

    const nfeData = await parseNFe(xmlContent);
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as any;

    const costSettings = {
      packagingCost: settings.packaging_cost,
      cardFeePct: settings.card_fee_pct,
      commissionPct: settings.commission_pct,
      taxPct: settings.tax_pct,
      extraCostsPct: settings.extra_costs_pct,
      activeStrategy: settings.active_strategy,
    };

    const importTx = db.transaction(() => {
      // Upsert supplier
      let supplierId: string | null = null;
      if (nfeData.supplierCnpj) {
        const existingSupplier = db.prepare('SELECT id FROM suppliers WHERE cnpj = ?').get(nfeData.supplierCnpj) as any;
        if (existingSupplier) {
          supplierId = existingSupplier.id;
          db.prepare(`UPDATE suppliers SET name = ?, fantasy_name = ?, city = ?, state = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(nfeData.supplierName, nfeData.supplierFantasyName, nfeData.supplierCity, nfeData.supplierState, supplierId);
        } else {
          supplierId = uuidv4();
          db.prepare(`INSERT INTO suppliers (id, name, fantasy_name, cnpj, city, state) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(supplierId, nfeData.supplierName, nfeData.supplierFantasyName, nfeData.supplierCnpj, nfeData.supplierCity, nfeData.supplierState);
        }
      }

      // Create invoice
      const invoiceId = uuidv4();
      db.prepare(`
        INSERT INTO invoices (id, number, series, supplier_id, supplier_name, issue_date, total_value, total_discount, xml_filename, items_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(invoiceId, nfeData.number, nfeData.series, supplierId, nfeData.supplierName,
        nfeData.issueDate, nfeData.totalValue, nfeData.totalDiscount, originalName, nfeData.items.length);

      // Create products and invoice items
      const createdProducts = [];
      for (const item of nfeData.items) {
        const pricing = calculatePricing({ purchasePrice: item.unitCost, settings: costSettings });

        const productId = uuidv4();
        db.prepare(`
          INSERT INTO products (
            id, code, name, supplier_id, supplier_name,
            quantity, purchase_price, packaging_cost, tax_pct, card_fee_pct, commission_pct, extra_costs_pct,
            total_cost, suggested_price, final_price, min_price,
            markup, margin_pct, profit,
            purchase_date, invoice_id, invoice_number
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?
          )
        `).run(
          productId, item.code, item.name, supplierId, nfeData.supplierName,
          item.quantity, item.unitCost,
          costSettings.packagingCost, costSettings.taxPct, costSettings.cardFeePct, costSettings.commissionPct, costSettings.extraCostsPct,
          pricing.breakdown.totalCost, pricing.balanced.price, pricing.recommended.price, pricing.conservative.price,
          pricing.recommended.markup, pricing.recommended.marginPct, pricing.recommended.profit,
          nfeData.issueDate, invoiceId, nfeData.number
        );

        const itemId = uuidv4();
        db.prepare(`
          INSERT INTO invoice_items (id, invoice_id, product_id, item_number, code, name, ncm, unit, quantity, unit_price, gross_value, discount, net_value, unit_cost)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(itemId, invoiceId, productId, item.itemNumber, item.code, item.name, item.ncm, item.unit,
          item.quantity, item.unitPrice, item.grossValue, item.discount, item.netValue, item.unitCost);

        createdProducts.push(productId);
      }

      // Move XML file to permanent location
      const xmlDir = 'uploads/xml/imported/';
      if (!fs.existsSync(xmlDir)) fs.mkdirSync(xmlDir, { recursive: true });
      const destPath = `${xmlDir}${invoiceId}_${originalName}`;
      fs.renameSync(req.file!.path, destPath);

      return { invoiceId, productsCount: createdProducts.length, supplierId };
    });

    const result = importTx();
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(result.invoiceId);
    const products = db.prepare('SELECT * FROM products WHERE invoice_id = ?').all(result.invoiceId);

    res.status(201).json({ success: true, data: { invoice, products } });
  } catch (err: any) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  // Also delete associated products
  db.prepare('DELETE FROM products WHERE invoice_id = ?').run(req.params.id);
  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'NF-e e produtos removidos' });
});

export default router;
