import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { formatBRL, timeAgo } from '@promoeye/shared'
import { api } from '../api'
import { useRun } from '../context/run'
import { useToast } from '../context/toast'
import { useLoad, useTitle } from '../lib/hooks'
import { Badge } from '../components/Deal'
import { ManualOfferModal } from '../components/ManualOfferForm'
import { OfferList } from '../components/OfferList'
import { Empty, ErrorBox, Loading } from '../components/States'
import { StepChart, type ChartPoint } from '../components/StepChart'

export function ItemDetail() {
  const { id = '' } = useParams()
  const { version, start, phase } = useRun()
  const { toast } = useToast()
  const [includeOld, setIncludeOld] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)

  const item = useLoad(() => api.item(id), [id, version])
  const snaps = useLoad(() => api.snapshots(id, 30), [id, version])
  const offers = useLoad(() => api.offers({ itemId: id, limit: 100, fresh: !includeOld, hidden: true }), [id, version, includeOld])
  const stores = useLoad(() => api.stores(), [])
  useTitle(item.data?.name ?? 'Item')

  if (item.loading && !item.data) return <Loading />
  if (item.error && !item.data) return <ErrorBox error={item.error} onRetry={item.reload} />
  const it = item.data
  if (!it) return null

  const running = phase === 'running' || phase === 'starting'
  const points: ChartPoint[] = (snaps.data ?? []).map((s) => ({ t: new Date(s.at).getTime(), v: s.minPrice }))

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="crumbs">
            <Link to="/itens">Itens</Link>
          </p>
          <h1>
            {it.name} {!it.active && <Badge tone="neutral">pausado</Badge>}
          </h1>
          <p className="lead">
            Busca “{it.query}” · {it.storeIds.length ? `${it.storeIds.length} lojas escolhidas` : 'todas as lojas'} · última coleta{' '}
            {timeAgo(it.lastRunAt)}
          </p>
        </div>
        <div className="head-actions">
          <a className="btn btn-ghost" href={`/ofertas/${it.slug}`} target="_blank" rel="noopener">
            Ver na vitrine
          </a>
          <Link className="btn btn-ghost" to={`/itens/${it.id}/editar`}>
            Editar
          </Link>
          <button type="button" className="btn btn-primary" disabled={running || !it.active} onClick={() => void start([it.id])}>
            Buscar este item
          </button>
        </div>
      </header>

      <div className="grid grid-3">
        <section className="card" aria-labelledby="h-best">
          <h2 id="h-best">Melhor preço agora</h2>
          {it.best ? (
            <>
              <p className="big-number">{formatBRL(it.best.price)}</p>
              <p className="muted">{it.best.storeName}</p>
              {it.targetPrice !== null && it.best.price <= it.targetPrice && <Badge tone="good">abaixo do alvo</Badge>}
            </>
          ) : (
            <p className="muted">Nenhum anúncio disponível ainda.</p>
          )}
        </section>
        <section className="card" aria-labelledby="h-target">
          <h2 id="h-target">Preço-alvo</h2>
          {it.targetPrice !== null ? (
            <>
              <p className="big-number">{formatBRL(it.targetPrice)}</p>
              {it.best && (
                <p className="muted">
                  {it.best.price <= it.targetPrice
                    ? `${formatBRL(it.targetPrice - it.best.price)} abaixo do alvo`
                    : `faltam ${formatBRL(it.best.price - it.targetPrice)}`}
                </p>
              )}
            </>
          ) : (
            <p className="muted">
              Sem preço-alvo. <Link to={`/itens/${it.id}/editar`}>Definir</Link>
            </p>
          )}
        </section>
        <section className="card" aria-labelledby="h-count">
          <h2 id="h-count">Anúncios</h2>
          <p className="big-number">{it.offerCount}</p>
          <p className="muted">{it.dealCount === 1 ? '1 promoção agora' : `${it.dealCount} promoções agora`}</p>
        </section>
      </div>

      <section className="card" aria-labelledby="h-chart">
        <h2 id="h-chart">Menor preço entre as lojas, por coleta (30 dias)</h2>
        {snaps.loading && !snaps.data && <Loading />}
        {snaps.error ? <ErrorBox error={snaps.error} onRetry={snaps.reload} /> : null}
        {snaps.data && <StepChart points={points} target={it.targetPrice} label={`Menor preço de ${it.name}`} />}
      </section>

      <section className="card" aria-labelledby="h-offers">
        <div className="card-head">
          <h2 id="h-offers">Ofertas deste item</h2>
          <div className="head-actions">
            <label className="check">
              <input type="checkbox" checked={includeOld} onChange={(e) => setIncludeOld(e.target.checked)} />
              <span>Incluir anúncios antigos</span>
            </label>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setManualOpen(true)}>
              Adicionar oferta manual
            </button>
          </div>
        </div>
        {offers.loading && !offers.data && <Loading />}
        {offers.error ? <ErrorBox error={offers.error} onRetry={offers.reload} /> : null}
        {offers.data && offers.data.rows.length === 0 && (
          <Empty title="Nenhuma oferta">
            {it.lastRunAt
              ? 'A última coleta não achou anúncios que passassem nos filtros. Use “Testar busca” na edição para ver o que ficou de fora.'
              : 'Este item ainda não passou por uma coleta. Clique em “Buscar este item”.'}
          </Empty>
        )}
        {offers.data && offers.data.rows.length > 0 && (
          <OfferList
            rows={offers.data.rows}
            showItem={false}
            onChange={(o) => offers.setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.id === o.id ? o : r)) } : d))}
            onRemove={(rid) => offers.setData((d) => (d ? { total: d.total - 1, rows: d.rows.filter((r) => r.id !== rid) } : d))}
          />
        )}
      </section>

      {manualOpen && stores.data && (
        <ManualOfferModal
          items={[it]}
          stores={stores.data}
          defaultItemId={it.id}
          onClose={() => setManualOpen(false)}
          onCreated={(o) => {
            setManualOpen(false)
            toast('Oferta adicionada.')
            offers.setData((d) => (d ? { total: d.total + 1, rows: [o, ...d.rows] } : d))
          }}
        />
      )}
    </div>
  )
}
