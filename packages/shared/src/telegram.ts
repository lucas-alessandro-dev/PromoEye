/**
 * Texto do Telegram a partir do texto do WhatsApp.
 *
 * As mensagens dos dois canais ficam guardadas no formato do WhatsApp
 * (*negrito*, _itálico_, ~riscado~): o painel mostra e edita tudo do mesmo
 * jeito. Na hora de enviar ao Telegram, o texto vira HTML (parse_mode "HTML")
 * com `< > &` escapados, então um título com "<" nunca vira tag. Links ficam
 * como estão: "_" dentro de uma URL não é itálico.
 */

const URL_RE = /(https?:\/\/[^\s]+)/g
// O mesmo do balão de prévia do painel (WhatsAppBubble), para o que você vê ser o que sai.
const FORMAT_RE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g
const TAG: Record<string, string> = { '*': 'b', _: 'i', '~': 's' }

export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function whatsappToTelegramHtml(text: string): string {
  // split com grupo de captura: o que casou fica nas posições ímpares.
  return text
    .split(URL_RE)
    .map((seg, i) =>
      i % 2 === 1
        ? escapeTelegramHtml(seg)
        : seg
            .split(FORMAT_RE)
            .map((part, j) => {
              if (j % 2 === 0) return escapeTelegramHtml(part)
              const tag = TAG[part[0]!]!
              return `<${tag}>${escapeTelegramHtml(part.slice(1, -1))}</${tag}>`
            })
            .join('')
    )
    .join('')
}
