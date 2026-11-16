/**
 * Catálogo inicial de lojas confiáveis. O seed grava isto no banco; depois
 * cada loja é ligada, desligada e configurada pelo painel.
 *
 * Critério de "confiável": varejista grande ou loja oficial do fabricante,
 * com CNPJ, SAC e política de troca conhecidos. Nada de marketplace aberto
 * sem filtro de vendedor.
 *
 * Testado em 16/11/2026 a partir de uma conexão residencial:
 *  - VTEX: a API pública de busca respondeu com produtos e preços.
 *  - KaBuM!: a API JSON do site respondeu.
 *  - Amazon: a página de busca respondeu com resultados.
 *  - Mercado Livre, Magazine Luiza, Casas Bahia: bloqueiam robôs (403 /
 *    "tráfego suspeito"), inclusive Chrome headless. Ficam como MANUAL: a
 *    oferta entra pelo painel, com o seu link de afiliado. Não tentamos driblar
 *    o bloqueio.
 */
export type StoreAdapterId = 'VTEX' | 'KABUM' | 'AMAZON' | 'MANUAL'

export interface StoreSeed {
  id: string
  name: string
  domain: string
  adapter: StoreAdapterId
  config: Record<string, unknown>
  enabled: boolean
  sellerPolicy: 'OFFICIAL_ONLY' | 'ALL'
  trustNote: string
  sortOrder: number
}

const vtex = (
  id: string,
  name: string,
  domain: string,
  trustNote: string,
  sortOrder: number,
  mode: 'isearch' | 'catalog' = 'isearch'
): StoreSeed => ({
  id,
  name,
  domain,
  adapter: 'VTEX',
  config: { baseUrl: `https://${domain}`, mode },
  enabled: true,
  sellerPolicy: 'OFFICIAL_ONLY',
  trustNote,
  sortOrder,
})

export const DEFAULT_STORES: StoreSeed[] = [
  {
    id: 'amazon',
    name: 'Amazon',
    domain: 'www.amazon.com.br',
    adapter: 'AMAZON',
    config: {},
    enabled: true,
    sellerPolicy: 'OFFICIAL_ONLY',
    trustNote: 'Garantia de A a Z da Amazon em toda compra',
    sortOrder: 10,
  },
  {
    id: 'kabum',
    name: 'KaBuM!',
    domain: 'www.kabum.com.br',
    adapter: 'KABUM',
    config: {},
    enabled: true,
    sellerPolicy: 'OFFICIAL_ONLY',
    trustNote: 'Varejista de tecnologia desde 2003, do grupo Magalu',
    sortOrder: 20,
  },
  vtex('americanas', 'Americanas', 'www.americanas.com.br', 'Varejista nacional, vendedores parceiros filtrados', 30),
  vtex('carrefour', 'Carrefour', 'www.carrefour.com.br', 'Loja on-line da rede Carrefour', 40),
  vtex('ibyte', 'iByte', 'www.ibyte.com.br', 'Varejista de tecnologia do Nordeste desde 1993', 50),
  vtex('brastemp', 'Brastemp', 'www.brastemp.com.br', 'Loja oficial da fabricante (Whirlpool)', 60),
  vtex('consul', 'Consul', 'www.consul.com.br', 'Loja oficial da fabricante (Whirlpool)', 61),
  vtex('compracerta', 'Compra Certa', 'www.compracerta.com.br', 'Loja oficial da Whirlpool (Brastemp, Consul, KitchenAid)', 62),
  vtex('electrolux', 'Electrolux', 'loja.electrolux.com.br', 'Loja oficial da fabricante', 63),
  vtex('motorola', 'Motorola', 'www.motorola.com.br', 'Loja oficial da fabricante', 70),
  vtex('polishop', 'Polishop', 'www.polishop.com.br', 'Loja oficial da marca', 80),
  vtex('mondial', 'Mondial', 'www.mondial.com.br', 'Loja oficial da fabricante', 81),
  vtex('philco', 'Philco', 'www.philco.com.br', 'Loja oficial da fabricante', 82),
  vtex('britania', 'Britânia', 'www.britania.com.br', 'Loja oficial da fabricante', 83),
  vtex('multilaser', 'Multi', 'www.multilaser.com.br', 'Loja oficial da fabricante (Multi/Multilaser)', 84),
  vtex('rihappy', 'Ri Happy', 'www.rihappy.com.br', 'Maior rede de lojas de brinquedos do país', 90),
  vtex('cea', 'C&A', 'www.cea.com.br', 'Loja on-line da rede C&A', 91),
  vtex('vivara', 'Vivara', 'www.vivara.com.br', 'Loja oficial da joalheria', 92, 'catalog'),
  {
    id: 'mercadolivre',
    name: 'Mercado Livre',
    domain: 'www.mercadolivre.com.br',
    adapter: 'MANUAL',
    config: {},
    enabled: true,
    sellerPolicy: 'OFFICIAL_ONLY',
    trustNote: 'Só lojas oficiais e Mercado Líder. Oferta adicionada à mão.',
    sortOrder: 200,
  },
  {
    id: 'magalu',
    name: 'Magazine Luiza',
    domain: 'www.magazineluiza.com.br',
    adapter: 'MANUAL',
    config: {},
    enabled: true,
    sellerPolicy: 'OFFICIAL_ONLY',
    trustNote: 'Vendido e entregue por Magalu. Oferta adicionada à mão.',
    sortOrder: 210,
  },
  {
    id: 'casasbahia',
    name: 'Casas Bahia',
    domain: 'www.casasbahia.com.br',
    adapter: 'MANUAL',
    config: {},
    enabled: true,
    sellerPolicy: 'OFFICIAL_ONLY',
    trustNote: 'Vendido e entregue por Casas Bahia. Oferta adicionada à mão.',
    sortOrder: 220,
  },
]

