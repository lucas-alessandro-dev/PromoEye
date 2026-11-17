import { useState } from 'react'
import { manualOfferInput, type OfferDTO, type StoreDTO, type WatchItemDTO } from '@promoeye/shared'
import { ApiError, api, errorMessage } from '../api'
import { moneyInput } from '../lib/format'
import { SelectField, TextField } from './Fields'
import { Modal } from './Modal'

type Errors = Partial<Record<string, string>>

const FIELD_MESSAGES: Record<string, string> = {
  price: 'Informe o preço em reais, por exemplo 4199,90',
  listPrice: 'Use um valor em reais ou deixe em branco',
  url: 'Cole o link do produto (https://…)',
  title: 'Escreva o nome do produto como aparece na loja',
  watchItemId: 'Escolha o item',
  storeId: 'Escolha a loja',
  gtin: 'EAN inválido: confira os dígitos do código de barras (ou deixe em branco)',
}

/**
 * Oferta adicionada à mão — para as lojas que bloqueiam robôs (Mercado Livre,
 * Magalu, Casas Bahia) ou para um achado avulso. Ela entra na comparação
 * entre lojas e na vitrine como qualquer outra.
 */
export function ManualOfferModal({
  items,
  stores,
  defaultItemId,
  onClose,
  onCreated,
}: {
  items: WatchItemDTO[]
  stores: StoreDTO[]
  defaultItemId?: string
  onClose: () => void
  onCreated: (o: OfferDTO) => void
}) {
  // Lojas manuais primeiro: é para elas que este formulário existe.
  const sortedStores = [...stores].sort((a, b) => Number(b.adapter === 'MANUAL') - Number(a.adapter === 'MANUAL'))
  const [form, setForm] = useState({
    watchItemId: defaultItemId ?? items[0]?.id ?? '',
    storeId: sortedStores[0]?.id ?? '',
    title: '',
    url: '',
    affiliateUrl: '',
    imageUrl: '',
    price: '',
    listPrice: '',
    sellerName: '',
    gtin: '',
  })
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    setFormError(null)
    const parsed = manualOfferInput.safeParse({
      ...form,
      price: moneyInput(form.price),
      listPrice: moneyInput(form.listPrice),
      sellerName: form.sellerName || null,
      gtin: form.gtin.trim() || null,
    })
    if (!parsed.success) {
      const next: Errors = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '')
        if (!next[key]) next[key] = FIELD_MESSAGES[key] ?? issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    setBusy(true)
    try {
      onCreated(await api.manualOffer(parsed.data))
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) {
        const next: Errors = {}
        for (const i of err.issues) next[i.path.split('.')[0] ?? i.path] = i.message
        setErrors(next)
      } else {
        setFormError(errorMessage(err))
      }
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Adicionar oferta manual"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="manual-offer" className="btn btn-primary" disabled={busy}>
            {busy ? 'Salvando…' : 'Adicionar oferta'}
          </button>
        </>
      }
    >
      <p>
        Mercado Livre, Magazine Luiza e Casas Bahia bloqueiam robôs, então o PromoEye não busca nelas sozinho. Achou uma
        promoção lá? Cole aqui com o seu link de afiliado. O preço não se atualiza sozinho: oculte ou exclua quando acabar.
      </p>
      {items.length === 0 ? (
        <p className="state-error-inline">Crie um item acompanhado antes de adicionar ofertas.</p>
      ) : (
        <form
          id="manual-offer"
          className="form-grid"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <SelectField label="Item" value={form.watchItemId} onChange={set('watchItemId')} error={errors.watchItemId}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Loja" value={form.storeId} onChange={set('storeId')} error={errors.storeId}>
            {sortedStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.adapter === 'MANUAL' ? ' (manual)' : ''}
              </option>
            ))}
          </SelectField>
          <div className="span-2">
            <TextField label="Nome do produto" value={form.title} onChange={set('title')} error={errors.title} maxLength={300} />
          </div>
          <div className="span-2">
            <TextField label="Link do produto" type="url" inputMode="url" placeholder="https://" value={form.url} onChange={set('url')} error={errors.url} />
          </div>
          <div className="span-2">
            <TextField
              label="Link de afiliado (opcional)"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={form.affiliateUrl}
              onChange={set('affiliateUrl')}
              error={errors.affiliateUrl}
              hint="O clique na vitrine e no WhatsApp vai por este link."
            />
          </div>
          <TextField label="Preço à vista" inputMode="decimal" placeholder="4199,90" value={form.price} onChange={set('price')} error={errors.price} />
          <TextField
            label="Preço “de” (opcional)"
            inputMode="decimal"
            placeholder="5999,00"
            value={form.listPrice}
            onChange={set('listPrice')}
            error={errors.listPrice}
          />
          <TextField
            label="EAN (código de barras, opcional)"
            inputMode="numeric"
            placeholder="7891234567895"
            value={form.gtin}
            onChange={set('gtin')}
            error={errors.gtin}
            hint="Está na ficha técnica da loja. Com ele, a oferta entra no catálogo ao lado das mesmas ofertas das outras lojas."
            maxLength={20}
          />
          <TextField label="Vendedor (opcional)" value={form.sellerName} onChange={set('sellerName')} error={errors.sellerName} hint="Ex.: Loja oficial Samsung" />
          <TextField
            label="Foto (opcional)"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={form.imageUrl}
            onChange={set('imageUrl')}
            error={errors.imageUrl}
            hint="Clique com o botão direito na foto da loja › Copiar endereço da imagem."
          />
          {formError && (
            <p className="field-error span-2" role="alert">
              {formError}
            </p>
          )}
        </form>
      )}
    </Modal>
  )
}
