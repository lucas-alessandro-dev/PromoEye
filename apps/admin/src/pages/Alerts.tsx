import { useState } from 'react'
import { Link } from 'react-router'
import { formatBRL, timeAgo, type AlertDTO } from '@promoeye/shared'
import { ALERTS_CSV_URL, api, errorMessage } from '../api'
import { useToast } from '../context/toast'
import { useLoad, useTitle } from '../lib/hooks'
import { formatDateTime } from '../lib/format'
import { Badge } from '../components/Deal'
import { ConfirmModal } from '../components/Modal'
import { Empty, ErrorBox, Loading } from '../components/States'

const STATUS: Record<AlertDTO['status'], { label: string; tone: 'good' | 'warn' | 'neutral' }> = {
  PENDING: { label: 'falta confirmar', tone: 'warn' },
  ACTIVE: { label: 'ativo', tone: 'good' },
  UNSUBSCRIBED: { label: 'cancelado', tone: 'neutral' },
}

/**
 * Alertas "me avise quando baixar" da vitrine: os e-mails de quem quer saber
 * do preço de um item ou produto. Opt-in duplo; nada sai antes da confirmação.
 */
export function Alerts() {
  useTitle('Alertas')
  const { toast } = useToast()
  const { data, error, loading, reload, setData } = useLoad(() => api.listAlerts(), [])
  const [removing, setRemoving] = useState<AlertDTO | null>(null)
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await api.deleteAlert(removing.id)
      setData((d) => (d ? { ...d, alerts: d.alerts.filter((a) => a.id !== removing.id) } : d))
      toast('Alerta apagado.')
      setRemoving(null)
      reload()
    } catch (err) {
      toast(errorMessage(err), 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Alertas de preço</h1>
          <p className="lead">Quem pediu, na vitrine, um e-mail quando o preço cair.</p>
        </div>
        {data && data.counts.active > 0 && (
          <div className="head-actions">
            <a className="btn btn-ghost" href={ALERTS_CSV_URL} download>
              Exportar CSV (ativos)
            </a>
          </div>
        )}
      </header>

      {loading && !data && <Loading />}
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : null}

      {data && (
        <>
          {!data.smtpConfigured && (
            <div className="notice notice-warn" role="status">
              <p>
                <strong>Os alertas estão desligados: falta o e-mail de saída.</strong> Defina <code>SMTP_URL</code> e{' '}
                <code>SMTP_FROM</code> no <code>.env</code> do servidor (qualquer provedor SMTP: Brevo, Amazon SES, Resend…) e
                reinicie o app. Até lá, o formulário “Me avise quando baixar” não aparece na vitrine e nenhum e-mail é enviado.
              </p>
            </div>
          )}
          {data.smtpConfigured && !data.enabled && (
            <div className="notice notice-info" role="status">
              <p>
                O e-mail está configurado, mas os alertas estão desligados em <Link to="/configuracoes">Configurações</Link>. O
                formulário não aparece na vitrine.
              </p>
            </div>
          )}

          <section className="card" aria-labelledby="h-alert-counts">
            <h2 id="h-alert-counts" className="sr-only">
              Resumo
            </h2>
            <dl className="stats">
              <div>
                <dt>Ativos</dt>
                <dd>{data.counts.active}</dd>
              </div>
              <div>
                <dt>Falta confirmar</dt>
                <dd>{data.counts.pending}</dd>
              </div>
              <div>
                <dt>Cancelados</dt>
                <dd>{data.counts.unsubscribed}</dd>
              </div>
              <div>
                <dt>Avisados em 7 dias</dt>
                <dd>{data.counts.notified7d}</dd>
              </div>
            </dl>
          </section>

          {data.alerts.length === 0 ? (
            <Empty title="Nenhum alerta ainda">
              Quando alguém pedir um aviso na página de um item ou produto, ele aparece aqui. O e-mail só vale depois que a pessoa
              confirma pelo link.
            </Empty>
          ) : (
            <>
              {data.alerts.length >= 500 && <p className="muted small">Mostrando os 500 mais recentes.</p>}
              <table className="rtable alerts-table">
                <thead>
                  <tr>
                    <th scope="col">E-mail</th>
                    <th scope="col">Item ou produto</th>
                    <th scope="col">Preço-alvo</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Criado</th>
                    <th scope="col">Último aviso</th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.alerts.map((a) => (
                    <tr key={a.id} className={a.status === 'UNSUBSCRIBED' ? 'is-muted' : ''}>
                      <td data-label="E-mail" className="alert-email">
                        {a.email}
                      </td>
                      <td data-label="Item ou produto">
                        <a href={a.target.url} target="_blank" rel="noopener">
                          {a.target.name}
                        </a>
                        <span className="muted small block">{a.target.kind === 'product' ? 'produto (EAN)' : 'item'}</span>
                      </td>
                      <td data-label="Preço-alvo" className="num">
                        {a.targetPrice !== null ? formatBRL(a.targetPrice) : <span className="muted">promoção de verdade</span>}
                      </td>
                      <td data-label="Situação">
                        <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                      </td>
                      <td data-label="Criado" title={formatDateTime(a.createdAt)}>
                        {timeAgo(a.createdAt)}
                      </td>
                      <td data-label="Último aviso">
                        {a.lastNotifiedAt ? (
                          <>
                            <span title={formatDateTime(a.lastNotifiedAt)}>{timeAgo(a.lastNotifiedAt)}</span>
                            {a.lastNotifiedPrice !== null && <span className="muted small block">a {formatBRL(a.lastNotifiedPrice)}</span>}
                          </>
                        ) : (
                          <span className="muted">nunca</span>
                        )}
                        <span className="muted small block">
                          {a.notifyCount} {a.notifyCount === 1 ? 'aviso' : 'avisos'}
                        </span>
                      </td>
                      <td data-label="Ações" className="cell-actions">
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRemoving(a)}>
                          Apagar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {removing && (
        <ConfirmModal
          title="Apagar este alerta?"
          confirmLabel="Apagar de vez"
          danger
          busy={busy}
          onConfirm={() => void remove()}
          onClose={() => setRemoving(null)}
        >
          <p>
            Apaga de vez o alerta de <strong>{removing.email}</strong> para “{removing.target.name}”, com o registro do
            consentimento. Use para pedido de exclusão (LGPD). Para só parar os avisos, a própria pessoa cancela pelo link do
            e-mail.
          </p>
        </ConfirmModal>
      )}
    </div>
  )
}