/**
 * Vendedores de marketplace aceitos quando a loja está em OFFICIAL_ONLY.
 * Casa por palavra inteira, sem acento e sem caixa ("Loja iPlace" casa
 * "iplace"; "Applestore Importados" NÃO casa "apple").
 * Grafias coladas ("Carrefourcom", "Fastshop") entram como variantes.
 */
export const DEFAULT_TRUSTED_SELLERS = [
  'amazon',
  'kabum',
  'americanas',
  'carrefour',
  'carrefourcom',
  'magazine luiza',
  'magalu',
  'casas bahia',
  'ponto frio',
  'pontofrio',
  'fast shop',
  'fastshop',
  'ibyte',
  'girafa',
  'kalunga',
  'webcontinental',
  'casa e video',
  'iplace',
  'apple',
  'samsung',
  'motorola',
  'xiaomi',
  'lg electronics',
  'sony',
  'philips',
  'electrolux',
  'brastemp',
  'consul',
  'whirlpool',
  'mondial',
  'britania',
  'philco',
  'multilaser',
  'positivo',
  'lenovo',
  'dell',
  'acer',
  'asus',
  'jbl',
  'polishop',
  'nike',
  'adidas',
  'lego',
  'mattel',
  'hasbro',
]

/**
 * Palavras que quase sempre indicam acessório, usado ou anúncio enganoso.
 * Só valem quando NÃO aparecem na própria busca (quem procura "capa iPhone"
 * quer capa).
 */
export const DEFAULT_EXCLUDES = [
  'capa',
  'capinha',
  'case',
  'pelicula',
  'protetor',
  'suporte',
  'adesivo',
  'skin',
  'usado',
  'usada',
  'seminovo',
  'seminova',
  'recondicionado',
  'recondicionada',
  'vitrine',
  'reembalado',
  'mostruario',
  'defeito',
  'compativel',
  'similar',
  'replica',
  'pecas',
  'peca',
  'refil',
]
