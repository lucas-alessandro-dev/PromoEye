import { Link } from 'react-router'
import { api } from '../api'
import { useRun } from '../context/run'
import { useLoad, useTitle } from '../lib/hooks'
import { ErrorBox, Loading } from '../components/States'
import { MessageQueue } from '../components/MessageQueue'
import { TelegramSender } from '../components/TelegramSender'

export function Telegram() {
  useTitle('Telegram')
  const { version } = useRun()
  const tg = useLoad(() => api.telegramStatus(), [version])
  const settings = useLoad(() => api.settings(), [])
  const invite = settings.data?.telegram.inviteUrl

  const refreshStatus = () => {
    api.telegramStatus().then(tg.setData).catch(() => undefined)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Mensagens para o Telegram</h1>
          <p className="lead">
            As mesmas promoções do WhatsApp, postadas por um bot no seu grupo ou canal do Telegram. Cada canal tem fila e
            limite próprios.
          </p>
        </div>
      </header>

      {tg.loading && !tg.data && <Loading label="Conferindo o bot do Telegram…" />}
      {tg.error && !tg.data ? <ErrorBox error={tg.error} onRetry={tg.reload} title="Não deu para ver o envio pelo Telegram" /> : null}
      {tg.data && <TelegramSender status={tg.data} onStatus={tg.setData} onRetry={tg.reload} />}

      <div className="notice notice-info">
        {invite ? (
          <p>
            Telegram da vitrine: <a href={invite} target="_blank" rel="noopener noreferrer">{invite}</a>
          </p>
        ) : (
          <p>
            Nenhum convite cadastrado. Cole o convite do grupo ou canal em <Link to="/configuracoes">Configurações</Link> para
            ele aparecer na vitrine.
          </p>
        )}
      </div>

      <MessageQueue channel="telegram" canSend={tg.data?.ready ?? false} onChange={refreshStatus} />
    </div>
  )
}
