import { Link } from 'react-router'
import { formatBRL, timeAgo } from '@promoeye/shared'
import { api } from '../api'
import { useRun } from '../context/run'
import { useLoad, useTitle } from '../lib/hooks'
import { Badge } from '../components/Deal'
import { Empty, ErrorBox, Loading } from '../components/States'

export function Items() {
  useTitle('Itens')
  const { version, start, phase } = useRun()
  const { data, error, loading, reload } = useLoad(() => api.items(), [version])
  const running = phase === 'running' || phase === 'starting'

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Itens acompanhados</h1>
          <p className="lead">O que o PromoEye procura de hora em hora em cada loja.</p>
        </div>
        <Link className="btn btn-primary" to="/itens/novo">
          Novo item
        </Link>
      </header>

      {loading && !data && <Loading />}
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : null}

      {data && data.length === 0 && (
        <Empty
          title="Nenhum item ainda"
          action={
            <Link className="btn btn-primary" to="/itens/novo">
              Acompanhar o primeiro item
            </Link>
          }
        >
          Diga o que você quer comprar na Black Friday (“iPhone 16 128GB”, “Air fryer Mondial 5L”, “RTX 5060”). O PromoEye busca
          nas lojas, descarta acessório e usado, e avisa quando o preço cai de verdade.
        </Empty>
      )}

      {data && data.length > 0 && (
        <table className="rtable items-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Melhor preço agora</th>
              <th scope="col">Anúncios</th>
              <th scope="col">Preço-alvo</th>
              <th scope="col">Última coleta</th>
              <th scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => {
              const hit = item.best && item.targetPrice !== null && item.best.price <= item.targetPrice
              return (
                <tr key={item.id} className={item.active ? '' : 'is-muted'}>
                  <td data-label="Item">
                    <Link to={`/itens/${item.id}`} className="strong-link">
                      {item.name}
                    </Link>
                    {!item.active && (
                      <>
                        {' '}
                        <Badge tone="neutral">pausado</Badge>
                      </>
                    )}
                    <span className="muted small block">busca: “{item.query}”</span>
                  </td>
                  <td data-label="Melhor preço agora">
                    {item.best ? (
                      <>
                        <strong className="num">{formatBRL(item.best.price)}</strong>
                        <span className="muted small block">{item.best.storeName}</span>
                        {hit && <Badge tone="good">abaixo do alvo</Badge>}
                      </>
                    ) : (
                      <span className="muted">nada encontrado</span>
                    )}
                  </td>
                  <td data-label="Anúncios">
                    {item.offerCount}
                    {item.dealCount > 0 && (
                      <>
                        {' '}
                        <Badge tone="good">{item.dealCount === 1 ? '1 promoção' : `${item.dealCount} promoções`}</Badge>
                      </>
                    )}
                  </td>
                  <td data-label="Preço-alvo">{item.targetPrice !== null ? formatBRL(item.targetPrice) : <span className="muted">—</span>}</td>
                  <td data-label="Última coleta">{timeAgo(item.lastRunAt)}</td>
                  <td data-label="Ações" className="cell-actions">
                    <Link className="btn btn-sm btn-ghost" to={`/itens/${item.id}/editar`}>
                      Editar
                    </Link>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={running || !item.active}
                      onClick={() => void start([item.id])}
                      title={item.active ? 'Busca só este item em todas as lojas' : 'Item pausado'}
                    >
                      Buscar este
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
