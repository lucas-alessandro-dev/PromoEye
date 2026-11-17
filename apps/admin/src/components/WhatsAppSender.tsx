import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { formatPhone, senderSettingsInput, type SenderSettings, type WhatsAppStatusDTO } from '@promoeye/shared'
import { ApiError, api, errorMessage } from '../api'
import { useToast } from '../context/toast'
import { formatDateTime } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { Badge } from './Deal'
import { SelectField, Switch, TextField } from './Fields'
import { Loading } from './States'

/**
 * Envio automático para o grupo, pelo WAHA (gratuito, roda na própria VPS).
 * Três passos: conectar o número (QR code ou código), escolher o grupo,
 * ligar o envio. A fila respeita limite por hora e horário de silêncio.
 */

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`

const STATE_BADGE: Record<WhatsAppStatusDTO['state'], { label: string; tone: 'good' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  UNCONFIGURED: { label: 'não configurado', tone: 'neutral' },
  UNREACHABLE: { label: 'sem resposta', tone: 'danger' },
  NO_SESSION: { label: 'desconectado', tone: 'neutral' },
  STOPPED: { label: 'desconectado', tone: 'neutral' },
  STARTING: { label: 'iniciando', tone: 'info' },
  SCAN_QR_CODE: { label: 'esperando o QR code', tone: 'warn' },
  WORKING: { label: 'conectado', tone: 'good' },
  FAILED: { label: 'desconectado', tone: 'warn' },
}

export function WhatsAppSender({
  status,
  onStatus,
  onRetry,
}: {
  status: WhatsAppStatusDTO
  onStatus: (s: WhatsAppStatusDTO) => void
  onRetry: () => void
}) {
  const { toast } = useToast()
  const prev = useRef(status.state)

  // Conectando: confere o estado a cada 3 s até o celular ler o código.
  const waiting = status.state === 'STARTING' || status.state === 'SCAN_QR_CODE'
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => {
      api.whatsappStatus().then(onStatus).catch(() => undefined)
    }, 3000)
    return () => clearInterval(t)
  }, [waiting, onStatus])

  useEffect(() => {
    if (status.state === 'WORKING' && (prev.current === 'SCAN_QR_CODE' || prev.current === 'STARTING')) {
      toast('WhatsApp conectado.')
    }
    prev.current = status.state
  }, [status.state, toast])

  const badge = STATE_BADGE[status.state]

  return (
    <section className="card" aria-labelledby="h-auto-send">
      <div className="card-head">
        <h2 id="h-auto-send">Envio automático para o grupo</h2>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      {status.state === 'UNCONFIGURED' && (
        <div className="notice notice-warn">
          <p>
            O servidor não tem o WAHA configurado (<code>WAHA_URL</code> e <code>WAHA_API_KEY</code>). Na VPS ele já sobe junto
            com o deploy. No computador, rode <code>docker compose up -d waha</code> e preencha as duas variáveis no{' '}
            <code>.env</code> (modelo em <code>.env.example</code>).
          </p>
        </div>
      )}

      {status.state === 'UNREACHABLE' && (
        <div className="notice notice-warn" role="alert">
          <p>Não consegui falar com o WAHA: {status.error}</p>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onRetry}>
            Tentar de novo
          </button>
        </div>
      )}

      {(status.state === 'NO_SESSION' || status.state === 'STOPPED' || status.state === 'FAILED') && (
        <Disconnected status={status} onStatus={onStatus} />
      )}

      {status.state === 'STARTING' && <Loading label="Iniciando a conexão com o WhatsApp…" />}

      {status.state === 'SCAN_QR_CODE' && <ScanQr />}

      {status.state === 'WORKING' && <Connected status={status} onStatus={onStatus} />}
    </section>
  )
}

function Disconnected({ status, onStatus }: { status: WhatsAppStatusDTO; onStatus: (s: WhatsAppStatusDTO) => void }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const connect = async () => {
    setBusy(true)
    try {
      onStatus(await api.whatsappConnect())
    } catch (err) {
      toast(errorMessage(err), 'danger')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {status.error && <p className="store-error small">{status.error}</p>}
      <p>
        Conecte o número que vai postar as promoções. Ele precisa estar no grupo (e, se só admins podem mandar mensagem, ser
        admin). O ideal é um chip só para isso: número comum que manda mensagem demais pode ser bloqueado pelo WhatsApp, e é
        melhor que não seja o seu.
      </p>
      {status.settings.groupName && (
        <p className="muted small">Grupo escolhido: {status.settings.groupName}. As mensagens esperam na fila até reconectar.</p>
      )}
      <div className="row-actions">
        <button type="button" className="btn btn-primary" onClick={() => void connect()} disabled={busy}>
          {busy ? 'Conectando…' : 'Conectar WhatsApp'}
        </button>
      </div>
    </>
  )
}

function ScanQr() {
  const { toast } = useToast()
  const [qr, setQr] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // O código muda a cada ~20 s; buscar de 8 em 8 mantém a imagem válida.
  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .whatsappQr()
        .then((r) => {
          if (!alive) return
          setQr(r.image)
          setQrError(null)
        })
        .catch((err: unknown) => alive && setQrError(errorMessage(err)))
    void load()
    const t = setInterval(load, 8000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const pair = async () => {
    setBusy(true)
    try {
      const r = await api.whatsappPair(phone)
      setCode(r.code)
    } catch (err) {
      toast(errorMessage(err), 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wa-connect">
      <div className="qr-box">
        {qr ? (
          <img src={qr} alt="QR code para conectar o WhatsApp" width={240} height={240} />
        ) : qrError ? (
          <p className="store-error small">{qrError}</p>
        ) : (
          <Loading label="Gerando o QR code…" />
        )}
      </div>
      <div>
        <ol className="wa-steps">
          <li>Abra o WhatsApp no celular do número que vai postar.</li>
          <li>
            Toque em <strong>Aparelhos conectados</strong> › <strong>Conectar um aparelho</strong>.
          </li>
          <li>Aponte a câmera para este código. Ele muda sozinho a cada 20 segundos.</li>
        </ol>
        <details className="wa-pair">
          <summary>Está no mesmo celular? Conecte com o número de telefone</summary>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              void pair()
            }}
          >
            <TextField
              label="Número com DDI e DDD"
              inputMode="tel"
              autoComplete="tel"
              placeholder="55 11 91234-5678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy || phone.replace(/\D/g, '').length < 12}>
              Gerar código
            </button>
          </form>
          {code && (
            <p>
              No celular, em <strong>Conectar um aparelho</strong>, toque em <strong>Conectar com número de telefone</strong> e
              digite: <span className="pair-code">{code}</span>
            </p>
          )}
        </details>
      </div>
    </div>
  )
}

type Errors = Partial<Record<string, string>>

function Connected({ status, onStatus }: { status: WhatsAppStatusDTO; onStatus: (s: WhatsAppStatusDTO) => void }) {
  const { toast } = useToast()
  const groups = useLoad(() => api.whatsappGroups(), [])
  const [form, setForm] = useState<SenderSettings>(status.settings)
  const [maxStr, setMaxStr] = useState(String(status.settings.maxPerHour))
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState<null | 'save' | 'me' | 'group' | 'logout'>(null)

  const set = <K extends keyof SenderSettings>(k: K, v: SenderSettings[K]) => setForm((f) => ({ ...f, [k]: v }))
  const dirty =
    JSON.stringify({ ...form, maxPerHour: maxStr }) !== JSON.stringify({ ...status.settings, maxPerHour: String(status.settings.maxPerHour) })

  const save = async () => {
    const parsed = senderSettingsInput.safeParse({ ...form, maxPerHour: maxStr.trim() })
    if (!parsed.success) {
      const next: Errors = {}
      for (const i of parsed.error.issues) next[i.path.join('.')] ??= i.message
      setErrors(next)
      return
    }
    if (parsed.data.autoSend && !parsed.data.groupId) {
      setErrors({ groupId: 'Escolha o grupo antes de ligar o envio automático' })
      return
    }
    setErrors({})
    setBusy('save')
    try {
      const saved = await api.saveSender(parsed.data)
      onStatus(saved)
      setForm(saved.settings)
      setMaxStr(String(saved.settings.maxPerHour))
      toast(saved.settings.autoSend ? 'Salvo. As próximas promoções vão sozinhas para o grupo.' : 'Salvo.')
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) {
        const next: Errors = {}
        for (const i of err.issues) next[i.path] = i.message
        setErrors(next)
      }
      toast(errorMessage(err), 'danger')
    } finally {
      setBusy(null)
    }
  }

  const test = async (target: 'me' | 'group') => {
    if (target === 'group' && !window.confirm(`Todo mundo em “${status.settings.groupName}” vai ver a mensagem de teste. Enviar?`)) return
    setBusy(target)
    try {
      await api.whatsappTest(target)
      toast(target === 'me' ? 'Teste enviado. Confira na conversa com você mesmo.' : 'Teste enviado ao grupo.')
    } catch (err) {
      toast(errorMessage(err), 'danger')
    } finally {
      setBusy(null)
    }
  }

  const logout = async () => {
    if (!window.confirm('Desconectar este número? Para voltar, vai ser preciso ler o QR code de novo.')) return
    setBusy('logout')
    try {
      onStatus(await api.whatsappLogout())
      toast('WhatsApp desconectado.')
    } catch (err) {
      toast(errorMessage(err), 'danger')
    } finally {
      setBusy(null)
    }
  }

  const known = groups.data?.some((g) => g.id === form.groupId)
  const q = status.queue
  const s = status.settings

  return (
    <>
      <p>
        Conectado como <strong>{status.pushName ?? 'sem nome'}</strong>
        {status.phone && (
          <>
            {' '}
            <span className="nowrap">({formatPhone(status.phone)})</span>
          </>
        )}
        .{' '}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void logout()} disabled={busy !== null}>
          Desconectar
        </button>
      </p>

      <p className="muted small" aria-live="polite">
        {q.queued} na fila · {q.sentLastHour} enviada{q.sentLastHour === 1 ? '' : 's'} na última hora (limite {s.maxPerHour})
        {q.failed > 0 && <> · {q.failed} com erro</>}
        {status.quietNow && <> · horário de silêncio agora: a fila volta a andar às {hh(s.quietEnd)}</>}
        {status.quietOff?.active && s.quietHours && (
          <> · Black Friday: horário de silêncio suspenso até {formatDateTime(status.quietOff.until)}</>
        )}
        {s.autoSend && !s.groupId && <> · escolha o grupo para o envio começar</>}
      </p>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="form-grid">
          <div className="span-2">
            <SelectField
              label="Grupo"
              value={form.groupId}
              error={errors.groupId}
              disabled={groups.loading && !groups.data}
              onChange={(e) => {
                const g = groups.data?.find((x) => x.id === e.target.value)
                setForm((f) => ({ ...f, groupId: e.target.value, groupName: g?.name ?? '' }))
              }}
              hint={
                groups.error ? (
                  <>
                    Não deu para listar os grupos: {errorMessage(groups.error)}{' '}
                    <button type="button" className="btn btn-sm btn-ghost" onClick={groups.reload}>
                      Tentar de novo
                    </button>
                  </>
                ) : (
                  <>
                    Os grupos em que este número está.{' '}
                    <button type="button" className="btn btn-sm btn-ghost" onClick={groups.reload} disabled={groups.loading}>
                      {groups.loading ? 'Carregando…' : 'Atualizar lista'}
                    </button>
                  </>
                )
              }
            >
              <option value="">{groups.loading && !groups.data ? 'Carregando os grupos…' : 'Escolha o grupo…'}</option>
              {form.groupId && groups.data && !known && (
                <option value={form.groupId}>{form.groupName || form.groupId} (não aparece mais na lista)</option>
              )}
              {groups.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="span-2">
            <Switch
              label="Enviar sozinho as promoções novas"
              checked={form.autoSend}
              onChange={(v) => set('autoSend', v)}
              hint={
                <>
                  Desligado, as mensagens ficam em “Para enviar” para você revisar. Ligado, vão direto para a fila e saem uma por
                  vez. Antes de cada envio o PromoEye confere se o preço não subiu e se o anúncio ainda existe. Depende de “Gerar
                  mensagem” em <Link to="/configuracoes">Configurações</Link>, que é ligado junto.
                </>
              }
            />
          </div>

          <div className="span-2">
            <Switch
              label="Mandar com a foto do produto"
              checked={form.withImage}
              onChange={(v) => set('withImage', v)}
              hint="A foto vai com o texto na legenda. Sem foto (ou se a loja não deixar baixar a imagem), vai só o texto com a prévia do link."
            />
          </div>

          <TextField
            label="Máximo por hora"
            inputMode="numeric"
            value={maxStr}
            onChange={(e) => setMaxStr(e.target.value)}
            error={errors.maxPerHour}
            hint="De 1 a 30. Entre uma mensagem e outra há pelo menos 1 minuto. Mandar pouco protege o número de bloqueio."
          />
          <div />

          <div className="span-2">
            <Switch
              label="Horário de silêncio"
              checked={form.quietHours}
              onChange={(v) => set('quietHours', v)}
              hint={
                'Nesse intervalo nada sai (horário de Brasília). Promoção que surgir fica na fila e sai depois, se o preço continuar valendo.' +
                (status.quietOff
                  ? ` Na Black Friday o silêncio fica suspenso de ${formatDateTime(status.quietOff.from)} a ${formatDateTime(status.quietOff.until)} (QUIET_OFF_* no servidor).`
                  : '')
              }
            />
          </div>
          {form.quietHours && (
            <>
              <SelectField label="Das" value={String(form.quietStart)} onChange={(e) => set('quietStart', Number(e.target.value))}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Até" value={String(form.quietEnd)} onChange={(e) => set('quietEnd', Number(e.target.value))}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </SelectField>
            </>
          )}
        </div>

        <div className="row-actions">
          <button type="submit" className="btn btn-primary" disabled={busy !== null || !dirty}>
            {busy === 'save' ? 'Salvando…' : 'Salvar envio automático'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void test('me')} disabled={busy !== null}>
            {busy === 'me' ? 'Enviando…' : 'Enviar teste para mim'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void test('group')}
            disabled={busy !== null || !s.groupId || dirty}
            title={!s.groupId ? 'Escolha e salve o grupo primeiro' : dirty ? 'Salve antes de testar' : undefined}
          >
            {busy === 'group' ? 'Enviando…' : 'Enviar teste no grupo'}
          </button>
        </div>
      </form>
    </>
  )
}
