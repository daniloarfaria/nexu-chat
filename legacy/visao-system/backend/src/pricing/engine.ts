import db from '../db/database';

export interface Settings {
  packagingCost: number;
  cardFeePct: number;
  commissionPct: number;
  taxPct: number;
  extraCostsPct: number;
  activeStrategy: string;
}

export interface PricingInput {
  purchasePrice: number;
  categoryName?: string;
  strategy?: string;
  settings: Settings;
  customMarginPct?: number;
  customMarkup?: number;
}

export interface PriceBreakdown {
  purchasePrice: number;
  packagingCost: number;
  taxCost: number;
  financialCost: number;
  extraCost: number;
  totalCost: number;
}

export interface PriceSuggestion {
  price: number;
  profit: number;
  marginPct: number;
  markup: number;
  label: string;
  justification: string;
  level: 'conservative' | 'balanced' | 'premium';
}

export interface PricingResult {
  breakdown: PriceBreakdown;
  conservative: PriceSuggestion;
  balanced: PriceSuggestion;
  premium: PriceSuggestion;
  recommended: PriceSuggestion;
  assistantAnalysis: string;
}

// Psychological price points (sorted ascending)
const PSYCH_PRICES = [
  19.90, 24.90, 29.90, 34.90, 39.90, 44.90, 49.90, 54.90,
  59.90, 64.90, 69.90, 74.90, 79.90, 84.90, 89.90, 94.90,
  99.90, 109.90, 119.90, 129.90, 139.90, 149.90, 159.90,
  169.90, 179.90, 199.90, 219.90, 229.90, 249.90, 279.90,
  299.90, 349.90, 399.90, 449.90, 499.90
];

function nearestPsychPrice(value: number): number {
  // Find the smallest psychological price >= value
  const above = PSYCH_PRICES.find(p => p >= value);
  return above ?? Math.ceil(value / 10) * 10 - 0.10;
}

function psychPriceAtOffset(basePrice: number, offset: number): number {
  const idx = PSYCH_PRICES.findIndex(p => p >= basePrice);
  if (idx === -1) return nearestPsychPrice(basePrice);
  const targetIdx = Math.max(0, Math.min(PSYCH_PRICES.length - 1, idx + offset));
  return PSYCH_PRICES[targetIdx];
}

export function calculateBreakdown(purchasePrice: number, settings: Settings): PriceBreakdown {
  const packagingCost = settings.packagingCost;
  const taxCost = purchasePrice * (settings.taxPct / 100);
  const financialCost = purchasePrice * ((settings.cardFeePct + settings.commissionPct) / 100);
  const extraCost = purchasePrice * (settings.extraCostsPct / 100);
  const totalCost = purchasePrice + packagingCost + taxCost + financialCost + extraCost;

  return {
    purchasePrice,
    packagingCost,
    taxCost,
    financialCost,
    extraCost,
    totalCost: Math.round(totalCost * 100) / 100,
  };
}

function getSuggestedPriceFromRules(categoryName: string | undefined, totalCost: number): number | null {
  if (!categoryName) return null;

  const rules = db.prepare(`
    SELECT suggested_price FROM pricing_rules
    WHERE LOWER(category_name) = LOWER(?)
    AND cost_up_to >= ?
    ORDER BY cost_up_to ASC
    LIMIT 1
  `).get(categoryName, totalCost) as { suggested_price: number } | undefined;

  return rules?.suggested_price ?? null;
}

function buildSuggestion(
  price: number,
  totalCost: number,
  label: string,
  level: 'conservative' | 'balanced' | 'premium',
  justification: string
): PriceSuggestion {
  const profit = Math.round((price - totalCost) * 100) / 100;
  const marginPct = Math.round((profit / price) * 10000) / 100;
  const markup = Math.round((price / totalCost) * 100) / 100;
  return { price, profit, marginPct, markup, label, justification, level };
}

