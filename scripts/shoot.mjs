/**
 * Capturas da vitrine em Chrome headless, sem dependências (protocolo DevTools via WebSocket nativo).
 *
 *   node scripts/shoot.mjs http://localhost:3000/ shots 1440x900,768x1024,390x844 [--tiles]
 *
 * Para cada tamanho salva a página inteira (<w>.png) e, com --tiles, cada "tela" em scrollY = k × altura
 * (<w>-tile-<k>.png), que é como a taste-skill julga "uma seção por tela". Também imprime, por seção,
 * a altura e o topo medidos, e avisa rolagem lateral.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const [url = 'http://localhost:3000/', outDir = 'shots', sizesArg = '1440x900,390x844'] = process.argv.slice(2)
const tiles = process.argv.includes('--tiles')
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p))
if (!CHROME) throw new Error('Chrome/Edge não encontrado')

const profile = join(tmpdir(), `pe-shoot-${process.pid}`)
const port = 9300 + (process.pid % 500)
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function targetWs() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* ainda subindo */ }
    await sleep(200)
  }
  throw new Error('Chrome não respondeu')
}

const ws = new WebSocket(await targetWs())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
const listeners = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
  } else if (msg.method) listeners.forEach((l) => l(msg))
})
const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })) })
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value

await send('Page.enable')
await send('Runtime.enable')
// --cookie nome=valor: entra logado (ex.: o cookie pe_admin de um login feito com curl).
const cookieArg = process.argv.find((a) => a.startsWith('--cookie='))
if (cookieArg) {
  await send('Network.enable')
  const [name, ...rest] = cookieArg.slice('--cookie='.length).split('=')
  await send('Network.setCookie', { name, value: rest.join('='), url })
}
const consoleErrors = []
listeners.push((m) => {
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
})
mkdirSync(resolve(outDir), { recursive: true })

for (const size of sizesArg.split(',')) {
  const [w, h] = size.split('x').map(Number)
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 640 })
  await send('Page.navigate', { url })
  await new Promise((r) => { const l = (m) => { if (m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(l), 1); r() } }; listeners.push(l) })
  await evalJs('document.fonts.ready.then(() => true)')
  await sleep(2500)
  const info = await evalJs(`(() => {
    const H = innerHeight, doc = document.documentElement
    const secs = [...document.querySelectorAll('main > section, main > div > section, footer.closing')].map(s => {
      const r = s.getBoundingClientRect(); return { id: s.id || s.className.split(' ')[0], top: Math.round(r.top + scrollY), h: Math.round(r.height), screens: +(r.height / H).toFixed(2) }
    })
    return { total: doc.scrollHeight, overflowX: doc.scrollWidth > innerWidth + 1, secs, placeholders: doc.dataset.placeholders || 0, broken: doc.dataset.broken || 0 }
  })()`)
  console.log(`\n${w}x${h}: página ${info.total}px${info.overflowX ? '  ⚠ ROLAGEM LATERAL' : ''}${+info.placeholders ? `  ⚠ ${info.placeholders} placeholders` : ''}${+info.broken ? `  ⚠ ${info.broken} imagens quebradas` : ''}`)
  for (const s of info.secs) console.log(`  ${String(s.id).padEnd(16)} topo ${String(s.top).padStart(5)}  altura ${String(s.h).padStart(5)}  (${s.screens} telas)`)

  const full = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: info.total, scale: 1 } })
  writeFileSync(resolve(outDir, `${w}.png`), Buffer.from(full.data, 'base64'))
  if (tiles) {
    const n = Math.ceil(info.total / h)
    for (let k = 0; k < n; k++) {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: k * h, width: w, height: h, scale: 1 } })
      writeFileSync(resolve(outDir, `${w}-tile-${k}.png`), Buffer.from(shot.data, 'base64'))
    }
  }
}
if (consoleErrors.length) console.log('\nErros no console:\n  ' + consoleErrors.slice(0, 10).join('\n  '))
ws.close()
chrome.kill()
await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch { /* o Chrome às vezes segura o perfil */ }
