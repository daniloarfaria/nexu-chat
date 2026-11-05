import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQueryClient } from '@tanstack/react-query';
import { invoicesApi } from '../api/client';
import { Upload, FileText, CheckCircle, AlertCircle, X, ArrowRight, Loader } from 'lucide-react';
import { formatBRL, formatDate } from '../utils/format';
import toast from 'react-hot-toast';

type Step = 'upload' | 'preview' | 'importing' | 'done';

export default function ImportXML() {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const onDrop = useCallback(async (accepted: File[]) => {
    if (!accepted[0]) return;
    const f = accepted[0];
    setFile(f);
    setError(null);
    setLoading(true);
    try {
      const data = await invoicesApi.preview(f);
      setPreview(data);
      setStep('preview');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/xml': ['.xml'], 'application/xml': ['.xml'] },
    maxFiles: 1,
    disabled: loading,
  });

  const handleImport = async () => {
    if (!file) return;
    setStep('importing');
    setLoading(true);
    try {
      const data = await invoicesApi.import(file);
      setResult(data);
      setStep('done');
      queryClient.invalidateQueries();
      toast.success(`${data.products?.length || 0} produtos importados com sucesso!`);
    } catch (err: any) {
      setError(err.message);
      setStep('preview');
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="animate-slide-up" style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Importar XML de NF-e</h1>
          <p className="page-subtitle">Carregue um XML de Nota Fiscal Eletrônica para importar produtos automaticamente</p>
        </div>
      </div>

      {/* Progress steps */}
      <div className="flex items-center gap-3 mb-8">
        {[
          { key: 'upload', label: '1. Selecionar Arquivo' },
          { key: 'preview', label: '2. Revisar Dados' },
          { key: 'done', label: '3. Importado!' },
        ].map((s, i, arr) => (
          <div key={s.key} className="flex items-center gap-3">
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              color: step === s.key ? 'var(--accent)' : (
                ['upload', 'preview', 'importing', 'done'].indexOf(step) > i ? 'var(--success)' : 'var(--text-tertiary)'
              ),
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                background: step === s.key ? 'var(--accent-light)' : (
                  ['upload', 'preview', 'importing', 'done'].indexOf(step) > i ? 'var(--success-light)' : 'var(--bg-secondary)'
                ),
                border: `1px solid ${step === s.key ? 'var(--accent)' : (
                  ['upload', 'preview', 'importing', 'done'].indexOf(step) > i ? 'var(--success)' : 'var(--border)'
                )}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
              }}>
                {['upload', 'preview', 'importing', 'done'].indexOf(step) > i ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</span>
            </div>
            {i < arr.length - 1 && (
              <div style={{ width: 40, height: 1, background: 'var(--border)' }} />
            )}
          </div>
        ))}
      </div>

      {/* Step: Upload */}
      {step === 'upload' && (
        <div>
          <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
            <input {...getInputProps()} id="xml-file-input" />
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div className="spinner" style={{ width: 40, height: 40 }} />
                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Lendo XML...</p>
              </div>
            ) : (
              <>
                <Upload className="dropzone-icon" />
                <p className="dropzone-title">
                  {isDragActive ? 'Solte o arquivo aqui' : 'Arraste o XML da NF-e aqui'}
                </p>
                <p className="dropzone-subtitle">ou clique para selecionar o arquivo</p>
                <div style={{ marginTop: 16 }}>
                  <span className="badge badge-neutral">Aceita: .xml</span>
                </div>
              </>
            )}
          </div>

          {error && (
            <div style={{
              marginTop: 16, padding: '12px 16px', background: 'var(--danger-light)',
              border: '1px solid var(--danger)', borderRadius: 10, display: 'flex',
              alignItems: 'center', gap: 10, color: 'var(--danger)', fontSize: 13,
            }}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div className="card mt-6">
            <div className="card-header">
              <span className="card-title">ℹ️ O que o sistema vai fazer automaticamente</span>
            </div>
            <div className="card-body">
              <div className="grid grid-2 gap-4">
                {[
                  'Identificar todos os produtos da NF-e',
                  'Calcular custo real com desconto proporcional',
                  'Criar o fornecedor automaticamente no sistema',
                  'Calcular preço sugerido por categoria e regras',
                  'Calcular margem, markup e lucro potencial',
                  'Salvar todos os dados no banco automaticamente',
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <CheckCircle size={16} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step: Preview */}
      {step === 'preview' && preview && (
        <div className="animate-slide-up">
          {/* NF-e header info */}
          <div className="card mb-6">
            <div className="card-header">
              <div className="flex items-center gap-3">
                <FileText size={18} style={{ color: 'var(--accent)' }} />
                <span className="card-title">NF-e {preview.number} — Série {preview.series}</span>
              </div>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={handleReset} id="btn-cancel-preview">
                <X size={14} />
              </button>
            </div>
            <div className="card-body">
              <div className="grid grid-4 gap-4">
                <div>
                  <div className="text-xs text-secondary mb-1">Fornecedor</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{preview.supplierFantasyName || preview.supplierName}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{preview.supplierCnpj}</div>
                </div>
                <div>
                  <div className="text-xs text-secondary mb-1">Data de Emissão</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{formatDate(preview.issueDate)}</div>
                </div>
                <div>
                  <div className="text-xs text-secondary mb-1">Valor Total</div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{formatBRL(preview.totalValue)}</div>
                </div>
                <div>
                  <div className="text-xs text-secondary mb-1">Desconto Total</div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--warning)' }}>{formatBRL(preview.totalDiscount)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Items table */}
          <div className="card mb-6">
            <div className="card-header">
              <span className="card-title">{preview.items?.length} Produtos Encontrados</span>
              <span className="badge badge-accent">{file?.name}</span>
            </div>
            <div className="table-wrapper" style={{ borderRadius: '0 0 var(--radius-lg) var(--radius-lg)', border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Código</th>
                    <th>Descrição</th>
                    <th>Qtd</th>
                    <th>Custo Unit.</th>
                    <th>Desconto</th>
                    <th>Custo Real</th>
                    <th>Preço Sugerido</th>
                    <th>Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.items || []).map((item: any, i: number) => (
                    <tr key={i} style={{ cursor: 'default' }}>
                      <td style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{item.itemNumber}</td>
                      <td><span className="badge badge-neutral">{item.code || '—'}</span></td>
                      <td>
                        <div style={{ fontWeight: 500, fontSize: 13, maxWidth: 220 }} className="truncate">
                          {item.name}
                        </div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{item.quantity}</td>
                      <td>{formatBRL(item.unitPrice)}</td>
                      <td style={{ color: item.discount > 0 ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                        {formatBRL(item.discount)}
                      </td>
                      <td style={{ fontWeight: 600 }}>{formatBRL(item.unitCost)}</td>
                      <td style={{ fontWeight: 700, color: 'var(--accent)' }}>
                        {formatBRL(item.pricing?.balanced?.price)}
                      </td>
                      <td>
                        <span className={`badge ${(item.pricing?.balanced?.marginPct || 0) >= 40 ? 'badge-success' : 'badge-warning'}`}>
                          {(item.pricing?.balanced?.marginPct || 0).toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button className="btn btn-secondary" onClick={handleReset} id="btn-back-upload">
              ← Voltar
            </button>
            <button className="btn btn-primary" onClick={handleImport} id="btn-confirm-import">
              <ArrowRight size={15} />
              Confirmar Importação ({preview.items?.length} produtos)
            </button>
          </div>
        </div>
      )}

      {/* Step: Importing */}
      {step === 'importing' && (
        <div className="card" style={{ padding: 'var(--space-12)', textAlign: 'center' }}>
          <Loader size={48} style={{ color: 'var(--accent)', margin: '0 auto 20px', animation: 'spin 1s linear infinite' }} />
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Importando produtos...</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            Calculando custos, preços e margens automaticamente
          </p>
        </div>
      )}

      {/* Step: Done */}
      {step === 'done' && result && (
        <div className="animate-slide-up">
          <div className="card mb-6" style={{ textAlign: 'center', padding: 'var(--space-10)' }}>
            <CheckCircle size={56} style={{ color: 'var(--success)', margin: '0 auto 20px' }} />
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              Importação Concluída!
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              {result.products?.length} produtos foram importados e precificados automaticamente
            </p>
          </div>

          <div className="grid grid-3 gap-4 mb-6">
            <div className="kpi-card" style={{ textAlign: 'center' }}>
              <div className="kpi-value">{result.products?.length || 0}</div>
              <div className="kpi-label">Produtos Importados</div>
            </div>
            <div className="kpi-card" style={{ textAlign: 'center' }}>
              <div className="kpi-value" style={{ color: 'var(--accent)' }}>
                {formatBRL(result.products?.reduce((s: number, p: any) => s + (p.final_price || 0) * (p.quantity || 1), 0))}
              </div>
              <div className="kpi-label">Potencial de Venda</div>
            </div>
            <div className="kpi-card" style={{ textAlign: 'center' }}>
              <div className="kpi-value" style={{ color: 'var(--success)' }}>
                {formatBRL(result.products?.reduce((s: number, p: any) => s + (p.profit || 0) * (p.quantity || 1), 0))}
              </div>
              <div className="kpi-label">Lucro Potencial</div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button className="btn btn-secondary" onClick={handleReset} id="btn-import-another">
              Importar outra NF-e
            </button>
            <a href="/products" className="btn btn-primary" id="btn-view-products">
              Ver Produtos
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
