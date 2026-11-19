/** Stylesheet injected once per document. Colours come from the scene (CSS variables); this is behaviour only. */
export const CSS = `
.sp-root{position:relative;display:block;width:100%;height:100%;line-height:0;-webkit-tap-highlight-color:transparent}
.sp-root svg{display:block;width:100%;height:100%}
.sp-cv{position:relative;width:100%;height:100%}
.sp-cv canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
.sp-cv-legend{position:absolute;inset:0;pointer-events:none}
.sp-cv-lk{position:absolute;pointer-events:none;padding:0;margin:0;border:0;background:transparent;border-radius:4px;cursor:pointer}
.sp-cv-lk:focus-visible{outline:2px solid var(--sp-info,#2962FF);outline-offset:1px}
.sp-m:focus{outline:none}
.sp-m:focus-visible{outline:2px solid var(--sp-info,#2962FF);outline-offset:2px}
.sp-data{transition:opacity .15s ease}
.sp-dimmed{opacity:.28!important}
.sp-legend[data-lk],.sp-m[data-lk]{cursor:pointer}
.sp-data[tabindex],.sp-hit{cursor:default}
.sp-tip{position:absolute;z-index:10;left:0;top:0;pointer-events:none;opacity:0;transition:opacity .08s ease;font-size:12px;line-height:1.4;padding:8px 10px;border-radius:6px;border:1px solid;box-shadow:0 4px 16px rgba(0,0,0,.18);max-width:260px;white-space:nowrap}
.sp-tip[data-show]{opacity:1}
.sp-tip b{display:block;font-weight:600;margin-bottom:4px}
.sp-tip .sp-tr{display:flex;align-items:center;gap:8px;justify-content:space-between}
.sp-tip .sp-tl{display:flex;align-items:center;gap:6px}
.sp-tip i{display:inline-block;width:8px;height:8px;border-radius:2px;flex:none}
.sp-tip .sp-tv{font-variant-numeric:tabular-nums;font-weight:600;margin-left:12px}
.sp-root[data-map]{touch-action:none;cursor:grab}
.sp-root[data-map][data-drag]{cursor:grabbing}
.sp-root[data-map]:focus{outline:none}
.sp-root[data-map]:focus-visible{outline:2px solid var(--sp-info,#2962FF);outline-offset:2px}
.sp-ctl{position:absolute;right:8px;top:8px;z-index:5;display:flex;flex-direction:column;gap:4px;line-height:1}
.sp-ctl button{width:28px;height:28px;padding:0;margin:0;border:1px solid;border-radius:6px;font:16px/1 system-ui,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center}
.sp-ctl button:focus-visible{outline:2px solid var(--sp-info,#2962FF);outline-offset:1px}
.sp-error{line-height:1.5;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;padding:12px;border:1px solid #F23645;border-radius:6px;color:#F23645;white-space:pre-wrap}
@keyframes sp-y{from{transform:scaleY(0)}to{transform:none}}
@keyframes sp-x{from{transform:scaleX(0)}to{transform:none}}
@keyframes sp-fade{from{opacity:0}}
@keyframes sp-draw{to{stroke-dashoffset:0}}
.sp-enter .sp-a-y{transform-box:fill-box;transform-origin:50% 100%;animation:sp-y .5s cubic-bezier(.2,.7,.2,1) both}
.sp-enter .sp-a-x{transform-box:fill-box;transform-origin:0 50%;animation:sp-x .5s cubic-bezier(.2,.7,.2,1) both}
.sp-enter .sp-a-fade{animation:sp-fade .5s ease both}
.sp-enter .sp-a-draw{stroke-dasharray:1;stroke-dashoffset:1;animation:sp-draw .8s ease forwards}
@media (prefers-reduced-motion:reduce){.sp-enter *{animation:none!important}}
`

const MARK = 'data-super-plot'

export function ensureStyles(doc: Document): void {
  if (doc.head.querySelector(`style[${MARK}]`)) return
  const el = doc.createElement('style')
  el.setAttribute(MARK, '')
  el.textContent = CSS
  doc.head.appendChild(el)
}
