/** Stylesheet injected once per document. Colours come from the scene (CSS variables); this is behaviour only. */
export const CSS = `
.sp-root{position:relative;display:block;width:100%;height:100%;line-height:0;-webkit-tap-highlight-color:transparent}
.sp-root svg{display:block;width:100%;height:100%}
.sp-cv{position:relative;width:100%;height:100%}
.sp-cv canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
.sp-cv-legend{position:absolute;inset:0;pointer-events:none}
.sp-cv-lk{position:absolute;pointer-events:none;padding:0;margin:0;border:0;background:transparent;border-radius:4px;cursor:pointer}
.sp-cv-lk:focus-visible{outline:2px solid var(--sp-info,#2962FF);outline-offset:1px}
.sp-cv>canvas:first-child:focus{outline:none}
.sp-cv>canvas:first-child:focus-visible{outline:2px solid var(--sp-info,#2962FF);outline-offset:-2px}
.sp-live,.sp-table caption{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.sp-table{border-collapse:collapse;font:12px/1.4 var(--sp-font,system-ui,sans-serif);color:var(--sp-text,#131722);margin-top:8px;width:100%}
.sp-table:not([data-visible]){position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.sp-table th,.sp-table td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--sp-border,#E0E3EB)}
.sp-table td[data-n]{text-align:right;font-variant-numeric:tabular-nums}
.sp-root[data-axes]{touch-action:pan-y;-webkit-user-select:none;user-select:none}
.sp-root[data-axes="xy"]{touch-action:none}
.sp-root[data-axes]:focus{outline:none}
.sp-root[data-axes]:focus-visible{outline:2px solid var(--sp-info,#2962FF);outline-offset:2px}
.sp-root[data-brushing]{cursor:crosshair}
.sp-root[data-panning]{cursor:grabbing}
.sp-brush{position:absolute;pointer-events:none;z-index:4;background:color-mix(in srgb,var(--sp-info,#2962FF) 14%,transparent);border:1px solid var(--sp-info,#2962FF);box-sizing:border-box;line-height:0}
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
.sp-bar{position:absolute;right:8px;top:8px;z-index:6;display:flex;gap:4px;line-height:1;opacity:0;transition:opacity .15s ease}
.sp-root:hover>.sp-bar,.sp-bar:focus-within{opacity:1}
@media (hover:none){.sp-bar{opacity:1}}
.sp-bar button{height:24px;padding:0 8px;margin:0;border:1px solid;border-radius:6px;font:500 11px/1 var(--sp-font,system-ui,sans-serif);cursor:pointer;display:flex;align-items:center}
.sp-bar button:focus{outline:none}
.sp-bar button:focus-visible{outline:2px solid var(--sp-info,#2962FF);outline-offset:1px}
.sp-bar button[aria-pressed="true"]{box-shadow:inset 0 0 0 1px var(--sp-info,#2962FF)}
.sp-bar button[aria-disabled="true"]{opacity:.45;cursor:default}
.sp-root[data-toolbar] .sp-ctl{top:40px}
.sp-tip[data-custom]{white-space:pre-line}
.sp-label[role="button"]{cursor:pointer}
.sp-label[role="button"]:focus{outline:none}
.sp-label[role="button"]:focus-visible{outline:2px solid var(--sp-info,#2962FF);outline-offset:1px}
.sp-nav{position:relative;display:block;width:100%;height:44px;line-height:0;touch-action:none;-webkit-user-select:none;user-select:none}
.sp-nav svg{position:absolute;left:0;top:0;width:100%;height:100%;display:block;overflow:visible}
.sp-nav-shade{position:absolute;top:6px;height:32px;pointer-events:none;background:color-mix(in srgb,var(--sp-nav-face,#FFFFFF) 55%,transparent)}
.sp-nav-win{position:absolute;top:6px;height:32px;box-sizing:border-box;border:1px solid var(--sp-nav-ink,#2962FF);border-radius:3px;background:color-mix(in srgb,var(--sp-nav-ink,#2962FF) 8%,transparent);cursor:grab}
.sp-nav[data-drag="pan"] .sp-nav-win{cursor:grabbing}
.sp-nav-h{position:absolute;z-index:1;top:10px;width:12px;height:24px;margin-left:-6px;cursor:ew-resize;display:flex;justify-content:center}
.sp-nav-h::before{content:"";box-sizing:border-box;width:6px;height:100%;border-radius:3px;border:1px solid var(--sp-nav-ink,#2962FF);background:var(--sp-nav-face,#FFFFFF)}
.sp-nav-win:focus,.sp-nav-h:focus{outline:none}
.sp-nav-win:focus-visible,.sp-nav-h:focus-visible{outline:2px solid var(--sp-info,#2962FF);outline-offset:1px}
@media (pointer:coarse){
.sp-nav-h{width:24px;margin-left:-12px;top:6px;height:32px}
.sp-root svg circle.sp-hit{r:12px}
.sp-bar button{min-height:32px}
.sp-ctl button{width:32px;height:32px}
}
@media print{.sp-bar,.sp-ctl,.sp-tip,.sp-nav-h{display:none!important}.sp-root,.sp-nav,.sp-table{break-inside:avoid}.sp-root{-webkit-print-color-adjust:exact;print-color-adjust:exact}.sp-nav-win{background:transparent}}
.sp-error{line-height:1.5;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;padding:12px;border:1px solid #F23645;border-radius:6px;color:#F23645;white-space:pre-wrap}
@keyframes sp-y{from{transform:scaleY(0)}to{transform:none}}
@keyframes sp-x{from{transform:scaleX(0)}to{transform:none}}
@keyframes sp-fade{from{opacity:0}}
@keyframes sp-draw{to{stroke-dashoffset:0}}
.sp-enter .sp-a-y{transform-box:fill-box;transform-origin:50% 100%;animation:sp-y .5s cubic-bezier(.2,.7,.2,1) both}
.sp-enter .sp-a-x{transform-box:fill-box;transform-origin:0 50%;animation:sp-x .5s cubic-bezier(.2,.7,.2,1) both}
.sp-enter .sp-a-fade{animation:sp-fade .5s ease both}
.sp-enter .sp-a-draw{stroke-dasharray:1;stroke-dashoffset:1;animation:sp-draw .8s ease forwards}
@media (prefers-reduced-motion:reduce){.sp-enter *{animation:none!important}.sp-bar,.sp-tip,.sp-data{transition:none}}
@media (forced-colors:active){
.sp-root svg,.sp-cv canvas,.sp-nav svg{forced-color-adjust:none}
.sp-nav-win{border-color:Highlight;background:transparent}
.sp-nav-h::before{background:ButtonFace;border-color:ButtonText}
.sp-nav-shade{background:transparent}
.sp-nav-win:focus-visible,.sp-nav-h:focus-visible,.sp-label[role="button"]:focus-visible{outline:2px solid Highlight;outline-offset:2px}
.sp-m:focus-visible,.sp-cv-lk:focus-visible,.sp-cv>canvas:first-child:focus-visible,.sp-root[data-axes]:focus-visible,.sp-root[data-map]:focus-visible,.sp-ctl button:focus-visible,.sp-bar button:focus-visible{outline:2px solid Highlight;outline-offset:2px}
.sp-m.sp-data:focus-visible{stroke:Highlight;stroke-width:3px}
.sp-root svg g[pointer-events] line{stroke:Highlight}
.sp-brush{background:transparent;border:2px solid Highlight}
.sp-tip{background:Canvas!important;color:CanvasText!important;border-color:CanvasText!important;box-shadow:none}
.sp-tip i{forced-color-adjust:none;outline:1px solid CanvasText}
.sp-bar,.sp-bar:focus-within{opacity:1}
.sp-bar button,.sp-ctl button{background:ButtonFace!important;color:ButtonText!important;border-color:ButtonText!important}
.sp-bar button[aria-pressed="true"]{background:Highlight!important;color:HighlightText!important}
.sp-bar button[aria-disabled="true"]{color:GrayText!important;border-color:GrayText!important;opacity:1}
.sp-table,.sp-table th,.sp-table td{color:CanvasText;border-color:CanvasText}
.sp-error{color:CanvasText;border-color:CanvasText}
}
@media (prefers-contrast:more){
.sp-dimmed{opacity:.15!important}
.sp-tip{border-width:2px;box-shadow:none}
.sp-brush{border-width:2px;background:color-mix(in srgb,var(--sp-info,#2962FF) 22%,transparent)}
.sp-m:focus-visible,.sp-cv-lk:focus-visible,.sp-cv>canvas:first-child:focus-visible,.sp-root[data-axes]:focus-visible,.sp-root[data-map]:focus-visible,.sp-ctl button:focus-visible,.sp-bar button:focus-visible{outline-width:3px}
.sp-bar{opacity:1}
}
`

const MARK = 'data-super-plot'

export function ensureStyles(doc: Document): void {
  if (doc.head.querySelector(`style[${MARK}]`)) return
  const el = doc.createElement('style')
  el.setAttribute(MARK, '')
  el.textContent = CSS
  doc.head.appendChild(el)
}
