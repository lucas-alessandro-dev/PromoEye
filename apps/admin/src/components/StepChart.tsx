import { formatBRL, formatBRLShort } from '@promoeye/shared'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDayMonth, formatDayMonthTime } from '../lib/format'

export interface ChartPoint {
  /** tempo em ms */
  t: number
  /** preço; null = indisponível (abre um buraco na linha) */
  v: number | null
}

// Cores em hex: atributos de apresentação do SVG nem sempre aceitam var().
const PRIMARY = '#072C2C'
const ACCENT = '#C2410C' // laranja escurecido: linha de 2px precisa de 3:1 sobre o fundo claro
const GRID = '#D6D2C4'
const INK_SOFT = '#4B5563'

/**
 * Gráfico de preço em degrau: o preço vale até a próxima mudança, que é
 * exatamente como o histórico é gravado. Junto vai um resumo em texto para
 * quem não enxerga o gráfico.
 */
export function StepChart({
  points,
  target,
  label,
  height = 260,
}: {
  points: ChartPoint[]
  target?: number | null
  label: string
  height?: number
}) {
  const valid = points.filter((p) => p.v !== null) as { t: number; v: number }[]
  if (!valid.length) {
    return <p className="muted">Ainda não há preços suficientes para desenhar o gráfico.</p>
  }
  const min = valid.reduce((a, b) => (b.v < a.v ? b : a))
  const max = valid.reduce((a, b) => (b.v > a.v ? b : a))
  const last = valid[valid.length - 1]!
  const summary = `${label}. Menor: ${formatBRL(min.v)} em ${formatDayMonthTime(min.t)}. Maior: ${formatBRL(max.v)}. Último: ${formatBRL(last.v)}.`

  return (
    <figure className="chart">
      <div role="img" aria-label={summary} style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(t: number) => formatDayMonth(t)}
              tick={{ fill: INK_SOFT, fontSize: 12 }}
              stroke={GRID}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) => formatBRLShort(Math.round(v))}
              tick={{ fill: INK_SOFT, fontSize: 12 }}
              stroke={GRID}
              width={84}
              domain={['auto', 'auto']}
            />
            <Tooltip
              labelFormatter={(t) => formatDayMonthTime(Number(t))}
              formatter={(v) => [formatBRL(Number(v)), 'Preço']}
            />
            {target ? (
              <ReferenceLine
                y={target}
                stroke={ACCENT}
                strokeDasharray="6 4"
                label={{ value: `alvo ${formatBRLShort(target)}`, position: 'insideTopRight', fill: ACCENT, fontSize: 12 }}
              />
            ) : null}
            <Line
              type="stepAfter"
              dataKey="v"
              stroke={PRIMARY}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="chart-summary">{summary}</figcaption>
    </figure>
  )
}
