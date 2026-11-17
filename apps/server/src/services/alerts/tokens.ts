import { createHmac, timingSafeEqual } from 'node:crypto'
import { config, publicUrl } from '../../config.js'

/**
 * Links dos e-mails de alerta: /alertas/<id>/<assinatura>.
 *
 * A assinatura é um HMAC do id com uma chave derivada do SESSION_SECRET. Dá
 * para refazer o link em qualquer e-mail futuro (cancelar em um clique) sem
 * guardar token nenhum no banco. Quem tem o link é quem recebeu o e-mail.
 */

const key = createHmac('sha256', config.SESSION_SECRET).update('promoeye/alerts/v1').digest()

export function alertSignature(alertId: string, secret: Buffer = key): string {
  return createHmac('sha256', secret).update(alertId).digest('base64url').slice(0, 32)
}

export function verifyAlertSignature(alertId: string, signature: string, secret: Buffer = key): boolean {
  const expected = Buffer.from(alertSignature(alertId, secret))
  const given = Buffer.from(String(signature))
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Página do alerta (confirmar, ver, cancelar). */
export function alertUrl(alertId: string): string {
  return `${publicUrl}/alertas/${alertId}/${alertSignature(alertId)}`
}

/** Alvo do List-Unsubscribe-Post (RFC 8058): o provedor de e-mail cancela com um POST. */
export function alertUnsubscribeUrl(alertId: string): string {
  return `${alertUrl(alertId)}/cancelar`
}
