import { parseStringPromise } from 'xml2js';

export interface NFeItem {
  itemNumber: number;
  code: string;
  name: string;
  ncm: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  grossValue: number;
  discount: number;
  netValue: number;
  unitCost: number;
}

export interface NFeData {
  number: string;
  series: string;
  issueDate: string;
  supplierCnpj: string;
  supplierName: string;
  supplierFantasyName: string;
  supplierCity: string;
  supplierState: string;
  totalValue: number;
  totalDiscount: number;
  items: NFeItem[];
}

export async function parseNFe(xmlContent: string): Promise<NFeData> {
  const parsed = await parseStringPromise(xmlContent, {
    explicitArray: false,
    ignoreAttrs: false,
    trim: true,
  });

  // Handle different XML root structures (nfeProc or NFe)
  let nfe = parsed?.nfeProc?.NFe?.infNFe
    || parsed?.NFe?.infNFe
    || parsed?.nfeProc?.NFe?.$?.Id && parsed?.nfeProc?.NFe
    || null;

  if (!nfe) {
    // Try alternative paths
    const root = parsed?.nfeProc || parsed?.NFe || parsed;
    const nfeNode = root?.NFe || root;
    nfe = nfeNode?.infNFe || nfeNode;
  }

  if (!nfe) {
    throw new Error('Formato de XML inválido. Verifique se é um arquivo NF-e válido.');
  }

  // Extract identification
  const ide = nfe.ide || {};
  const emit = nfe.emit || {};
  const total = nfe.total?.ICMSTot || {};
  const det = nfe.det || [];

  const nfeNumber = ide.nNF?._ || ide.nNF || '';
  const nfeSeries = ide.serie?._ || ide.serie || '';
  const issueDate = ide.dhEmi?._ || ide.dhEmi || ide.dEmi?._ || ide.dEmi || '';

  const supplierCnpj = emit.CNPJ?._ || emit.CNPJ || '';
  const supplierName = emit.xNome?._ || emit.xNome || '';
  const supplierFantasyName = emit.xFant?._ || emit.xFant || supplierName;
  const enderEmit = emit.enderEmit || {};
  const supplierCity = enderEmit.xMun?._ || enderEmit.xMun || '';
  const supplierState = enderEmit.UF?._ || enderEmit.UF || '';

  const totalValue = parseFloat(total.vNF?._ || total.vNF || '0');
  const totalDiscount = parseFloat(total.vDesc?._ || total.vDesc || '0');

  // Normalize det to array
  const detArray = Array.isArray(det) ? det : [det];

  // Calculate proportional discount if no per-item discount
  const items: NFeItem[] = detArray.map((item: any, index: number) => {
    const prod = item.prod || {};
    const itemNumber = parseInt(item.$?.nItem || String(index + 1));
    const code = prod.cProd?._ || prod.cProd || '';
    const name = prod.xProd?._ || prod.xProd || `Produto ${index + 1}`;
    const ncm = prod.NCM?._ || prod.NCM || '';
    const unit = prod.uCom?._ || prod.uCom || 'UN';
    const quantity = parseFloat(prod.qCom?._ || prod.qCom || '1');
    const unitPrice = parseFloat(prod.vUnCom?._ || prod.vUnCom || '0');
    const grossValue = parseFloat(prod.vProd?._ || prod.vProd || String(unitPrice * quantity));
    const itemDiscount = parseFloat(prod.vDesc?._ || prod.vDesc || '0');

    return {
      itemNumber,
      code,
      name,
      ncm,
      unit,
      quantity,
      unitPrice,
      grossValue,
      discount: itemDiscount,
      netValue: 0, // calculated below
      unitCost: 0, // calculated below
    };
  });

  // Distribute global discount proportionally if items have no individual discount
  const itemsTotalDiscount = items.reduce((s, i) => s + i.discount, 0);
  const remainingDiscount = totalDiscount - itemsTotalDiscount;

  if (remainingDiscount > 0.01) {
    const totalGross = items.reduce((s, i) => s + i.grossValue, 0);
    items.forEach(item => {
      const proportion = totalGross > 0 ? item.grossValue / totalGross : 1 / items.length;
      item.discount += remainingDiscount * proportion;
    });
  }

  // Calculate net values and unit costs
  items.forEach(item => {
    item.netValue = Math.max(0, item.grossValue - item.discount);
    item.unitCost = item.quantity > 0 ? item.netValue / item.quantity : item.unitPrice;
    // Round to 4 decimal places
    item.netValue = Math.round(item.netValue * 10000) / 10000;
    item.unitCost = Math.round(item.unitCost * 10000) / 10000;
  });

  return {
    number: nfeNumber,
    series: nfeSeries,
    issueDate,
    supplierCnpj,
    supplierName,
    supplierFantasyName,
    supplierCity,
    supplierState,
    totalValue,
    totalDiscount,
    items,
  };
}
