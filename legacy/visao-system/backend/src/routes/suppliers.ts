import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const suppliers = db.prepare(`
    SELECT s.*, COUNT(p.id) as products_count
    FROM suppliers s
    LEFT JOIN products p ON p.supplier_id = s.id
    GROUP BY s.id
    ORDER BY s.name ASC
  `).all();
  res.json({ success: true, data: suppliers });
});

router.get('/:id', (req: Request, res: Response) => {
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!supplier) return res.status(404).json({ success: false, error: 'Fornecedor não encontrado' });
  res.json({ success: true, data: supplier });
});

router.post('/', (req: Request, res: Response) => {
  const { name, fantasy_name, cnpj, email, phone, city, state, notes } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Nome é obrigatório' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO suppliers (id, name, fantasy_name, cnpj, email, phone, city, state, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, fantasy_name, cnpj, email, phone, city, state, notes);

  const created = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  res.status(201).json({ success: true, data: created });
});

router.put('/:id', (req: Request, res: Response) => {
  const { name, fantasy_name, cnpj, email, phone, city, state, notes } = req.body;
  db.prepare(`
    UPDATE suppliers SET
      name = COALESCE(?, name),
      fantasy_name = COALESCE(?, fantasy_name),
      cnpj = COALESCE(?, cnpj),
      email = COALESCE(?, email),
      phone = COALESCE(?, phone),
      city = COALESCE(?, city),
      state = COALESCE(?, state),
      notes = COALESCE(?, notes),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(name, fantasy_name, cnpj, email, phone, city, state, notes, req.params.id);

  const updated = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  res.json({ success: true, data: updated });
});

router.delete('/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Fornecedor removido' });
});

export default router;
