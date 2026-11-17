import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { settingsInput, type SettingsInput } from '@promoeye/shared'
import { ApiError, api, errorMessage } from '../api'
import { useToast } from '../context/toast'
import { useLoad, useTitle } from '../lib/hooks'
import { ChipsInput, Switch, TextArea, TextField } from '../components/Fields'
import { ErrorBox, Loading } from '../components/States'

type Errors = Partial<Record<string, string>>

const FIELD_MESSAGES: Record<string, string> = {
  siteTitle: 'Use de 2 a 60 caracteres',
  defaultMinDiscountPct: 'Use um número de 0 a 95, sem o %',
  'whatsapp.groupInviteUrl': 'Use um convite https://chat.whatsapp.com/...',
}

export function Settings() {
  useTitle('Configurações')
  const { toast } = useToast()
  const { data, error, loading, reload } = useLoad(() => api.settings(), [])
  const [form, setForm] = useState<SettingsInput | null>(null)
  const [pct, setPct] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (data) {
      setForm(data)
      setPct(String(data.defaultMinDiscountPct))
    }
  }, [data])

  if (loading && !data) return <Loading />
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />
  if (!form) return null

  const set = <K extends keyof SettingsInput>(k: K, v: SettingsInput[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const setWa = <K extends keyof SettingsInput['whatsapp']>(k: K, v: SettingsInput['whatsapp'][K]) =>
    setForm((f) => (f ? { ...f, whatsapp: { ...f.whatsapp, [k]: v } } : f))

  const save = async () => {
    setFormError(null)
    const parsed = settingsInput.safeParse({ ...form, defaultMinDiscountPct: pct.replace('%', '').trim() })
    if (!parsed.success) {
      const next: Errors = {}
      for (const i of parsed.error.issues) {
        const key = i.path.join('.')
        if (!next[key]) next[key] = FIELD_MESSAGES[key] ?? i.message
      }
      setErrors(next)
      setFormError('Confira os campos marcados.')
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const saved = await api.saveSettings(parsed.data)
      setForm(saved)
      setPct(String(saved.defaultMinDiscountPct))
      toast('Configurações salvas.')
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) {
        const next: Errors = {}
        for (const i of err.issues) next[i.path] = i.message
        setErrors(next)
      }
      setFormError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Configurações</h1>
          <p className="lead">Valem para todos os itens e lojas.</p>
        </div>
      </header>

      <form
        className="settings-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <section className="card" aria-labelledby="h-site">
          <h2 id="h-site">Vitrine</h2>
          <div className="form-grid">
            <TextField label="Título do site" value={form.siteTitle} onChange={(e) => set('siteTitle', e.target.value)} error={errors.siteTitle} maxLength={60} />
            <div />
            <Switch
              label="Vitrine aberta ao público"
              checked={form.publicSite}
              onChange={(v) => set('publicSite', v)}
              hint="Desligada, só quem está logado no painel vê as promoções."
            />
            <Switch
              label="Deixar o Google indexar"
              checked={form.allowIndexing}
              onChange={(v) => set('allowIndexing', v)}
              hint="Ligue quando a vitrine estiver no domínio definitivo."
            />
            <div className="span-2">
              <TextArea
                label="Aviso de afiliado"
                value={form.affiliateDisclosure}
                onChange={(e) => set('affiliateDisclosure', e.target.value)}
                error={errors.affiliateDisclosure}
                rows={3}
                maxLength={400}
                hint="Aparece no rodapé da vitrine. O CONAR pede que publicidade seja identificada como tal."
              />
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="h-filters">
          <h2 id="h-filters">Filtros</h2>
          <div className="form-grid">
            <TextField
              label="Desconto real mínimo padrão (%)"
              inputMode="numeric"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              error={errors.defaultMinDiscountPct}
              hint="Usado pelos itens sem valor próprio. Medido contra o preço normal dos últimos 30 dias, não contra o “de” da loja."
            />
            <div />
            <div className="span-2">
              <ChipsInput
                label="Exclusões globais"
                values={form.globalExcludes}
                onChange={(v) => set('globalExcludes', v)}
                error={errors.globalExcludes}
                hint="Palavras que descartam o anúncio em todos os itens (capa, película, usado…). Não valem quando a própria busca usa a palavra: quem procura “capa iphone” quer capa."
              />
            </div>
            <div className="span-2">
              <ChipsInput
                label="Vendedores confiáveis"
                values={form.trustedSellers}
                onChange={(v) => set('trustedSellers', v)}
                error={errors.trustedSellers}
                hint="Vendedores de marketplace aceitos nas lojas em “Só a loja e vendedores confiáveis”. Casa por palavra inteira do nome: “iplace” aceita “Loja iPlace”."
              />
            </div>
            <div className="span-2">
              <ChipsInput
                label="Vendedores bloqueados"
                values={form.blockedSellers}
                onChange={(v) => set('blockedSellers', v)}
                error={errors.blockedSellers}
                hint="Nunca aparecem, em loja nenhuma."
              />
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="h-wa">
          <h2 id="h-wa">WhatsApp</h2>
          <div className="form-grid">
            <div className="span-2">
              <TextField
                label="Convite do grupo"
                type="url"
                inputMode="url"
                value={form.whatsapp.groupInviteUrl}
                onChange={(e) => setWa('groupInviteUrl', e.target.value)}
                error={errors['whatsapp.groupInviteUrl']}
                placeholder="https://chat.whatsapp.com/..."
                hint="Aparece na vitrine como “Entrar no grupo”. Deixe em branco para esconder."
              />
            </div>
            <div className="span-2">
              <Switch
                label="Gerar mensagem quando surgir promoção nova"
                checked={form.whatsapp.autoDraft}
                onChange={(v) => setWa('autoDraft', v)}
                hint={
                  <>
                    Uma mensagem por item, só da oferta mais barata e só quando o preço cai abaixo da última mensagem. Desligado,
                    o envio automático também para. Conexão do número e envio automático ficam em{' '}
                    <Link to="/whatsapp">WhatsApp</Link>.
                  </>
                }
              />
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="h-alerts">
          <h2 id="h-alerts">Alertas por e-mail</h2>
          <Switch
            label="Alertas por e-mail na vitrine"
            checked={form.alerts.enabled}
            onChange={(v) => setForm((f) => (f ? { ...f, alerts: { ...f.alerts, enabled: v } } : f))}
            hint={
              <>
                Mostra “Me avise quando baixar” nas páginas de item e de produto. Só aparece com o e-mail de saída configurado
                (SMTP_URL e SMTP_FROM no .env). Inscritos e exportação ficam em <Link to="/alertas">Alertas</Link>.
              </>
            }
          />
        </section>

        {formError && (
          <p className="field-error" role="alert">
            {formError}
          </p>
        )}
        <div className="form-actions sticky-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar configurações'}
          </button>
        </div>
      </form>
    </div>
  )
}
