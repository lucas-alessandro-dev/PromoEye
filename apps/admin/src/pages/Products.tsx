import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { formatBRL, timeAgo, type OfferDTO, type ProductDTO } from '@promoeye/shared'
import { api, errorMessage } from '../api'
import { useRun } from '../context/run'
import { useToast } from '../context/toast'
import { useDebounced, useLoad, useTitle } from '../lib/hooks'
import { Badge, Thumb } from '../components/Deal'
import { TextField } from '../components/Fields'
import { OfferList } from '../components/OfferList'
import { Empty, ErrorBox, Loading } from '../components/States'

const PAGE = 60

/**
 * Catálogo: o mesmo produto (mesmo EAN) em lojas diferentes. Os produtos
 * nascem sozinhos na coleta, quando uma loja VTEX informa o código de barras.
 */
export function Products() {
  useTitle('Catálogo')
  const { version } = useRun()
  const { toast } = useToast()
  const [q, setQ] = useState('')
  const [multi, setMulti] = useState(false)
  const qDebounced = useDebounced(q, 350)
  const [rows, setRows] = useState<ProductDTO[]>([])
  const [loadingMore, setLoadingMore] = useState(false)

  const list = useLoad(() => api.listProducts({ q: qDebounced, multi, limit: PAGE }), [qDebounced, multi, version])

  useEffect(() => {
    if (list.data) setRows(list.data.products)
  }, [list.data])

  const total = list.data?.total ?? 0

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const more = await api.listProducts({ q: qDebounced, multi, limit: PAGE, offset: rows.length })
      setRows((r) => [...r, ...more.products.filter((m) => !r.some((x) => x.id === m.id))])
    } catch (err) {
      toast(errorMessage(err), 'danger')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Catálogo</h1>
          <p className="lead">
            {list.data
              ? `${list.data.multiStore} ${list.data.multiStore === 1 ? 'produto já comparado' : 'produtos já comparados'} em 2 lojas ou mais.`
              : 'O mesmo produto, pelo código de barras, em todas as lojas.'}
          </p>
        </div>
      </header>

      <p className="muted">
        Os produtos são criados sozinhos quando uma loja VTEX informa o EAN na busca. Ofertas sem EAN (Amazon, KaBuM!, manuais)
        entram ligando o EAN em <Link to="/ofertas">Ofertas</Link> › Mais › Ligar ao EAN.
      </p>

      <form className="card filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <TextField
          label="Buscar"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="nome, marca ou EAN"
          hint="Com 8 dígitos ou mais, busca pelo final do EAN."
        />
        <fieldset className="filter-checks">
          <legend className="sr-only">Opções</legend>
          <label className="check">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
            <span>Só com 2 lojas ou mais</span>
          </label>
        </fieldset>
      </form>

      <div aria-live="polite" className="sr-only">
        {list.data ? `${total} produtos encontrados` : ''}
      </div>

      {list.loading && !list.data && <Loading />}
      {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}

      {list.data && rows.length === 0 && (
        <Empty title={q || multi ? 'Nenhum produto com esses filtros' : 'Nenhum produto no catálogo ainda'}>
          {q || multi
            ? 'Tente outro termo ou desmarque “Só com 2 lojas ou mais”.'
            : 'Rode uma coleta: cada anúncio de loja VTEX com EAN válido vira (ou entra em) um produto.'}
        </Empty>
      )}

      {rows.length > 0 && (
        <>
          <p className="muted small">
            Mostrando {rows.length} de {total}
            {list.loading && ' · atualizando…'}
          </p>
          <table className="rtable products-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Foto</span>
                </th>
                <th scope="col">Produto</th>
                <th scope="col">EAN</th>
                <th scope="col">Lojas agora</th>
                <th scope="col">Menor preço</th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.availableCount ? '' : 'is-muted'}>
                  <td data-label="Foto" className="product-thumb-cell">
                    <Thumb src={p.imageUrl} size={48} />
                  </td>
                  <td data-label="Produto">
                    <Link to={`/catalogo/${p.id}`} className="strong-link">
                      {p.name}
                    </Link>
                    {(p.brand || p.category) && (
                      <span className="muted small block">{[p.brand, p.category].filter(Boolean).join(' · ')}</span>
                    )}
                  </td>
                  <td data-label="EAN" className="num nowrap">
                    {p.gtin}
                  </td>
                  <td data-label="Lojas agora">
                    {p.storeCount >= 2 ? (
                      <Badge tone="good">{p.storeCount} lojas</Badge>
                    ) : p.storeCount === 1 ? (
                      '1 loja'
                    ) : (
                      <span className="muted">nenhuma</span>
                    )}
                    <span className="muted small block">
                      {p.offerCount} {p.offerCount === 1 ? 'oferta ligada' : 'ofertas ligadas'}
                    </span>
                  </td>
                  <td data-label="Menor preço">
                    {p.minPrice !== null ? (
                      <>
                        <strong className="num">{formatBRL(p.minPrice)}</strong>
                        <span className="muted small block">{p.minStoreName}</span>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td data-label="Ações" className="cell-actions">
                    <a className="btn btn-sm btn-ghost" href={p.publicUrl} target="_blank" rel="noopener">
                      Ver na vitrine
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length < total && (
            <div className="load-more">
              <button type="button" className="btn btn-ghost" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? 'Carregando…' : `Carregar mais ${Math.min(PAGE, total - rows.length)}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function ProductDetail() {
  const { id = '' } = useParams()
  const { version } = useRun()
  const product = useLoad(() => api.getProduct(id), [id, version])
  const [offers, setOffers] = useState<OfferDTO[]>([])
  useTitle(product.data?.name ?? 'Produto')

  useEffect(() => {
    if (product.data) setOffers(product.data.offers)
  }, [product.data])

  if (product.loading && !product.data) return <Loading />
  if (product.error && !product.data) return <ErrorBox error={product.error} onRetry={product.reload} />
  const p = product.data
  if (!p) return null

  return (
    <div className="page">
      <header className="page-head">
        <div className="product-head">
          <Thumb src={p.imageUrl} size={72} />
          <div>
            <p className="crumbs">
              <Link to="/catalogo">Catálogo</Link>
            </p>
            <h1>{p.name}</h1>
            <p className="lead">
              EAN <span className="num">{p.gtin}</span>
              {p.brand && <> · {p.brand}</>}
              {p.category && <> · {p.category}</>} · no catálogo {timeAgo(p.createdAt)}
            </p>
          </div>
        </div>
        <div className="head-actions">
          <a className="btn btn-ghost" href={p.publicUrl} target="_blank" rel="noopener">
            Ver na vitrine
          </a>
        </div>
      </header>

      <section className="card" aria-labelledby="h-prod-stats">
        <h2 id="h-prod-stats" className="sr-only">
          Resumo
        </h2>
        <dl className="stats">
          <div>
            <dt>Menor preço agora</dt>
            <dd>{p.minPrice !== null ? formatBRL(p.minPrice) : '—'}</dd>
          </div>
          <div>
            <dt>Loja</dt>
            <dd>{p.minStoreName ?? '—'}</dd>
          </div>
          <div>
            <dt>Lojas com o produto agora</dt>
            <dd>{p.storeCount}</dd>
          </div>
          <div>
            <dt>Ofertas ligadas</dt>
            <dd>{p.offerCount}</dd>
          </div>
        </dl>
      </section>

      <h2 className="section-title">Ofertas deste EAN</h2>
      {offers.length === 0 ? (
        <Empty title="Nenhuma oferta ligada">Ligue ofertas sem EAN a este produto em Ofertas › Mais › Ligar ao EAN.</Empty>
      ) : (
        <OfferList
          rows={offers}
          onChange={(o) =>
            setOffers((list) => (o.productId === p.id ? list.map((x) => (x.id === o.id ? o : x)) : list.filter((x) => x.id !== o.id)))
          }
          onRemove={(oid) => setOffers((list) => list.filter((x) => x.id !== oid))}
        />
      )}
    </div>
  )
}
