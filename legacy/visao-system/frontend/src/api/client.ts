import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error?.response?.data?.error || error.message || 'Erro desconhecido';
    return Promise.reject(new Error(message));
  }
);

export default api;

// ─── Settings ──────────────────────────────────────────────────
export const settingsApi = {
  get: () => api.get('/settings').then(r => r.data.data),
  update: (data: any) => api.put('/settings', data).then(r => r.data.data),
};

// ─── Products ──────────────────────────────────────────────────
export const productsApi = {
  list: (params?: any) => api.get('/products', { params }).then(r => r.data),
  get: (id: string) => api.get(`/products/${id}`).then(r => r.data.data),
  create: (data: any) => api.post('/products', data).then(r => r.data.data),
  update: (id: string, data: any) => api.put(`/products/${id}`, data).then(r => r.data.data),
  delete: (id: string) => api.delete(`/products/${id}`).then(r => r.data),
};

// ─── Suppliers ─────────────────────────────────────────────────
export const suppliersApi = {
  list: () => api.get('/suppliers').then(r => r.data.data),
  get: (id: string) => api.get(`/suppliers/${id}`).then(r => r.data.data),
  create: (data: any) => api.post('/suppliers', data).then(r => r.data.data),
  update: (id: string, data: any) => api.put(`/suppliers/${id}`, data).then(r => r.data.data),
  delete: (id: string) => api.delete(`/suppliers/${id}`).then(r => r.data),
};

// ─── Categories ────────────────────────────────────────────────
export const categoriesApi = {
  list: () => api.get('/categories').then(r => r.data.data),
  create: (data: any) => api.post('/categories', data).then(r => r.data.data),
  update: (id: string, data: any) => api.put(`/categories/${id}`, data).then(r => r.data.data),
  delete: (id: string) => api.delete(`/categories/${id}`).then(r => r.data),
};

// ─── Invoices ──────────────────────────────────────────────────
export const invoicesApi = {
  list: () => api.get('/invoices').then(r => r.data.data),
  get: (id: string) => api.get(`/invoices/${id}`).then(r => r.data.data),
  preview: (file: File) => {
    const form = new FormData();
    form.append('xml', file);
    return api.post('/invoices/preview', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data.data);
  },
  import: (file: File) => {
    const form = new FormData();
    form.append('xml', file);
    return api.post('/invoices/import', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data.data);
  },
  delete: (id: string) => api.delete(`/invoices/${id}`).then(r => r.data),
};

// ─── Reports ───────────────────────────────────────────────────
export const reportsApi = {
  dashboard: () => api.get('/reports/dashboard').then(r => r.data.data),
  products: () => api.get('/reports/products').then(r => r.data.data),
};

// ─── Search ────────────────────────────────────────────────────
export const searchApi = {
  search: (q: string) => api.get('/search', { params: { q } }).then(r => r.data.data),
};

// ─── Pricing ───────────────────────────────────────────────────
export const pricingApi = {
  getRules: () => api.get('/pricing/rules').then(r => r.data.data),
  createRule: (data: any) => api.post('/pricing/rules', data).then(r => r.data.data),
  updateRule: (id: string, data: any) => api.put(`/pricing/rules/${id}`, data).then(r => r.data.data),
  deleteRule: (id: string) => api.delete(`/pricing/rules/${id}`).then(r => r.data),
  getStrategies: () => api.get('/pricing/strategies').then(r => r.data.data),
  updateStrategy: (id: string, data: any) => api.put(`/pricing/strategies/${id}`, data).then(r => r.data.data),
  calculate: (data: any) => api.post('/pricing/calculate', data).then(r => r.data.data),
};
