import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SuperPlot, type SelectEvent } from '@supersolutions/super-plot-react'

const rows = [
  { month: 'Jul', revenue: 120, cost: 80 }, { month: 'Aug', revenue: 138, cost: 84 }, { month: 'Sep', revenue: 151, cost: 91 },
  { month: 'Oct', revenue: 149, cost: 97 }, { month: 'Nov', revenue: 171, cost: 99 }
]

function App(): JSX.Element {
  const [type, setType] = useState<'bar' | 'line' | 'area'>('bar')
  const [dark, setDark] = useState(false)
  const [picked, setPicked] = useState<SelectEvent | null>(null)
  // Memoize the spec: a new object means a new render.
  const spec = useMemo(() => ({ type, title: 'Revenue vs cost', subtitle: 'USD thousands', x: 'month', y: ['revenue', 'cost'], data: rows }), [type])
  return (
    <main>
      <div className="row">
        {(['bar', 'line', 'area'] as const).map(t => <button key={t} aria-pressed={type === t} onClick={() => setType(t)}>{t}</button>)}
        <button aria-pressed={dark} onClick={() => setDark(d => !d)}>dark</button>
      </div>
      <div className="card"><SuperPlot spec={spec} theme={dark ? 'dark' : 'light'} onSelect={setPicked} style={{ height: '100%' }} /></div>
      <h3>Last clicked mark</h3>
      <pre>{picked ? JSON.stringify(picked.datum, null, 2) : 'Click a bar or point.'}</pre>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
