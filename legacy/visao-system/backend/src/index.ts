import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { initializeDatabase } from './db/database';

// Routes
import settingsRouter from './routes/settings';
import suppliersRouter from './routes/suppliers';
import categoriesRouter from './routes/categories';
import productsRouter from './routes/products';
import invoicesRouter from './routes/invoices';
import reportsRouter from './routes/reports';
import searchRouter from './routes/search';
import pricingRouter from './routes/pricing';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static uploads
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// API Routes
app.use('/api/settings', settingsRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/search', searchRouter);
app.use('/api/pricing', pricingRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Equipe da Visão API — Online', version: '1.0.0' });
});

// Initialize DB and start server
initializeDatabase();

app.listen(PORT, () => {
  console.log(`\n✅ Servidor Equipe da Visão rodando em http://localhost:${PORT}`);
  console.log(`📊 API disponível em http://localhost:${PORT}/api`);
});

export default app;
