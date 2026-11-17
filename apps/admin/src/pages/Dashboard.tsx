import { Link } from 'react-router'
import type { RunDTO, StoreDTO } from '@promoeye/shared'
import { timeAgo } from '@promoeye/shared'
import { api } from '../api'
import { useRun } from '../context/run'
import { useLoad, useTitle } from '../lib/hooks'
import { ADAPTER_LABEL, RUN_STATUS, formatDateTime, formatDuration, formatTime } from '../lib/format'
import { Badge, Flags, Price, Thumb } from '../components/Deal'
import { Empty, ErrorBox, Loading } from '../components/States'

export function Dashboard() {
  useTitle('Painel')
  const { version } = useRun()
  const { data, error, loading, reload } = useLoad(() => api.dashboard(), [version])

  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return null

  const { lastRun, nextRunAt, scheduleEnabled, counts, topDeals, stores, whatsapp } = data
  const waDown = whatsapp.autoSend && whatsapp.state !== 'WORKING'

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Painel</h1>
          <p className="lead">O que o PromoEye encontrou nas lojas confiáveis.</p>
        </div>
      </header>

      {waDown && (
        <div className="notice notice-warn" role="alert">
          <p>
            O envio automático está ligado, mas o WhatsApp não está conectado
            {whatsapp.state === 'UNREACHABLE' ? ' (o WAHA não respondeu)' : ''}. As promoções estão parando na fila
            {counts.queuedMessages > 0 ? ` (${counts.queuedMessages} agora)` : ''}.{' '}
            <Link to="/whatsapp">Conectar de novo</Link>
          </p>
        </div>
      )}

      <div className="grid grid-3">
        <section className="card" aria-labelledby="h-last-run">
          <h2 id="h-last-run">Última coleta</h2>
          {lastRun ? <RunSummary run={lastRun} /> : <p className="muted">Nenhuma coleta ainda. Clique em “Buscar agora”.</p>}
        </section>

        <section className="card" aria-labelledby="h-next">
          <h2 id="h-next">Próxima coleta</h2>
          {scheduleEnabled ? (
            nextRunAt ? (
              <>
                <p className="big-number">{formatTime(nextRunAt)}</p>
                <p className="muted">{formatDateTime(nextRunAt)} · de hora em hora</p>
              </>
            ) : (
              <p className="muted">Agendada de hora em hora.</p>
            )
          ) : (
            <p className="muted">
              A busca automática está desligada neste servidor (<code>COLLECT_ENABLED=false</code>). “Buscar agora” continua
              funcionando.
            </p>
          )}
        </section>

        <section className="card" aria-labelledby="h-numbers">
          <h2 id="h-numbers">Em números</h2>
          <dl className="stats">
            <div>
              <dt>Itens ativos</dt>
              <dd>
                {counts.activeItems} <span className="muted small">de {counts.items}</span>
              </dd>
            </div>
            <div>
              <dt>Anúncios acompanhados</dt>
              <dd>{counts.offers}</dd>
            </div>
            <div>
              <dt>Promoções agora</dt>
              <dd>{counts.deals}</dd>
            </div>
            <div>
              <dt>Mensagens para enviar</dt>
              <dd>{counts.draftMessages > 0 ? <Link to="/whatsapp">{counts.draftMessages}</Link> : 0}</dd>
            </div>
            {(whatsapp.autoSend || counts.queuedMessages > 0) && (
              <div>
                <dt>Na fila do WhatsApp</dt>
                <dd>{counts.queuedMessages}</dd>
              </div>
            )}
            <div>
              <dt>Cliques em 7 dias</dt>
              <dd>{counts.clicks7d}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="card" aria-labelledby="h-deals">
        <div className="card-head">
          <h2 id="h-deals">Melhores promoções agora</h2>
          <Link to="/ofertas?deals=1">Ver todas as promoções</Link>
        </div>
        {topDeals.length ? (
          <ul className="deal-grid">
            {topDeals.map((o) => (
              <li key={o.id} className="deal-tile">
                <Thumb src={o.imageUrl} size={96} />
                <div className="deal-tile-body">
                  <p className="offer-meta">
                    <strong>{o.storeName}</strong> · <Link to={`/itens/${o.watchItemId}`}>{o.watchItemName}</Link>
                  </p>
                  <p className="deal-tile-title">{o.title}</p>
                  <Price price={o.price} listPrice={o.listPrice} flags={o.flags} />
                  <Flags flags={o.flags} max={2} hideShortHistory />
                  <a className="btn btn-sm btn-ghost" href={o.outboundUrl} target="_blank" rel="noopener noreferrer">
                    Abrir na loja
                  </a>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Nenhuma promoção por enquanto">
            Uma oferta vira promoção quando fica abaixo do seu preço-alvo, bate o menor preço que já vimos ou fica bem abaixo do
            preço normal dos últimos 30 dias. Nos primeiros dias o histórico ainda é curto.
          </Empty>
        )}
      </section>

      <section className="card" aria-labelledby="h-stores">
        <div className="card-head">
          <h2 id="h-stores">Saúde das lojas</h2>
          <Link to="/lojas">Configurar lojas</Link>
        </div>
        <StoreHealth stores={stores} />
      </section>
    </div>
  )
}

function RunSummary({ run }: { run: RunDTO }) {
  const s = RUN_STATUS[run.status]
  const took = run.finishedAt ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime() : null
  return (
    <div className="run-summary">
      <p>
        <Badge tone={s.tone}>{s.label}</Badge> <span className="muted">{timeAgo(run.startedAt)}</span>
        {took !== null && <span className="muted"> · levou {formatDuration(took)}</span>}
      </p>
      <dl className="stats stats-compact">
        <div>
          <dt>Anúncios vistos</dt>
          <dd>{run.offersSeen}</dd>
        </div>
        <div>
          <dt>Novos</dt>
          <dd>{run.offersNew}</dd>
        </div>
        <div>
          <dt>Mudanças de preço</dt>
          <dd>{run.priceChanges}</dd>
        </div>
        <div>
          <dt>Promoções novas</dt>
          <dd>{run.newDeals}</dd>
        </div>
      </dl>
      {run.errors.length > 0 && (
        <details className="run-errors">
          <summary>
            {run.errors.length === 1 ? '1 falha' : `${run.errors.length} falhas`} nesta coleta
          </summary>
          <ul>
            {run.errors.slice(0, 40).map((e, i) => (
              <li key={i}>
                {[e.store, e.item].filter(Boolean).join(' · ')}
                {(e.store || e.item) && ': '}
                {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function StoreHealth({ stores }: { stores: StoreDTO[] }) {
  if (!stores.length) return <p className="muted">Nenhuma loja cadastrada. Rode o seed do banco.</p>
  return (
    <table className="rtable">
      <thead>
        <tr>
          <th scope="col">Loja</th>
          <th scope="col">Coleta</th>
          <th scope="col">Último sucesso</th>
          <th scope="col">Último erro</th>
        </tr>
      </thead>
      <tbody>
        {stores.map((s) => {
          const failing = s.lastErrorAt && (!s.lastOkAt || new Date(s.lastErrorAt) > new Date(s.lastOkAt))
          return (
            <tr key={s.id}>
              <td data-label="Loja">
                <strong>{s.name}</strong>
                {!s.enabled && (
                  <>
                    {' '}
                    <Badge tone="neutral">desligada</Badge>
                  </>
                )}
              </td>
              <td data-label="Coleta">
                {s.adapter === 'MANUAL' ? (
                  <Badge tone="neutral">manual</Badge>
                ) : failing ? (
                  <Badge tone="warn">com erro</Badge>
                ) : s.lastOkAt ? (
                  <Badge tone="good">ok</Badge>
                ) : (
                  <span className="muted">{ADAPTER_LABEL[s.adapter]}</span>
                )}
              </td>
              <td data-label="Último sucesso">{s.adapter === 'MANUAL' ? '—' : s.lastOkAt ? timeAgo(s.lastOkAt) : 'nunca'}</td>
              <td data-label="Último erro">
                {s.lastErrorAt ? (
                  <span>
                    {timeAgo(s.lastErrorAt)}
                    {s.lastError && <span className="muted small"> · {s.lastError}</span>}
                  </span>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
