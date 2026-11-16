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
    cursor.classList.toggle('is-flip', x > 62)
    value.textContent = money.format(p.v)
    detail.textContent = `${p.s ? `${p.s} · ` : ''}desde ${when.format(new Date(p.t))}`
  }
  const hide = () => {
    cursor.hidden = true
  }

  plot.addEventListener('pointermove', (event) => {
    const rect = plot.getBoundingClientRect()
    const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100))
    show(stepAt(x), x)
  })
  plot.addEventListener('pointerleave', hide)
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
