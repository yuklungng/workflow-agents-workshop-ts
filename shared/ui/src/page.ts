/** The telemetry viewer — a single self-contained HTML page (no build step). */

export function dashboardHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f8fafc;
      --surface: #ffffff;
      --surface-hover: #f1f5f9;
      --surface-muted: #e2e8f0;
      --text: #0f172a;
      --text-muted: #475569;
      --text-subtle: #64748b;
      --border: #cbd5e1;
      --accent: #6d28d9;
      --accent-hover: #5b21b6;
      --code-bg: #e2e8f0;
      --pill-running-bg: #fef3c7;
      --pill-running-text: #92400e;
      --pill-success-bg: #d1fae5;
      --pill-success-text: #065f46;
      --pill-error-bg: #fee2e2;
      --pill-error-text: #991b1b;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --bg: #0f172a;
        --surface: #1e293b;
        --surface-hover: #334155;
        --surface-muted: #334155;
        --text: #f8fafc;
        --text-muted: #e2e8f0;
        --text-subtle: #cbd5e1;
        --border: #475569;
        --accent: #8b5cf6;
        --accent-hover: #a78bfa;
        --code-bg: #334155;
        --pill-running-bg: #451a03;
        --pill-running-text: #fcd34d;
        --pill-success-bg: #064e3b;
        --pill-success-text: #6ee7b7;
        --pill-error-bg: #450a0a;
        --pill-error-text: #fca5a5;
      }
    }
    * { box-sizing: border-box; }
    html, body {
      font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
      margin: 0;
      padding: 24px;
      background: var(--bg);
      color: var(--text);
    }
    h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; color: var(--text); }
    h4 { font-size: 13px; font-weight: 600; margin: 16px 0 8px; color: var(--text); }
    p.sub { margin: 0 0 20px; color: var(--text-muted); }
    form { display: flex; gap: 8px; margin-bottom: 20px; }
    input[type=url] {
      flex: 1;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
    }
    input[type=url]::placeholder { color: var(--text-subtle); }
    select.workflow-select {
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
    }
    button {
      padding: 8px 14px;
      border: 0;
      border-radius: 6px;
      background: var(--accent);
      color: #fff;
      font-weight: 500;
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: var(--accent-hover); }
    button.secondary {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
    }
    button.secondary:hover:not(:disabled) { background: var(--surface-hover); }
    button.link {
      background: none;
      border: 0;
      padding: 0;
      margin-left: 8px;
      color: var(--accent);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    button.link:hover:not(:disabled) { background: none; text-decoration: underline; }
    button:disabled { opacity: 0.55; cursor: default; }
    .table-bar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
    details.span { margin: 4px 0; }
    details.span > summary {
      cursor: pointer;
      color: var(--text-muted);
      list-style: revert;
    }
    details.span > summary code { color: var(--text); }
    .span-io { margin: 6px 0 6px 14px; }
    .span-io > .label {
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-subtle);
      margin-bottom: 2px;
    }
    .span-io pre {
      white-space: pre-wrap;
      margin: 0 0 6px;
      padding: 8px 10px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 12px;
      line-height: 1.5;
    }
    table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--text); }
    th {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-subtle);
      background: var(--surface-muted);
    }
    tr:last-child td { border-bottom: 0; }
    tr.review { cursor: pointer; }
    tr.review:hover { background: var(--surface-hover); }
    .pill {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.4;
    }
    .pill.running { background: var(--pill-running-bg); color: var(--pill-running-text); }
    .pill.done, .pill.approve { background: var(--pill-success-bg); color: var(--pill-success-text); }
    .pill.error, .pill\\.request-changes { background: var(--pill-error-bg); color: var(--pill-error-text); }
    .detail { background: var(--surface-muted); }
    .detail td { color: var(--text); }
    .detail pre {
      white-space: pre-wrap;
      margin: 6px 0 12px;
      padding: 10px 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 13px;
      line-height: 1.5;
    }
    .detail strong { color: var(--text); }
    .muted { color: var(--text-subtle); }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      background: var(--code-bg);
      color: var(--text);
      padding: 1px 6px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="sub">Submit a GitHub PR URL to run the code-review agent. Telemetry below.</p>

  <form id="run">
    <select id="workflow" class="workflow-select" hidden></select>
    <input id="pr" type="url" placeholder="https://github.com/owner/repo/pull/123" required />
    <button type="submit" id="go">Review</button>
  </form>

  <div class="table-bar">
    <button type="button" id="refresh" class="secondary">Refresh</button>
  </div>

  <table>
    <thead>
      <tr><th>PR</th><th>Source</th><th>Workflow</th><th>Status</th><th>Verdict</th><th>Tokens</th><th>Run time (s)</th></tr>
    </thead>
    <tbody id="rows"><tr><td colspan="7" class="muted">Loading…</td></tr></tbody>
  </table>

  <script type="module">
    const rows = document.getElementById('rows')
    const form = document.getElementById('run')
    const pr = document.getElementById('pr')
    const go = document.getElementById('go')
    const refresh = document.getElementById('refresh')
    const workflow = document.getElementById('workflow')
    let openId = null

    const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    const fmtVal = (v) => { if (v === null || v === undefined) return ''; if (typeof v === 'string') return v; try { return JSON.stringify(v, null, 2) } catch { return String(v) } }

    async function loadWorkflows() {
      try {
        const res = await fetch('api/workflows')
        if (!res.ok) return
        const names = await res.json()
        if (!Array.isArray(names) || names.length < 2) return
        workflow.innerHTML = names.map((n) => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('')
        workflow.hidden = false
      } catch {}
    }

    async function load() {
      refresh.disabled = true
      try {
        const list = await fetch('api/reviews').then((r) => r.json())
        rows.innerHTML = list.length ? '' : '<tr><td colspan="7" class="muted">No reviews yet.</td></tr>'
        for (const rv of list) {
          const tr = document.createElement('tr')
          tr.className = 'review'
          tr.innerHTML =
            '<td><code>' + esc(shortPr(rv.pr_url)) + '</code></td>' +
            '<td>' + (rv.source ? '<code>' + esc(rv.source) + '</code>' : '<span class="muted">—</span>') + '</td>' +
            '<td>' + (rv.workflow ? '<code>' + esc(rv.workflow) + '</code>' : '<span class="muted">—</span>') + '</td>' +
            '<td><span class="pill ' + esc(rv.status) + '">' + esc(rv.status) + '</span></td>' +
            '<td>' + (rv.verdict ? '<span class="pill ' + esc(rv.verdict) + '">' + esc(rv.verdict) + '</span>' : '<span class="muted">—</span>') + '</td>' +
            '<td class="muted">' + (rv.input_tokens + rv.output_tokens) + '</td>' +
            '<td class="muted">' + runtime(rv) + '</td>'
          tr.onclick = () => toggle(rv.id, tr)
          rows.append(tr)
          if (rv.id === openId) await toggle(rv.id, tr, true)
        }
      } finally {
        refresh.disabled = false
      }
    }

    function shortPr(u) { try { const p = new URL(u).pathname.split('/'); return p[1] + '/' + p[2] + '#' + p[4] } catch { return u } }

    function runtime(rv) {
      if (rv.status === 'running') return '—'
      const ms = new Date(rv.updated_at).getTime() - new Date(rv.created_at).getTime()
      if (!Number.isFinite(ms) || ms < 0) return '—'
      return (ms / 1000).toFixed(1)
    }

    async function toggle(id, tr, force) {
      const existing = tr.nextElementSibling
      if (existing && existing.classList.contains('detail') && !force) { existing.remove(); openId = null; return }
      if (existing && existing.classList.contains('detail')) existing.remove()
      openId = id
      const data = await fetch('api/reviews/' + id).then((r) => r.json())
      const detail = document.createElement('tr')
      detail.className = 'detail'
      const findings = data.findings.map((f) => '<div><strong>' + esc(f.agent) + '</strong><pre>' + esc(f.note) + '</pre></div>').join('') || '<span class="muted">No findings recorded.</span>'
      const spanBody = (s) => {
        const parts = []
        const inp = fmtVal(s.input); if (inp) parts.push('<div class="span-io"><span class="label">input</span><pre>' + esc(inp) + '</pre></div>')
        const out = fmtVal(s.output); if (out) parts.push('<div class="span-io"><span class="label">output</span><pre>' + esc(out) + '</pre></div>')
        if (s.error) parts.push('<div class="span-io"><span class="label">error</span><pre>' + esc(s.error) + '</pre></div>')
        return parts.join('') || '<div class="span-io"><span class="muted">No details recorded.</span></div>'
      }
      const spans = data.spans.map((s) => '<details class="span"><summary><code>' + esc(s.kind) + ':' + esc(s.name) + '</code> — ' + esc(s.status) + '</summary>' + spanBody(s) + '</details>').join('')
      const spansHeader = data.spans.length
        ? '<h4>Agent spans <button type="button" class="link toggle-spans">expand all</button></h4>'
        : '<h4>Agent spans</h4>'
      detail.innerHTML = '<td colspan="7"><strong>Reason:</strong> ' + esc(data.review.reason || '—') + '<h4>Reviewer findings</h4>' + findings + spansHeader + (spans || '<span class="muted">No spans recorded.</span>') + '</td>'
      tr.after(detail)
      const toggleBtn = detail.querySelector('.toggle-spans')
      if (toggleBtn) {
        toggleBtn.onclick = () => {
          const all = [...detail.querySelectorAll('details.span')]
          const anyClosed = all.some((d) => !d.open)
          all.forEach((d) => { d.open = anyClosed })
          toggleBtn.textContent = anyClosed ? 'collapse all' : 'expand all'
        }
      }
    }

    refresh.onclick = () => load()

    form.onsubmit = async (e) => {
      e.preventDefault()
      go.disabled = true
      try {
        const payload = { prUrl: pr.value }
        if (!workflow.hidden && workflow.value) payload.workflow = workflow.value
        await fetch('api/reviews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        pr.value = ''
      } finally {
        go.disabled = false
        load()
      }
    }

    loadWorkflows()
    load()
  </script>
</body>
</html>`
}