export function calculatePricing(input: PricingInput): PricingResult {
  const { purchasePrice, categoryName, settings } = input;
  const breakdown = calculateBreakdown(purchasePrice, settings);
  const { totalCost } = breakdown;

  // Get base price from rules
  const rulePrice = getSuggestedPriceFromRules(categoryName, totalCost);
  const basePrice = rulePrice ?? nearestPsychPrice(totalCost * 3.5);

  // Conservative: one level below or same minimum
  const conservativePrice = psychPriceAtOffset(basePrice, -1);
  // Balanced: rule price or nearest psychological
  const balancedPrice = nearestPsychPrice(basePrice);
  // Premium: one level above
  const premiumPrice = psychPriceAtOffset(basePrice, 1);

  const catLabel = categoryName || 'peça';

  const conservative = buildSuggestion(
    conservativePrice,
    totalCost,
    'Conservador',
    'conservative',
    `Preço de entrada para ${catLabel}. Foco em volume de vendas e giro rápido. Ideal para novos clientes e promoções.`
  );

  const balanced = buildSuggestion(
    balancedPrice,
    totalCost,
    'Equilibrado',
    'balanced',
    `Preço padrão recomendado para ${catLabel}. Equilibra volume e margem. Alinhado ao posicionamento premium da Equipe da Visão.`
  );

  const premium = buildSuggestion(
    premiumPrice,
    totalCost,
    'Premium',
    'premium',
    `Preço de boutique para ${catLabel}. Maximiza a margem e reforça o posicionamento premium. Indicado para peças com maior valor percebido.`
  );

  // Recommended based on active strategy
  const strategy = input.strategy || settings.activeStrategy;
  let recommended: PriceSuggestion;

  if (strategy === 'economic') {
    recommended = { ...conservative, label: 'Econômica (Recomendado)' };
  } else if (strategy === 'premium') {
    recommended = { ...premium, label: 'Premium (Recomendado)' };
  } else if (strategy === 'custom' && input.customMarkup) {
    const customPrice = nearestPsychPrice(totalCost * input.customMarkup);
    recommended = buildSuggestion(customPrice, totalCost, 'Personalizado (Recomendado)', 'balanced',
      `Preço calculado com markup personalizado de ${input.customMarkup}x sobre o custo total.`);
  } else {
    recommended = { ...balanced, label: 'Equilibrada (Recomendado)' };
  }

  const assistantAnalysis = generateAssistantAnalysis({
    categoryName,
    purchasePrice,
    totalCost,
    breakdown,
    conservative,
    balanced,
    premium,
  });

  return { breakdown, conservative, balanced, premium, recommended, assistantAnalysis };
}

function generateAssistantAnalysis(data: {
  categoryName?: string;
  purchasePrice: number;
  totalCost: number;
  breakdown: PriceBreakdown;
  conservative: PriceSuggestion;
  balanced: PriceSuggestion;
  premium: PriceSuggestion;
}): string {
  const { categoryName, purchasePrice, totalCost, breakdown, balanced } = data;
  const cat = categoryName || 'esta peça';

  return `🔍 **Análise da Peça — ${cat}**\n\n` +
    `**Custo de aquisição:** R$ ${purchasePrice.toFixed(2)}\n` +
    `**Embalagem:** R$ ${breakdown.packagingCost.toFixed(2)}\n` +
    `**Tributos (${data.breakdown.taxCost > 0 ? ((breakdown.taxCost / purchasePrice) * 100).toFixed(1) : 0}%):** R$ ${breakdown.taxCost.toFixed(2)}\n` +
    `**Taxas financeiras:** R$ ${breakdown.financialCost.toFixed(2)}\n` +
    `**Custo total real:** R$ ${totalCost.toFixed(2)}\n\n` +
    `**💡 Recomendação:** O preço equilibrado de **R$ ${balanced.price.toFixed(2)}** ` +
    `representa um markup de **${balanced.markup}x** com margem de **${balanced.marginPct.toFixed(1)}%**, ` +
    `gerando lucro líquido de **R$ ${balanced.profit.toFixed(2)}** por unidade.\n\n` +
    `Este preço utiliza a técnica de preço psicológico (terminação em ,90), ` +
    `está alinhado com o mercado brasileiro de semijoias e reforça o posicionamento premium da Equipe da Visão. ` +
    `Mesmo com desconto futuro de 10%, a margem permanece positiva.`;
}
