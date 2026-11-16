/**
 * Selos que o coletor dá a cada oferta. O id vai para o banco; o texto vai
 * para a vitrine, o painel e a mensagem do WhatsApp — sempre o mesmo texto,
 * para a pessoa reconhecer o selo onde quer que ele apareça.
 */
export const DEAL_FLAGS = {
  'menor-preco': {
    label: 'Menor preço que já vimos',
    tone: 'good',
    hint: 'Nunca vimos este anúncio mais barato desde que começamos a acompanhar.',
  },
  'abaixo-do-alvo': {
    label: 'Abaixo do seu preço-alvo',
    tone: 'good',
    hint: 'Passou do preço que você definiu para este item.',
  },
  'mais-barato': {
    label: 'Mais barato entre as lojas',
    tone: 'good',
    hint: 'Nenhuma outra loja confiável tem este item mais barato agora.',
  },
  'caiu-agora': {
    label: 'Caiu na última hora',
    tone: 'good',
    hint: 'O preço baixou desde a coleta anterior.',
  },
  'desconto-real': {
    label: 'Desconto real',
    tone: 'good',
    hint: 'Mais barato que a mediana dos últimos 30 dias que registramos.',
  },
  'preco-de-inflado': {
    label: 'Preço "de" inflado',
    tone: 'warn',
    hint: 'O preço "de" anunciado é bem maior do que qualquer preço que já vimos. O desconto anunciado não é real.',
  },
  'subiu-antes': {
    label: 'Subiu antes de baixar',
    tone: 'warn',
    hint: 'Este anúncio ficou mais caro nas semanas anteriores. Parte do "desconto" só devolve o aumento.',
  },
  'oferta-relampago': {
    label: 'Oferta relâmpago',
    tone: 'info',
    hint: 'A loja marcou como oferta por tempo ou estoque limitado.',
  },
  'historico-curto': {
    label: 'Acompanhando há pouco tempo',
    tone: 'info',
    hint: 'Ainda temos menos de 3 dias de histórico deste anúncio.',
  },
} as const

export type DealFlag = keyof typeof DEAL_FLAGS
export type FlagTone = (typeof DEAL_FLAGS)[DealFlag]['tone']

export function flagLabel(flag: string): string {
  return (DEAL_FLAGS as Record<string, { label: string }>)[flag]?.label ?? flag
}

export function flagTone(flag: string): FlagTone | 'info' {
  return (DEAL_FLAGS as Record<string, { tone: FlagTone }>)[flag]?.tone ?? 'info'
}
