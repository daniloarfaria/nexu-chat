import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../api/client';
import {
  Package, DollarSign, TrendingUp, BarChart3,
  FileText, ArrowUpRight, ShoppingBag, Percent
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import { formatBRL, formatDate, formatPct } from '../utils/format';

const PIE_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#8B5CF6'];

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: reportsApi.dashboard,
    refetchInterval: 30000,
  });

  const { data: repData } = useQuery({
    queryKey: ['reports-products'],
    queryFn: reportsApi.products,
  });

  if (isLoading) return <DashboardSkeleton />;

  const d = data || {};
  const categoryData = repData?.byCategory || [];

  return (
    <div className="animate-slide-up">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Visão geral do seu estoque de semijoias</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-5 mb-8">
        <KpiCard
          icon={<Package size={20} color="#6366F1" />}
          iconBg="#EEF2FF"
          label="Total de Produtos"
          value={String(d.totalProducts || 0)}
          id="kpi-total-products"
        />
        <KpiCard
          icon={<DollarSign size={20} color="#10B981" />}
          iconBg="#ECFDF5"
          label="Valor Investido"
          value={formatBRL(d.totalInvested || 0)}
          id="kpi-invested"
        />
        <KpiCard
          icon={<ShoppingBag size={20} color="#F59E0B" />}
          iconBg="#FFFBEB"
          label="Potencial de Venda"
          value={formatBRL(d.totalPotentialSales || 0)}
          id="kpi-potential"
        />
        <KpiCard
          icon={<TrendingUp size={20} color="#6366F1" />}
          iconBg="#EEF2FF"
          label="Lucro Potencial"
          value={formatBRL(d.totalPotentialProfit || 0)}
          id="kpi-profit"
        />
        <KpiCard
          icon={<Percent size={20} color="#3B82F6" />}
          iconBg="#EFF6FF"
          label="Margem Média"
          value={formatPct(d.avgMarginPct || 0)}
          id="kpi-margin"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-2 gap-6 mb-6">
        {/* Category pie chart */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Produtos por Categoria</span>
            <BarChart3 size={16} style={{ color: 'var(--text-tertiary)' }} />
          </div>
          <div className="card-body" style={{ height: 260 }}>
            {categoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    dataKey="count"
                    nameKey="category_name"
                    cx="40%"
                    cy="50%"
                    outerRadius={90}
                    strokeWidth={2}
                    stroke="var(--surface)"
                  >
                    {categoryData.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend
                    layout="vertical"
                    align="right"
                    verticalAlign="middle"
                    formatter={(v) => <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{v || 'Sem categoria'}</span>}
                  />
                  <Tooltip
                    formatter={(v: any) => [v + ' produtos', '']}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Nenhum produto cadastrado ainda" />
            )}
          </div>
        </div>

        {/* Margin by category */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Margem por Categoria</span>
            <TrendingUp size={16} style={{ color: 'var(--text-tertiary)' }} />
          </div>
          <div className="card-body" style={{ height: 260 }}>
            {categoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={categoryData} margin={{ left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="category_name"
                    tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                  />
                  <Tooltip
                    formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'Margem']}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="avg_margin"
                    stroke="#6366F1"
                    fill="url(#gradientMargin)"
                    strokeWidth={2}
                  />
                  <defs>
                    <linearGradient id="gradientMargin" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366F1" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Importe produtos para ver as margens" />
            )}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-2 gap-6">
        {/* Recent invoices */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Últimas NF-e Importadas</span>
            <FileText size={16} style={{ color: 'var(--text-tertiary)' }} />
          </div>
          <div>
            {(d.recentInvoices || []).length === 0 ? (
              <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                <FileText className="empty-state-icon" />
                <p className="empty-state-title">Nenhuma NF-e importada</p>
                <p className="empty-state-desc">Importe um XML para começar</p>
              </div>
            ) : (
              (d.recentInvoices || []).map((inv: any) => (
                <div key={inv.id} className="stat-row" style={{ padding: 'var(--space-3) var(--space-6)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                      NF {inv.number}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      {inv.supplier_fantasy || inv.supplier_name} · {inv.items_count} itens
                    </div>
                  </div>
                  <div className="text-right">
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{formatBRL(inv.total_value)}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{formatDate(inv.import_date)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent products */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Produtos Recentes</span>
            <Package size={16} style={{ color: 'var(--text-tertiary)' }} />
          </div>
          <div>
            {(d.recentProducts || []).length === 0 ? (
              <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
                <Package className="empty-state-icon" />
                <p className="empty-state-title">Nenhum produto cadastrado</p>
                <p className="empty-state-desc">Os produtos aparecerão aqui após importação</p>
              </div>
            ) : (
              (d.recentProducts || []).slice(0, 6).map((p: any) => (
                <div key={p.id} className="stat-row" style={{ padding: 'var(--space-3) var(--space-6)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="truncate" style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', maxWidth: 200 }}>
                      {p.name}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      {p.category_name || 'Sem categoria'} · Qtd: {p.quantity}
                    </div>
                  </div>
                  <div className="text-right">
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>
                      {formatBRL(p.final_price)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                      Custo: {formatBRL(p.purchase_price)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, iconBg, label, value, id }: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  id: string;
}) {
  return (
    <div className="kpi-card" id={id}>
      <div className="kpi-icon" style={{ background: iconBg }}>
        {icon}
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{message}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="skeleton" style={{ width: 140, height: 26, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 260, height: 16 }} />
        </div>
      </div>
      <div className="grid grid-5 mb-8">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="kpi-card">
            <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 10, marginBottom: 16 }} />
            <div className="skeleton" style={{ width: '70%', height: 28, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: '50%', height: 14 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
