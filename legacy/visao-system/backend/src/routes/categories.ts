import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const categories = db.prepare(`
    SELECT c.*, COUNT(p.id) as products_count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id
    GROUP BY c.id
    ORDER BY c.name ASC
  `).all();
  res.json({ success: true, data: categories });
});

router.post('/', (req: Request, res: Response) => {
  const { name, parent_id } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'Nome é obrigatório' });

  const id = uuidv4();
  db.prepare('INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)').run(id, name, parent_id || null);
  const created = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  res.status(201).json({ success: true, data: created });
});

router.put('/:id', (req: Request, res: Response) => {
  const { name, parent_id } = req.body;
  db.prepare(`
    UPDATE categories SET
      name = COALESCE(?, name),
      parent_id = ?
    WHERE id = ?
  `).run(name, parent_id || null, req.params.id);
  const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  res.json({ success: true, data: updated });
});

router.delete('/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Categoria removida' });
});

export default router;
