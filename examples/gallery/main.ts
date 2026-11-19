import { SuperPlot } from '@supersolutions/super-plot-web'
import { gallery } from '../_shared/specs'

type Mode = 'light' | 'dark' | 'auto'
const grid = document.getElementById('grid')!
const root = document.documentElement
let mode: Mode = (new URLSearchParams(location.search).get('theme') as Mode) || 'light'
const plots: SuperPlot[] = []

for (const g of gallery) {
  const fig = document.createElement('figure')
  fig.dataset.id = g.id
  fig.innerHTML = '<div class="card"><div class="plot"></div></div><figcaption></figcaption>'
  fig.querySelector('figcaption')!.textContent = `${g.id}: ${g.note}`
  grid.appendChild(fig)
  plots.push(new SuperPlot(fig.querySelector('.plot') as HTMLElement, g.spec, { theme: mode }))
}

const specBox = document.getElementById('spec') as HTMLTextAreaElement
const issues = document.getElementById('issues')!
const playHost = document.getElementById('play-plot') as HTMLElement
specBox.value = JSON.stringify({ ...gallery[0].spec, data: (gallery[0].spec.data as unknown[]).slice(0, 3) }, null, 2)
const play = new SuperPlot(playHost, JSON.parse(specBox.value), {
  theme: mode,
  onIssues: list => {
    issues.replaceChildren(...list.map(i => {
      const li = document.createElement('li')
      li.className = i.severity
      li.textContent = `${i.path || 'spec'}: ${i.message}${i.hint ? ' ' + i.hint : ''} `
      const code = document.createElement('code')
      code.textContent = `[${i.code}]`
      li.appendChild(code)
      return li
    }))
  }
})
specBox.addEventListener('input', () => play.setSpec(specBox.value))
plots.push(play)

function apply(): void {
  root.dataset.theme = mode === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode
  document.querySelectorAll('#theme button').forEach(b => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.v === mode)))
  for (const p of plots) p.setOptions({ theme: mode })
}
document.getElementById('theme')!.addEventListener('click', e => {
  const v = (e.target as HTMLElement).dataset.v as Mode | undefined
  if (v) {
    mode = v
    apply()
  }
})
document.getElementById('brand')!.addEventListener('change', e => root.classList.toggle('brand', (e.target as HTMLInputElement).checked))
if (new URLSearchParams(location.search).has('brand')) {
  root.classList.add('brand')
  ;(document.getElementById('brand') as HTMLInputElement).checked = true
}
apply()
;(window as unknown as { plots: SuperPlot[] }).plots = plots
