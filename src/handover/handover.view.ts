import { Handover, HandoverItem } from '../common/types';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderItem(item: HandoverItem): string {
  const evidence = item.evidence
    .map(
      (e) =>
        `<li><code>${esc(e.sourceRef)}</code> — “${esc(e.quote).slice(0, 240)}”</li>`,
    )
    .join('');
  const contradictions = item.contradictions?.length
    ? `<div class="contradiction"><strong>Contradiction:</strong> ${item.contradictions
        .map((c) => esc(c.description))
        .join(' ')}</div>`
    : '';
  return `<article class="item">
    <header><span class="status status-${esc(item.status)}">${esc(item.status.replace('_', ' '))}</span>
      ${item.room ? `<span class="room">Room ${esc(item.room)}</span>` : ''}
    </header>
    <h3>${esc(item.title)}</h3>
    <p>${esc(item.body)}</p>
    ${contradictions}
    <details><summary>Evidence (${item.evidence.length})</summary><ul>${evidence}</ul></details>
  </article>`;
}

function renderSection(
  title: string,
  cls: string,
  items: HandoverItem[],
): string {
  if (items.length === 0)
    return `<section class="${cls}"><h2>${esc(title)}</h2><p class="empty">None.</p></section>`;
  return `<section class="${cls}"><h2>${esc(title)} <span class="count">${items.length}</span></h2>${items.map(renderItem).join('')}</section>`;
}

export function renderHandoverHtml(h: Handover): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Handover — ${esc(h.hotel.name)} — ${esc(h.targetMorning)}</title>
<style>
  :root { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; line-height: 1.45; }
  body { max-width: 880px; margin: 2rem auto; padding: 0 1rem; color: #111; }
  header.top { border-bottom: 2px solid #111; padding-bottom: 0.5rem; margin-bottom: 1rem; }
  .meta { color: #666; font-size: 0.85rem; }
  section { margin: 1.5rem 0; padding: 0.5rem 0.75rem; border-radius: 6px; }
  section.on-fire { background: #fff1f0; border: 1px solid #ffa39e; }
  section.pending { background: #fffbe6; border: 1px solid #ffe58f; }
  section.fyi { background: #f6ffed; border: 1px solid #b7eb8f; }
  section.flags { background: #f0f5ff; border: 1px solid #adc6ff; }
  h2 { margin: 0.25rem 0 0.75rem; font-size: 1.15rem; }
  .count { font-size: 0.8rem; background: #fff; padding: 0.05rem 0.4rem; border-radius: 999px; vertical-align: middle; }
  .empty { color: #888; font-style: italic; margin: 0; }
  article.item { background: #fff; border-radius: 4px; padding: 0.75rem 1rem; margin: 0.5rem 0; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
  article.item h3 { margin: 0.25rem 0; font-size: 1rem; }
  article.item p { margin: 0.25rem 0; }
  article.item header { display: flex; gap: 0.5rem; font-size: 0.75rem; text-transform: uppercase; }
  .status { background: #eee; padding: 0.05rem 0.4rem; border-radius: 3px; }
  .status-still_open { background: #ffd591; }
  .status-newly_resolved { background: #b7eb8f; }
  .status-new_tonight { background: #91d5ff; }
  .room { background: #eee; padding: 0.05rem 0.4rem; border-radius: 3px; }
  .contradiction { margin: 0.4rem 0; padding: 0.4rem 0.6rem; background: #fff7e6; border-left: 3px solid #fa8c16; font-size: 0.9rem; }
  details { margin-top: 0.5rem; font-size: 0.8rem; }
  code { background: #f4f4f4; padding: 0 4px; border-radius: 3px; }
</style></head>
<body>
<header class="top">
  <h1>Handover — ${esc(h.hotel.name)}</h1>
  <div class="meta">Morning of ${esc(h.targetMorning)} · shift ${esc(h.shiftWindow.from)} → ${esc(h.shiftWindow.to)} · generated ${esc(h.generatedAt)} · handoverId <code>${esc(h.handoverId)}</code></div>
</header>
${renderSection('🔥 On fire', 'on-fire', h.sections.onFire)}
${renderSection('⏳ Pending', 'pending', h.sections.pending)}
${renderSection('🚩 Flags', 'flags', h.sections.flags)}
${renderSection('ℹ️ FYI', 'fyi', h.sections.fyi)}
<footer class="meta">Events ingested: ${h.meta.eventsIngested} · extracted from prose: ${h.meta.extractedFromProse} · threads: ${h.meta.threadsBuilt} · LLM calls: ${h.meta.llmCalls}${h.meta.warnings.length ? ` · warnings: ${h.meta.warnings.length}` : ''}</footer>
</body></html>`;
}
