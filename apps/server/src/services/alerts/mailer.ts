import { createTransport, type Transporter } from 'nodemailer'
import { config } from '../../config.js'

/**
 * Envio de e-mail por SMTP (qualquer provedor). Sem SMTP_URL no .env, os
 * alertas ficam desligados: o formulário não aparece e nada é enviado.
 */

export function smtpConfigured(): boolean {
  return Boolean(config.SMTP_URL && config.SMTP_FROM)
}

let transport: Transporter | null = null

function mailer(): Transporter {
  if (!transport) transport = createTransport(config.SMTP_URL)
  return transport
}

export interface Mail {
  to: string
  subject: string
  text: string
  html: string
  /** Página para cancelar (vai no List-Unsubscribe, o botão "cancelar inscrição" do Gmail). */
  unsubscribeUrl?: string
}

export async function sendMail(m: Mail): Promise<string | null> {
  if (!smtpConfigured()) throw new Error('SMTP não configurado (SMTP_URL e SMTP_FROM no .env).')
  const info = await mailer().sendMail({
    from: config.SMTP_FROM,
    to: m.to,
    subject: m.subject,
    text: m.text,
    html: m.html,
    headers: m.unsubscribeUrl
      ? {
          'List-Unsubscribe': `<${m.unsubscribeUrl}>`,
          // RFC 8058: o provedor faz um POST nesse endereço e o alerta é cancelado, sem abrir página.
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }
      : undefined,
  })
  return info.messageId ?? null
}
