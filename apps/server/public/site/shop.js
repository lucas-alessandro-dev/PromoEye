// Vitrine: melhorias progressivas. Sem este arquivo tudo continua funcionando
// (a ordem tem botão "Aplicar", a galeria mostra a primeira foto e o
// histórico tem a tabela). Textos vindos do banco entram por textContent.

// Ordenar: aplica ao escolher, sem precisar do botão.
for (const select of document.querySelectorAll('select[data-autosubmit]')) {
  select.form?.querySelector('[data-apply]')?.setAttribute('hidden', '')
  select.addEventListener('change', () => select.form?.requestSubmit())
}

// Galeria da página do item: as miniaturas trocam a foto grande.
const mainImg = document.getElementById('pdp-main')
const thumbs = document.querySelector('[data-thumbs]')
if (mainImg && thumbs) {
  thumbs.hidden = false
  thumbs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-src]')
    if (!button) return
    mainImg.src = button.dataset.src
    for (const b of thumbs.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === button))
  })
}

// Celular: barra de compra presa embaixo enquanto a caixa de compra está fora
// da tela. Some quando a caixa aparece e quando o rodapé chega (não cobre nada lá).
const buybar = document.querySelector('[data-buybar]')
const buyActions = document.querySelector('.buy__actions')
if (buybar && buyActions && 'IntersectionObserver' in window) {
  const phone = matchMedia('(max-width: 767px)')
  const footer = document.querySelector('footer')
  const visible = new Map()
  const update = () => {
    const show = phone.matches && !visible.get(buyActions) && !visible.get(footer)
    buybar.classList.toggle('is-on', show)
    buybar.toggleAttribute('inert', !show)
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) visible.set(e.target, e.isIntersecting)
    update()
  })
  io.observe(buyActions)
  if (footer) io.observe(footer)
  phone.addEventListener('change', update)
  buybar.hidden = false
}

// Histórico: cursor que acha a data. O preço é em degrau, então o valor num
// instante é o da última mudança antes dele.
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const when = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

for (const plot of document.querySelectorAll('[data-points]')) {
  let points
  try {
    points = JSON.parse(plot.dataset.points)
  } catch {
    continue
  }
  if (!points.length) continue
  const cursor = plot.querySelector('.hc__cursor')
  const value = cursor.querySelector('.hc__tip b')
  const detail = cursor.querySelector('.hc__tip span')
  let index = points.length - 1

  const stepAt = (xPct) => {
    let i = 0
    for (let k = 0; k < points.length; k++) if (points[k].x <= xPct) i = k
    return i
  }
  const show = (i, xPct) => {
    index = i
    const p = points[i]
    const x = xPct ?? p.x
    cursor.hidden = false
    cursor.style.setProperty('--x', `${x}%`)
    cursor.style.setProperty('--y', `${p.y}%`)
    value.textContent = money.format(p.v)
    detail.textContent = `${p.s ? `${p.s} · ` : ''}desde ${when.format(new Date(p.t))}`
    // O balão fica à direita do cursor; se não couber, à esquerda; e nunca sai da
    // tela (no celular estreito, perto do meio, ele não cabe inteiro em nenhum lado).
    const rect = plot.getBoundingClientRect()
    const tipWidth = cursor.querySelector('.hc__tip').offsetWidth
    const screen = document.documentElement.clientWidth
    const xPx = rect.left + (rect.width * x) / 100
    let left = xPx + 12
    if (left + tipWidth > screen - 8) left = xPx - 12 - tipWidth
    left = Math.max(8, Math.min(left, screen - 8 - tipWidth))
    cursor.style.setProperty('--tip-dx', `${Math.round(left - xPx)}px`)
  }
  const hide = () => {
    cursor.hidden = true
  }

  const follow = (event) => {
    const rect = plot.getBoundingClientRect()
    const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100))
    show(stepAt(x), x)
  }
  // Mouse: segue o ponteiro e some ao sair. Toque: o valor aparece no toque
  // (e ao arrastar de lado) e fica na tela até tocar fora do gráfico.
  plot.addEventListener('pointermove', follow)
  plot.addEventListener('pointerdown', follow)
  plot.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') hide()
  })
  document.addEventListener('pointerdown', (event) => {
    if (!plot.contains(event.target)) hide()
  })
  plot.addEventListener('focus', () => show(index))
  plot.addEventListener('blur', hide)
  plot.addEventListener('keydown', (event) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }
    if (!(event.key in moves)) return
    event.preventDefault()
    const step = moves[event.key]
    show(Math.min(points.length - 1, Math.max(0, Number.isFinite(step) ? index + step : step < 0 ? 0 : points.length - 1)))
  })
}
