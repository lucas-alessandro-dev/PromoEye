import { useState } from 'react'
import { telegramSettingsInput, type TelegramChatDTO, type TelegramSettings, type TelegramStatusDTO } from '@promoeye/shared'
import { ApiError, api, errorMessage } from '../api'
import { useToast } from '../context/toast'
import { formatDateTime } from '../lib/format'
import { Badge } from './Deal'
import { SelectField, Switch, TextField } from './Fields'

/**
 * Envio automático para o grupo ou canal do Telegram, por um bot oficial
 * (criado no @BotFather). Três passos: o token no servidor, o bot no grupo,
 * ligar o envio. A fila segue as mesmas regras da do WhatsApp.
 */

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`

const STATE_BADGE: Record<TelegramStatusDTO['state'], { label: string; tone: 'good' | 'warn' | 'danger' | 'neutral' }> = {
  UNCONFIGURED: { label: 'não configurado', tone: 'neutral' },
  INVALID_TOKEN: { label: 'token recusado', tone: 'danger' },
  UNREACHABLE: { label: 'sem resposta', tone: 'danger' },
  READY: { label: 'bot no ar', tone: 'good' },
}

const CHAT_TYPE: Record<TelegramChatDTO['type'], string> = { group: 'grupo', supergroup: 'grupo', channel: 'canal' }

export function TelegramSender({
  status,
  onStatus,
  onRetry,
}: {
  status: TelegramStatusDTO
  onStatus: (s: TelegramStatusDTO) => void
  onRetry: () => void
}) {
  const badge = STATE_BADGE[status.state]
  return (
    <section className="card" aria-labelledby="h-tg-send">
      <div className="card-head">
        <h2 id="h-tg-send">Envio automático para o Telegram</h2>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      {status.state === 'UNCONFIGURED' && (
        <div className="notice notice-warn">
          <ol className="wa-steps">
            <li>
              No Telegram, abra o <strong>@BotFather</strong>, mande <code>/newbot</code> e escolha o nome e o @ do bot. Ele
              mostra o token (<code>123456789:AA…</code>). Não compartilhe: quem tem o token posta em nome do bot.
            </li>
            <li>
              Na VPS, ponha <code>TELEGRAM_BOT_TOKEN=</code> com o token no <code>.env</code> e rode o deploy de novo. No
              computador, o mesmo no <code>.env</code> da raiz.
            </li>
            <li>Adicione o bot ao grupo (no canal, como administrador) e volte aqui para escolher onde ele posta.</li>
          </ol>
        </div>
      )}

      {(status.state === 'INVALID_TOKEN' || status.state === 'UNREACHABLE') && (
        <div className="notice notice-warn" role="alert">
          <p>
            {status.state === 'INVALID_TOKEN'
              ? 'O Telegram recusou o token. Confira o TELEGRAM_BOT_TOKEN no servidor (no @BotFather, /mybots › API Token).'
              : `Não consegui falar com o Telegram: ${status.error ?? 'sem resposta'}.`}{' '}
            As mensagens esperam na fila.
          </p>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onRetry}>
            Tentar de novo
          </button>
        </div>
      )}

      {status.state === 'READY' && <Ready status={status} onStatus={onStatus} />}
    </section>
  )
}

type Errors = Partial<Record<string, string>>

function Ready({ status, onStatus }: { status: TelegramStatusDTO; onStatus: (s: TelegramStatusDTO) => void }) {
  const { toast } = useToast()
  const [form, setForm] = useState<TelegramSettings>(status.settings)
  const [maxStr, setMaxStr] = useState(String(status.settings.maxPerHour))
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'chats'>(null)
  const [chats, setChats] = useState<TelegramChatDTO[] | null>(null)

  const set = <K extends keyof TelegramSettings>(k: K, v: TelegramSettings[K]) => setForm((f) => ({ ...f, [k]: v }))
  const dirty =
    JSON.stringify({ ...form, maxPerHour: maxStr }) !== JSON.stringify({ ...status.settings, maxPerHour: String(status.settings.maxPerHour) })

  const findChats = async () => {
    setBusy('chats')
    try {
      const found = await api.telegramChats()
      setChats(found)
      if (!found.length) toast('Nenhum grupo apareceu ainda. Veja a dica abaixo do campo.', 'warn')
    } catch (err) {
      toast(errorMessage(err), 'danger')
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    const parsed = telegramSettingsInput.safeParse({ ...form, maxPerHour: maxStr.trim() })
    if (!parsed.success) {
      const next: Errors = {}
      for (const i of parsed.error.issues) next[i.path.join('.')] ??= i.message
      setErrors(next)
      return
    }
    if (parsed.data.autoSend && !parsed.data.chatId) {
      setErrors({ chatId: 'Escolha o grupo antes de ligar o envio automático' })
      return
    }
    setErrors({})
    setBusy('save')
    try {
      const saved = await api.saveTelegram(parsed.data)
      onStatus(saved)
      setForm(saved.settings)
      setMaxStr(String(saved.settings.maxPerHour))
      toast(saved.settings.autoSend ? 'Salvo. As próximas promoções vão sozinhas para o Telegram.' : 'Salvo.')
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

  const test = async () => {
    if (!window.confirm(`Todo mundo em “${status.settings.chatTitle || status.settings.chatId}” vai ver a mensagem de teste. Enviar?`)) return
    setBusy('test')
    try {
      await api.telegramTest()
      toast('Teste enviado ao grupo.')
    } catch (err) {
      toast(errorMessage(err), 'danger')
    } finally {
      setBusy(null)
    }
  }

  const q = status.queue
  const s = status.settings
  const bot = status.bot
  const chat = status.chat

  return (
    <>
      <p>
        Bot <strong>{bot?.username ? `@${bot.username}` : bot?.name}</strong>
        {bot?.username && bot.name && <span className="muted"> ({bot.name})</span>}.
        {chat && !chat.problem && (
          <>
            {' '}
            Postando em <strong>{chat.title}</strong>
            {chat.type && <> ({CHAT_TYPE[chat.type]})</>}.
          </>
        )}
      </p>
      {chat?.problem && (
        <p className="store-error small" role="alert">
          {chat.title}: {chat.problem}. As mensagens esperam na fila até isso ser resolvido.
        </p>
      )}

      <p className="muted small" aria-live="polite">
        {q.queued} na fila · {q.sentLastHour} enviada{q.sentLastHour === 1 ? '' : 's'} na última hora (limite {s.maxPerHour})
        {q.failed > 0 && <> · {q.failed} com erro</>}
        {status.quietNow && <> · horário de silêncio agora: a fila volta a andar às {hh(s.quietEnd)}</>}
        {status.quietOff?.active && s.quietHours && (
          <> · Black Friday: horário de silêncio suspenso até {formatDateTime(status.quietOff.until)}</>
        )}
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
            <TextField
              label="Grupo ou canal"
              value={form.chatId}
              placeholder="-1001234567890 ou @seucanal"
              autoComplete="off"
              spellCheck={false}
              error={errors.chatId}
              onChange={(e) => setForm((f) => ({ ...f, chatId: e.target.value.trim(), chatTitle: '' }))}
              hint={
                <>
                  Adicione o bot ao grupo (no canal, como administrador com permissão de publicar) e clique em “Procurar
                  grupos”. Se ele não aparecer, mande <code>/start@{bot?.username || 'seubot'}</code> no grupo, ou publique algo
                  no canal, e procure de novo. O Telegram só mostra o que aconteceu nas últimas 24 h. Também dá para digitar o @
                  de um canal público.{' '}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void findChats()} disabled={busy !== null}>
                    {busy === 'chats' ? 'Procurando…' : 'Procurar grupos'}
                  </button>
                </>
              }
            />
          </div>

          {chats && chats.length > 0 && (
            <div className="span-2">
              <SelectField
                label="Grupos e canais onde o bot está"
                value={chats.some((c) => c.id === form.chatId) ? form.chatId : ''}
                onChange={(e) => {
                  const c = chats.find((x) => x.id === e.target.value)
                  if (c) setForm((f) => ({ ...f, chatId: c.id, chatTitle: c.title }))
                }}
              >
                <option value="">Escolha…</option>
                {chats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({CHAT_TYPE[c.type]})
                  </option>
                ))}
              </SelectField>
            </div>
          )}

          <div className="span-2">
            <Switch
              label="Enviar sozinho as promoções novas"
              checked={form.autoSend}
              onChange={(v) => set('autoSend', v)}
              hint="Desligado, as mensagens ficam em “Para enviar” para você revisar. Ligado, vão direto para a fila e saem uma por vez. Antes de cada envio o PromoEye confere se o preço não subiu e se o anúncio ainda existe. O Telegram tem fila própria: não depende do WhatsApp estar conectado."
            />
          </div>

          <div className="span-2">
            <Switch
              label="Mandar com a foto do produto"
              checked={form.withImage}
              onChange={(v) => set('withImage', v)}
              hint="A foto vai com o texto na legenda. Se o Telegram não conseguir baixar a imagem da loja, vai só o texto com a prévia do link."
            />
          </div>

          <TextField
            label="Máximo por hora"
            inputMode="numeric"
            value={maxStr}
            onChange={(e) => setMaxStr(e.target.value)}
            error={errors.maxPerHour}
            hint="De 1 a 60. Entre uma mensagem e outra há pelo menos 1 minuto. Bot não é bloqueado como número comum; o limite é para o grupo não cansar."
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
            {busy === 'save' ? 'Conferindo e salvando…' : 'Salvar envio automático'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void test()}
            disabled={busy !== null || !s.chatId || dirty}
            title={!s.chatId ? 'Escolha e salve o grupo primeiro' : dirty ? 'Salve antes de testar' : undefined}
          >
            {busy === 'test' ? 'Enviando…' : 'Enviar teste no grupo'}
          </button>
        </div>
      </form>
    </>
  )
}
