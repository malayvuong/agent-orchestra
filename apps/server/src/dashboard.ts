import type { ServerResponse } from 'node:http'

export function serveDashboard(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(DASHBOARD_HTML)
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Orchestra</title>
<style>
  :root {
    --bg: #0f1117; --surface: #1a1d27; --border: #2a2d3a;
    --text: #e1e4ed; --text2: #8b8fa3; --accent: #6c8cff;
    --green: #4ade80; --red: #f87171; --yellow: #fbbf24; --blue: #60a5fa;
    --surface2: #222639;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

  /* Layout */
  .header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 16px 24px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .header .version { color: var(--text2); font-size: 13px; }
  .header-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
  .nav { display: flex; gap: 4px; background: var(--surface); padding: 8px 24px; border-bottom: 1px solid var(--border); overflow-x: auto; }
  .nav button { background: none; border: none; color: var(--text2); padding: 8px 16px; cursor: pointer; border-radius: 6px; font-size: 14px; white-space: nowrap; }
  .nav button:hover { background: var(--border); color: var(--text); }
  .nav button.active { background: var(--accent); color: #fff; }
  .content { max-width: 1200px; margin: 0 auto; padding: 24px; }

  /* Cards */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .stat .label { color: var(--text2); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat .value { font-size: 28px; font-weight: 700; margin-top: 4px; }

  /* Tables */
  .table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid var(--border); }
  table { width: 100%; border-collapse: collapse; background: var(--surface); }
  th { text-align: left; padding: 10px 14px; font-size: 12px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); background: var(--bg); }
  td { padding: 10px 14px; font-size: 14px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(108,140,255,0.05); }
  .clickable { cursor: pointer; }

  /* Badges */
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
  .badge-green { background: rgba(74,222,128,0.15); color: var(--green); }
  .badge-red { background: rgba(248,113,113,0.15); color: var(--red); }
  .badge-yellow { background: rgba(251,191,36,0.15); color: var(--yellow); }
  .badge-blue { background: rgba(96,165,250,0.15); color: var(--blue); }
  .badge-gray { background: rgba(139,143,163,0.15); color: var(--text2); }

  /* Detail panel */
  .detail { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-top: 16px; }
  .detail h3 { margin-bottom: 12px; font-size: 16px; }
  .detail-grid { display: grid; grid-template-columns: 140px 1fr; gap: 6px 16px; font-size: 14px; }
  .detail-grid .k { color: var(--text2); }
  .detail-grid .v { word-break: break-all; }
  pre.json { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px; font-size: 13px; overflow-x: auto; max-height: 400px; overflow-y: auto; margin-top: 12px; color: var(--text2); white-space: pre-wrap; word-wrap: break-word; }

  /* Toggle switch */
  .toggle { position: relative; display: inline-block; width: 40px; height: 22px; cursor: pointer; vertical-align: middle; }
  .toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
  .toggle .slider { position: absolute; inset: 0; background: var(--border); border-radius: 11px; transition: 0.2s; }
  .toggle .slider::before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; bottom: 3px; background: var(--text); border-radius: 50%; transition: 0.2s; }
  .toggle input:checked + .slider { background: var(--accent); }
  .toggle input:checked + .slider::before { transform: translateX(18px); }

  /* Buttons */
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px; cursor: pointer; transition: all 0.15s; }
  .btn:hover { background: var(--surface2); border-color: var(--accent); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn-primary:hover { background: #5a7aee; }
  .btn-danger { border-color: var(--red); color: var(--red); }
  .btn-danger:hover { background: rgba(248,113,113,0.1); }
  .btn-sm { padding: 4px 10px; font-size: 12px; }

  /* Forms */
  .form-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-top: 16px; }
  .form-group { margin-bottom: 14px; }
  .form-group label { display: block; font-size: 12px; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .form-group input, .form-group textarea, .form-group select {
    width: 100%; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 14px; font-family: inherit;
  }
  .form-group input:focus, .form-group textarea:focus, .form-group select:focus { outline: none; border-color: var(--accent); }
  .form-group textarea { resize: vertical; min-height: 60px; }
  .form-actions { display: flex; gap: 8px; margin-top: 16px; }

  /* Select for refresh */
  .refresh-select { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; color: var(--text); font-size: 13px; cursor: pointer; }
  .refresh-select:focus { outline: none; border-color: var(--accent); }

  /* Status select dropdown */
  .status-select { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; color: var(--text); font-size: 13px; cursor: pointer; }
  .status-select:focus { outline: none; border-color: var(--accent); }

  /* Toast */
  .toast-container { position: fixed; top: 16px; right: 16px; z-index: 10000; display: flex; flex-direction: column; gap: 8px; }
  .toast { padding: 12px 20px; border-radius: 8px; font-size: 14px; color: #fff; animation: toastIn 0.25s ease-out; box-shadow: 0 4px 12px rgba(0,0,0,0.3); max-width: 400px; }
  .toast-success { background: #16a34a; }
  .toast-error { background: #dc2626; }
  .toast-info { background: #2563eb; }
  @keyframes toastIn { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes toastOut { from { opacity: 1; } to { opacity: 0; transform: translateX(40px); } }

  /* Modal overlay */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 9000; display: flex; align-items: center; justify-content: center; }
  .modal-box { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 24px; max-width: 440px; width: 90%; }
  .modal-box h3 { margin-bottom: 12px; font-size: 16px; }
  .modal-box p { color: var(--text2); font-size: 14px; margin-bottom: 20px; }
  .modal-box .modal-actions { display: flex; gap: 8px; justify-content: flex-end; }

  /* Spinner */
  .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Transcript chat UI */
  .transcript { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
  .transcript-entry { max-width: 75%; padding: 10px 14px; border-radius: 10px; font-size: 14px; line-height: 1.5; word-break: break-word; }
  .transcript-entry.user { align-self: flex-start; background: var(--surface2); border: 1px solid var(--border); }
  .transcript-entry.assistant { align-self: flex-end; background: rgba(108,140,255,0.12); border: 1px solid rgba(108,140,255,0.25); }
  .transcript-entry.system { align-self: center; background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); color: var(--yellow); font-size: 13px; text-align: center; }
  .transcript-entry .meta { font-size: 11px; color: var(--text2); margin-bottom: 4px; }
  .transcript-entry .trust-tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; margin-left: 6px; }
  .trust-full { background: rgba(74,222,128,0.2); color: var(--green); }
  .trust-limited { background: rgba(251,191,36,0.2); color: var(--yellow); }
  .trust-none { background: rgba(248,113,113,0.2); color: var(--red); }

  .empty { text-align: center; padding: 40px; color: var(--text2); }
  .section-title { font-size: 16px; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .back { color: var(--accent); cursor: pointer; font-size: 14px; margin-bottom: 16px; display: inline-block; }
  .back:hover { text-decoration: underline; }
  code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }

  @media (max-width: 768px) {
    .content { padding: 16px; }
    .stats { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
    .header { padding: 12px 16px; }
    .nav { padding: 6px 16px; }
    .detail-grid { grid-template-columns: 1fr; }
    .transcript-entry { max-width: 90%; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>Agent Orchestra</h1>
  <span class="version" id="version"></span>
  <div class="header-right">
    <label style="font-size:13px;color:var(--text2);display:flex;align-items:center;gap:6px;">
      Auto-refresh:
      <select class="refresh-select" id="refreshInterval" onchange="setRefreshInterval(this.value)">
        <option value="0">Off</option>
        <option value="5000">5s</option>
        <option value="15000">15s</option>
        <option value="30000">30s</option>
      </select>
    </label>
  </div>
</div>

<div class="nav" id="nav">
  <button class="active" data-tab="overview">Overview</button>
  <button data-tab="runs">Runs</button>
  <button data-tab="tasks">Tasks</button>
  <button data-tab="jobs">Review Jobs</button>
  <button data-tab="automation">Automation</button>
  <button data-tab="sessions">Sessions</button>
  <button data-tab="projects">Projects</button>
</div>

<div class="content" id="content"></div>
<div class="toast-container" id="toasts"></div>

<script>
// ---- Globals ----
const API = window.location.origin;
let currentTab = 'overview';
let refreshTimer = null;
let detailView = null; // tracks if we're in a detail view (prevents auto-refresh from overwriting)

// ---- Utility ----
function $(id) { return document.getElementById(id); }

function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function badge(status) {
  if (!status) return '<span class="badge badge-gray">-</span>';
  const map = {
    completed: 'green', done: 'green', ok: 'green', success: 'green', enabled: 'green',
    running: 'blue', in_progress: 'blue', active: 'blue',
    failed: 'red', error: 'red',
    blocked: 'yellow', waiting: 'yellow', queued: 'yellow', pending: 'yellow',
    cancelled: 'gray', draft: 'gray', disabled: 'gray', off: 'gray',
  };
  return '<span class="badge badge-' + (map[status] || 'gray') + '">' + escHtml(status) + '</span>';
}

function ts(v) {
  if (!v) return '-';
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function dur(start, end) {
  if (!start || !end) return '-';
  const s = typeof start === 'number' ? start : new Date(start).getTime();
  const e = typeof end === 'number' ? end : new Date(end).getTime();
  const ms = e - s;
  if (ms < 0) return '-';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'm';
}

function short(id) { return id ? String(id).slice(0, 8) : '-'; }

// ---- API helpers ----
async function apiGet(path) {
  try {
    const r = await fetch(API + path);
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(t || r.statusText); }
    return await r.json();
  } catch (e) { return null; }
}

async function apiCall(method, path, body) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(API + path, opts);
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { message: text }; }
    if (!r.ok) throw new Error(data.error || data.message || r.statusText);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message || 'Request failed' };
  }
}

// ---- Toast ----
function toast(message, type) {
  type = type || 'success';
  const container = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(function() {
    el.style.animation = 'toastOut 0.25s ease-in forwards';
    setTimeout(function() { el.remove(); }, 250);
  }, 3000);
}

// ---- Confirm dialog ----
function confirmAction(message) {
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-box">' +
        '<h3>Confirm</h3>' +
        '<p>' + escHtml(message) + '</p>' +
        '<div class="modal-actions">' +
          '<button class="btn" id="confirmNo">Cancel</button>' +
          '<button class="btn btn-danger" id="confirmYes">Confirm</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#confirmYes').onclick = function() { overlay.remove(); resolve(true); };
    overlay.querySelector('#confirmNo').onclick = function() { overlay.remove(); resolve(false); };
    overlay.addEventListener('click', function(e) { if (e.target === overlay) { overlay.remove(); resolve(false); } });
  });
}

// ---- Auto-refresh ----
function setRefreshInterval(ms) {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  ms = parseInt(ms, 10);
  if (ms > 0) {
    refreshTimer = setInterval(function() {
      if (!detailView) render();
    }, ms);
  }
}

// ---- Navigation ----
$('nav').addEventListener('click', function(e) {
  if (e.target.tagName !== 'BUTTON') return;
  document.querySelectorAll('.nav button').forEach(function(b) { b.classList.remove('active'); });
  e.target.classList.add('active');
  currentTab = e.target.dataset.tab;
  detailView = null;
  render();
});

// ---- Table builder ----
function buildTable(cols, rows, opts) {
  opts = opts || {};
  if (rows.length === 0) return '<div class="empty">' + (opts.emptyMessage || 'No data') + '</div>';
  var html = '<div class="table-wrap"><table><tr>';
  cols.forEach(function(c) { html += '<th>' + escHtml(c.label) + '</th>'; });
  html += '</tr>';
  rows.forEach(function(row, i) {
    var cls = opts.onClickAttr ? ' class="clickable" onclick="' + opts.onClickAttr(row, i) + '"' : '';
    html += '<tr' + cls + '>';
    cols.forEach(function(c) { html += '<td>' + c.render(row, i) + '</td>'; });
    html += '</tr>';
  });
  html += '</table></div>';
  return html;
}

// ---- Inline form builder ----
function showInlineForm(containerId, fields, onSubmit, onCancel) {
  var container = $(containerId);
  if (!container) return;
  var html = '<div class="form-card" id="inlineFormCard">';
  fields.forEach(function(f) {
    html += '<div class="form-group">';
    html += '<label>' + escHtml(f.label) + '</label>';
    if (f.type === 'textarea') {
      html += '<textarea id="ff_' + f.name + '" placeholder="' + escHtml(f.placeholder || '') + '">' + escHtml(f.value || '') + '</textarea>';
    } else if (f.type === 'toggle') {
      html += '<label class="toggle" style="margin-top:4px"><input type="checkbox" id="ff_' + f.name + '"' + (f.value ? ' checked' : '') + '><span class="slider"></span></label>';
    } else if (f.type === 'select') {
      html += '<select id="ff_' + f.name + '" class="status-select" style="width:100%">';
      (f.options || []).forEach(function(o) {
        html += '<option value="' + escHtml(o.value) + '"' + (o.value === f.value ? ' selected' : '') + '>' + escHtml(o.label) + '</option>';
      });
      html += '</select>';
    } else {
      html += '<input type="' + (f.type || 'text') + '" id="ff_' + f.name + '" placeholder="' + escHtml(f.placeholder || '') + '" value="' + escHtml(f.value || '') + '">';
    }
    html += '</div>';
  });
  html += '<div class="form-actions">';
  html += '<button class="btn" onclick="cancelInlineForm()">Cancel</button>';
  html += '<button class="btn btn-primary" onclick="submitInlineForm()">Submit</button>';
  html += '</div></div>';
  container.innerHTML = html;

  window._inlineFormFields = fields;
  window._inlineFormSubmit = onSubmit;
  window._inlineFormCancel = onCancel;
}

window.submitInlineForm = async function() {
  var data = {};
  (window._inlineFormFields || []).forEach(function(f) {
    var el = $('ff_' + f.name);
    if (!el) return;
    if (f.type === 'toggle') {
      data[f.name] = el.checked;
    } else {
      data[f.name] = el.value;
    }
  });
  var submitBtn = document.querySelector('#inlineFormCard .btn-primary');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span class="spinner"></span> Submitting...'; }
  if (window._inlineFormSubmit) await window._inlineFormSubmit(data);
};

window.cancelInlineForm = function() {
  var card = $('inlineFormCard');
  if (card) card.remove();
  if (window._inlineFormCancel) window._inlineFormCancel();
};

// ---- Main render ----
async function render() {
  var c = $('content');
  c.innerHTML = '<div class="empty"><span class="spinner"></span> Loading...</div>';

  switch (currentTab) {
    case 'overview': return renderOverview(c);
    case 'runs': return renderRuns(c);
    case 'tasks': return renderTasks(c);
    case 'jobs': return renderJobs(c);
    case 'automation': return renderAutomation(c);
    case 'sessions': return renderSessions(c);
    case 'projects': return renderProjects(c);
  }
}

// =============== OVERVIEW ===============
async function renderOverview(c) {
  var results = await Promise.all([
    apiGet('/api/status'),
    apiGet('/api/jobs'),
    apiGet('/api/runs'),
    apiGet('/api/tasks'),
    apiGet('/api/automation'),
  ]);
  var status = results[0];
  var jobsData = results[1];
  var runsData = results[2];
  var tasksData = results[3];
  var autoData = results[4];

  if (status) $('version').textContent = 'v' + status.version;

  var jobs = (jobsData && jobsData.jobs) || [];
  var runs = (runsData && runsData.runs) || [];
  var tasks = (tasksData && tasksData.tasks) || [];
  var autos = (autoData && autoData.jobs) || [];

  var runningTasks = tasks.filter(function(t) { return t.status === 'running' || t.status === 'in_progress'; }).length;
  var failedRuns = runs.filter(function(r) { return r.status === 'failed'; }).length;
  var guardBlocks = runs.reduce(function(sum, r) { return sum + ((r.guardViolations && r.guardViolations.length) || 0); }, 0);

  var runsTableHtml = buildTable(
    [
      { label: 'Run ID', render: function(r) { return '<code>' + short(r.runId) + '</code>'; } },
      { label: 'Source', render: function(r) { return escHtml(r.source || '-'); } },
      { label: 'Status', render: function(r) { return badge(r.status); } },
      { label: 'Tools', render: function(r) { return (r.toolCalls && r.toolCalls.length) || 0; } },
      { label: 'Guard', render: function(r) { return (r.guardViolations && r.guardViolations.length) ? '<span class="badge badge-yellow">' + r.guardViolations.length + '</span>' : '0'; } },
      { label: 'Started', render: function(r) { return ts(r.startedAt); } },
      { label: 'Duration', render: function(r) { return dur(r.startedAt, r.endedAt); } },
    ],
    runs.slice(0, 10),
    { onClickAttr: function(r) { return "showRun('" + escHtml(r.runId) + "')"; }, emptyMessage: 'No runs yet' }
  );

  var tasksTableHtml = buildTable(
    [
      { label: 'Task ID', render: function(t) { return '<code>' + short(t.taskId) + '</code>'; } },
      { label: 'Title', render: function(t) { return escHtml((t.title || '').slice(0, 50)); } },
      { label: 'Status', render: function(t) { return badge(t.status); } },
      { label: 'Origin', render: function(t) { return escHtml(t.origin || '-'); } },
      { label: 'Exec Required', render: function(t) { return t.executionRequired ? 'Yes' : 'No'; } },
      { label: 'Updated', render: function(t) { return ts(t.updatedAt); } },
    ],
    tasks.slice(0, 10),
    { onClickAttr: function(t) { return "showTask('" + escHtml(t.taskId) + "')"; }, emptyMessage: 'No tasks yet' }
  );

  c.innerHTML =
    '<div class="stats">' +
      '<div class="stat"><div class="label">Review Jobs</div><div class="value">' + jobs.length + '</div></div>' +
      '<div class="stat"><div class="label">Runs</div><div class="value">' + runs.length + '</div></div>' +
      '<div class="stat"><div class="label">Tasks</div><div class="value">' + tasks.length + '</div></div>' +
      '<div class="stat"><div class="label">Automation Jobs</div><div class="value">' + autos.length + '</div></div>' +
      '<div class="stat"><div class="label">Running Tasks</div><div class="value" style="color:var(--blue)">' + runningTasks + '</div></div>' +
      '<div class="stat"><div class="label">Failed Runs</div><div class="value" style="color:var(--red)">' + failedRuns + '</div></div>' +
      '<div class="stat"><div class="label">Guard Violations</div><div class="value" style="color:var(--yellow)">' + guardBlocks + '</div></div>' +
    '</div>' +
    '<div class="section-title">Recent Runs</div>' +
    runsTableHtml +
    '<div style="margin-top:24px" class="section-title">Recent Tasks</div>' +
    tasksTableHtml;
}

// =============== RUNS ===============
async function renderRuns(c) {
  var data = await apiGet('/api/runs');
  var runs = (data && data.runs) || [];
  c.innerHTML = '<div class="section-title">All Runs (' + runs.length + ')</div>' +
    buildTable(
      [
        { label: 'Run ID', render: function(r) { return '<code>' + short(r.runId) + '</code>'; } },
        { label: 'Source', render: function(r) { return escHtml(r.source || '-'); } },
        { label: 'Status', render: function(r) { return badge(r.status); } },
        { label: 'Tools', render: function(r) { return (r.toolCalls && r.toolCalls.length) || 0; } },
        { label: 'Guard', render: function(r) { return (r.guardViolations && r.guardViolations.length) ? '<span class="badge badge-yellow">' + r.guardViolations.length + '</span>' : '0'; } },
        { label: 'Started', render: function(r) { return ts(r.startedAt); } },
        { label: 'Duration', render: function(r) { return dur(r.startedAt, r.endedAt); } },
      ],
      runs,
      { onClickAttr: function(r) { return "showRun('" + escHtml(r.runId) + "')"; }, emptyMessage: 'No runs yet' }
    );
}

window.showRun = async function(runId) {
  detailView = 'run';
  var c = $('content');
  c.innerHTML = '<div class="empty"><span class="spinner"></span> Loading run...</div>';
  var data = await apiGet('/api/runs/' + encodeURIComponent(runId));
  if (!data || !data.run) { c.innerHTML = '<span class="back" onclick="backToList()">Back</span><div class="empty">Run not found</div>'; return; }
  var r = data.run;

  var toolCallsHtml = '';
  if (r.toolCalls && r.toolCalls.length) {
    toolCallsHtml = '<h3 style="margin-top:20px">Tool Calls (' + r.toolCalls.length + ')</h3>' +
      buildTable(
        [
          { label: 'Name', render: function(tc) { return escHtml(tc.name); } },
          { label: 'Status', render: function(tc) { return badge(tc.status); } },
          { label: 'Duration', render: function(tc) { return tc.durationMs ? tc.durationMs + 'ms' : '-'; } },
          { label: 'Summary', render: function(tc) { return escHtml((tc.summary || '-').slice(0, 100)); } },
        ],
        r.toolCalls,
        { emptyMessage: 'No tool calls' }
      );
  }

  var guardHtml = '';
  if (r.guardViolations && r.guardViolations.length) {
    guardHtml = '<h3 style="margin-top:20px;color:var(--yellow)">Guard Violations (' + r.guardViolations.length + ')</h3>' +
      buildTable(
        [
          { label: 'Type', render: function(v) { return escHtml(v.type); } },
          { label: 'Message', render: function(v) { return escHtml(v.message); } },
          { label: 'Resolution', render: function(v) { return badge(v.resolution); } },
        ],
        r.guardViolations,
        { emptyMessage: 'No violations' }
      );
  }

  var cancelBtnHtml = '';
  if (r.status === 'running' || r.status === 'in_progress') {
    cancelBtnHtml = '<button class="btn btn-danger" style="margin-top:16px" onclick="cancelRun(\\'' + escHtml(r.runId) + '\\')">Cancel Run</button>';
  }

  c.innerHTML =
    '<span class="back" onclick="backToList()">Back to Runs</span>' +
    '<div class="detail">' +
      '<h3>Run ' + escHtml(r.runId) + '</h3>' +
      '<div class="detail-grid">' +
        '<span class="k">Status</span><span class="v">' + badge(r.status) + '</span>' +
        '<span class="k">Source</span><span class="v">' + escHtml(r.source || '-') + '</span>' +
        '<span class="k">Session</span><span class="v">' + escHtml(r.sessionId || '-') + '</span>' +
        '<span class="k">Task</span><span class="v">' + escHtml(r.taskId || '-') + '</span>' +
        '<span class="k">Model</span><span class="v">' + escHtml(r.model || '-') + '</span>' +
        '<span class="k">Started</span><span class="v">' + ts(r.startedAt) + '</span>' +
        '<span class="k">Ended</span><span class="v">' + ts(r.endedAt) + '</span>' +
        '<span class="k">Duration</span><span class="v">' + dur(r.startedAt, r.endedAt) + '</span>' +
        (r.failureReason ? '<span class="k">Failure</span><span class="v" style="color:var(--red)">' + escHtml(r.failureReason) + '</span>' : '') +
      '</div>' +
      toolCallsHtml +
      guardHtml +
      (r.finalReply ? '<h3 style="margin-top:20px">Final Reply</h3><pre class="json">' + escHtml(r.finalReply) + '</pre>' : '') +
      cancelBtnHtml +
    '</div>';
};

window.cancelRun = async function(runId) {
  var ok = await confirmAction('Cancel this run? This cannot be undone.');
  if (!ok) return;
  var res = await apiCall('PATCH', '/api/runs/' + encodeURIComponent(runId), { status: 'cancelled' });
  if (res.ok) { toast('Run cancelled'); showRun(runId); }
  else { toast('Failed to cancel: ' + res.error, 'error'); }
};

// =============== TASKS ===============
async function renderTasks(c) {
  var data = await apiGet('/api/tasks');
  var tasks = (data && data.tasks) || [];
  c.innerHTML =
    '<div class="toolbar">' +
      '<div class="section-title" style="margin-bottom:0">All Tasks (' + tasks.length + ')</div>' +
      '<button class="btn btn-primary" onclick="showCreateTaskForm()">+ Create Task</button>' +
    '</div>' +
    '<div id="taskFormArea"></div>' +
    buildTable(
      [
        { label: 'Task ID', render: function(t) { return '<code>' + short(t.taskId) + '</code>'; } },
        { label: 'Title', render: function(t) { return escHtml((t.title || '').slice(0, 50)); } },
        { label: 'Status', render: function(t) { return badge(t.status); } },
        { label: 'Origin', render: function(t) { return escHtml(t.origin || '-'); } },
        { label: 'Exec Required', render: function(t) { return t.executionRequired ? 'Yes' : 'No'; } },
        { label: 'Updated', render: function(t) { return ts(t.updatedAt); } },
      ],
      tasks,
      { onClickAttr: function(t) { return "showTask('" + escHtml(t.taskId) + "')"; }, emptyMessage: 'No tasks yet. Create one to get started.' }
    );
}

window.showCreateTaskForm = function() {
  showInlineForm('taskFormArea', [
    { name: 'title', label: 'Title', placeholder: 'Task title' },
    { name: 'objective', label: 'Objective', type: 'textarea', placeholder: 'What should be accomplished?' },
    { name: 'executionRequired', label: 'Execution Required', type: 'toggle', value: false },
  ], async function(data) {
    var res = await apiCall('POST', '/api/tasks', {
      title: data.title,
      objective: data.objective,
      executionRequired: data.executionRequired,
    });
    if (res.ok) { toast('Task created'); render(); }
    else { toast('Failed: ' + res.error, 'error'); }
  });
};

window.showTask = async function(taskId) {
  detailView = 'task';
  var c = $('content');
  c.innerHTML = '<div class="empty"><span class="spinner"></span> Loading task...</div>';
  var data = await apiGet('/api/tasks/' + encodeURIComponent(taskId));
  if (!data || !data.task) { c.innerHTML = '<span class="back" onclick="backToList()">Back</span><div class="empty">Task not found</div>'; return; }
  var t = data.task;

  var statusOptions = ['pending', 'queued', 'running', 'in_progress', 'blocked', 'done', 'failed', 'cancelled'];
  var statusSelectHtml = '<select class="status-select" id="taskStatusSelect">';
  statusOptions.forEach(function(s) {
    statusSelectHtml += '<option value="' + s + '"' + (s === t.status ? ' selected' : '') + '>' + s + '</option>';
  });
  statusSelectHtml += '</select>';
  statusSelectHtml += ' <button class="btn btn-sm" onclick="updateTaskStatus(\\'' + escHtml(t.taskId) + '\\')">Update</button>';

  var deleteBtnHtml = '';
  if (t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') {
    deleteBtnHtml = '<button class="btn btn-danger" style="margin-left:8px" onclick="deleteTask(\\'' + escHtml(t.taskId) + '\\')">Delete Task</button>';
  }

  c.innerHTML =
    '<span class="back" onclick="backToList()">Back to Tasks</span>' +
    '<div class="detail">' +
      '<h3>' + escHtml(t.title || 'Task') + '</h3>' +
      '<div class="detail-grid">' +
        '<span class="k">Task ID</span><span class="v">' + escHtml(t.taskId) + '</span>' +
        '<span class="k">Status</span><span class="v">' + badge(t.status) + '</span>' +
        '<span class="k">Origin</span><span class="v">' + escHtml(t.origin || '-') + '</span>' +
        '<span class="k">Exec Required</span><span class="v">' + (t.executionRequired ? 'Yes' : 'No') + '</span>' +
        '<span class="k">Session</span><span class="v">' + escHtml(t.sessionId || '-') + '</span>' +
        '<span class="k">Run</span><span class="v">' + escHtml(t.runId || '-') + '</span>' +
        '<span class="k">Created</span><span class="v">' + ts(t.createdAt) + '</span>' +
        '<span class="k">Updated</span><span class="v">' + ts(t.updatedAt) + '</span>' +
        '<span class="k">Last Action</span><span class="v">' + ts(t.lastActionAt) + '</span>' +
        '<span class="k">Last Evidence</span><span class="v">' + escHtml(t.lastEvidence || '-') + '</span>' +
        (t.blocker ? '<span class="k">Blocker</span><span class="v" style="color:var(--red)">' + escHtml(t.blocker) + '</span>' : '') +
        (t.resumeHint ? '<span class="k">Resume Hint</span><span class="v">' + escHtml(t.resumeHint) + '</span>' : '') +
      '</div>' +
      '<h3 style="margin-top:20px">Objective</h3>' +
      '<pre class="json">' + escHtml(t.objective) + '</pre>' +
      '<div style="margin-top:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<span style="color:var(--text2);font-size:13px">Update status:</span>' +
        statusSelectHtml +
        deleteBtnHtml +
      '</div>' +
    '</div>';
};

window.updateTaskStatus = async function(taskId) {
  var sel = $('taskStatusSelect');
  if (!sel) return;
  var newStatus = sel.value;
  var res = await apiCall('PATCH', '/api/tasks/' + encodeURIComponent(taskId), { status: newStatus });
  if (res.ok) { toast('Status updated to ' + newStatus); showTask(taskId); }
  else { toast('Failed: ' + res.error, 'error'); }
};

window.deleteTask = async function(taskId) {
  var ok = await confirmAction('Delete this task? This cannot be undone.');
  if (!ok) return;
  var res = await apiCall('DELETE', '/api/tasks/' + encodeURIComponent(taskId));
  if (res.ok) { toast('Task deleted'); detailView = null; render(); }
  else { toast('Failed: ' + res.error, 'error'); }
};

// =============== REVIEW JOBS ===============
async function renderJobs(c) {
  var data = await apiGet('/api/jobs');
  var jobs = (data && data.jobs) || [];
  c.innerHTML = '<div class="section-title">Review Jobs (' + jobs.length + ')</div>' +
    buildTable(
      [
        { label: 'Job ID', render: function(j) { return '<code>' + short(j.id) + '</code>'; } },
        { label: 'Title', render: function(j) { return escHtml((j.title || '').slice(0, 60)); } },
        { label: 'Status', render: function(j) { return badge(j.status); } },
        { label: 'Protocol', render: function(j) { return escHtml(j.protocol || '-'); } },
        { label: 'Created', render: function(j) { return ts(j.createdAt); } },
      ],
      jobs,
      { onClickAttr: function(j) { return "showJob('" + escHtml(j.id) + "')"; }, emptyMessage: 'No review jobs yet' }
    );
}

window.showJob = async function(jobId) {
  detailView = 'job';
  var c = $('content');
  c.innerHTML = '<div class="empty"><span class="spinner"></span> Loading job...</div>';
  var data = await apiGet('/api/jobs/' + encodeURIComponent(jobId));
  if (!data || !data.job) { c.innerHTML = '<span class="back" onclick="backToList()">Back</span><div class="empty">Job not found</div>'; return; }
  var j = data.job;
  var rounds = data.rounds || [];

  var roundsHtml = '';
  if (rounds.length) {
    roundsHtml = '<h3 style="margin-top:20px">Rounds (' + rounds.length + ')</h3>' +
      buildTable(
        [
          { label: '#', render: function(r) { return r.index; } },
          { label: 'State', render: function(r) { return escHtml(r.state); } },
          { label: 'Findings', render: function(r) {
            var fc = ((r.architectOutput && r.architectOutput.findings && r.architectOutput.findings.length) || 0) +
              (r.reviewerOutputs || []).reduce(function(s, ro) { return s + ((ro.output && ro.output.findings && ro.output.findings.length) || 0); }, 0);
            return fc;
          }},
        ],
        rounds,
        { emptyMessage: 'No rounds' }
      );
  }

  c.innerHTML =
    '<span class="back" onclick="backToList()">Back to Review Jobs</span>' +
    '<div class="detail">' +
      '<h3>' + escHtml(j.title || 'Job') + '</h3>' +
      '<div class="detail-grid">' +
        '<span class="k">Job ID</span><span class="v">' + escHtml(j.id) + '</span>' +
        '<span class="k">Status</span><span class="v">' + badge(j.status) + '</span>' +
        '<span class="k">Protocol</span><span class="v">' + escHtml(j.protocol || '-') + '</span>' +
        '<span class="k">Mode</span><span class="v">' + escHtml(j.mode || '-') + '</span>' +
        '<span class="k">Created</span><span class="v">' + ts(j.createdAt) + '</span>' +
        '<span class="k">Agents</span><span class="v">' + escHtml(j.agents ? j.agents.map(function(a) { return a.role + ' (' + a.providerKey + ')'; }).join(', ') : '-') + '</span>' +
      '</div>' +
      roundsHtml +
    '</div>';
};

// =============== AUTOMATION ===============
async function renderAutomation(c) {
  var data = await apiGet('/api/automation');
  var jobs = (data && data.jobs) || [];
  c.innerHTML =
    '<div class="toolbar">' +
      '<div class="section-title" style="margin-bottom:0">Automation Jobs (' + jobs.length + ')</div>' +
      '<button class="btn btn-primary" onclick="showAddAutomationForm()">+ Add Job</button>' +
    '</div>' +
    '<div id="autoFormArea"></div>' +
    buildTable(
      [
        { label: 'ID', render: function(j) { return '<code>' + short(j.id) + '</code>'; } },
        { label: 'Name', render: function(j) { return escHtml(j.name || '-'); } },
        { label: 'Schedule', render: function(j) { return escHtml(j.schedule || '-'); } },
        { label: 'Enabled', render: function(j, i) {
          return '<label class="toggle" onclick="event.stopPropagation()"><input type="checkbox"' + (j.enabled ? ' checked' : '') + ' onchange="toggleAutomation(\\'' + escHtml(j.id) + '\\', this.checked)"><span class="slider"></span></label>';
        }},
        { label: 'Last Run', render: function(j) { return j.lastRunAt ? ts(j.lastRunAt) : '-'; } },
        { label: 'Last Status', render: function(j) { return j.lastRunStatus ? badge(j.lastRunStatus) : '-'; } },
        { label: 'Actions', render: function(j) {
          return '<button class="btn btn-sm" onclick="event.stopPropagation(); runAutomationNow(\\'' + escHtml(j.id) + '\\', this)">Run Now</button> ' +
                 '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteAutomation(\\'' + escHtml(j.id) + '\\')">Delete</button>';
        }},
      ],
      jobs,
      { onClickAttr: function(j) { return "showAutoLogs('" + escHtml(j.id) + "')"; }, emptyMessage: 'No automation jobs yet. Click "Add Job" to create one.' }
    );
}

window.showAddAutomationForm = function() {
  showInlineForm('autoFormArea', [
    { name: 'id', label: 'Job ID', placeholder: 'unique-job-id' },
    { name: 'name', label: 'Name', placeholder: 'My Automation Job' },
    { name: 'schedule', label: 'Schedule (cron)', placeholder: '0 */6 * * *' },
    { name: 'command', label: 'Command', placeholder: 'npm run build' },
  ], async function(data) {
    var payload = {
      id: data.id,
      name: data.name,
      schedule: data.schedule,
      workflow: { steps: [{ type: 'script', command: data.command }] },
    };
    var res = await apiCall('POST', '/api/automation', payload);
    if (res.ok) { toast('Automation job created'); render(); }
    else { toast('Failed: ' + res.error, 'error'); }
  });
};

window.toggleAutomation = async function(jobId, enabled) {
  var res = await apiCall('PATCH', '/api/automation/' + encodeURIComponent(jobId), { enabled: enabled });
  if (res.ok) { toast(enabled ? 'Job enabled' : 'Job disabled'); }
  else { toast('Failed: ' + res.error, 'error'); render(); }
};

window.runAutomationNow = async function(jobId, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  var res = await apiCall('POST', '/api/automation/' + encodeURIComponent(jobId) + '/run');
  if (res.ok) { toast('Job triggered'); render(); }
  else { toast('Failed: ' + res.error, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Run Now'; } }
};

window.deleteAutomation = async function(jobId) {
  var ok = await confirmAction('Delete this automation job? This cannot be undone.');
  if (!ok) return;
  var res = await apiCall('DELETE', '/api/automation/' + encodeURIComponent(jobId));
  if (res.ok) { toast('Job deleted'); render(); }
  else { toast('Failed: ' + res.error, 'error'); }
};

window.showAutoLogs = async function(jobId) {
  detailView = 'autoLogs';
  var c = $('content');
  c.innerHTML = '<div class="empty"><span class="spinner"></span> Loading logs...</div>';
  var data = await apiGet('/api/automation/' + encodeURIComponent(jobId) + '/logs');
  var runs = (data && data.runs) || [];
  c.innerHTML =
    '<span class="back" onclick="backToList()">Back to Automation</span>' +
    '<div class="section-title">Run History: ' + escHtml(jobId) + '</div>' +
    buildTable(
      [
        { label: 'Run ID', render: function(r) { return '<code>' + short(r.runId) + '</code>'; } },
        { label: 'Source', render: function(r) { return escHtml(r.source || '-'); } },
        { label: 'Status', render: function(r) { return badge(r.status); } },
        { label: 'Tools', render: function(r) { return (r.toolCalls && r.toolCalls.length) || 0; } },
        { label: 'Guard', render: function(r) { return (r.guardViolations && r.guardViolations.length) ? '<span class="badge badge-yellow">' + r.guardViolations.length + '</span>' : '0'; } },
        { label: 'Started', render: function(r) { return ts(r.startedAt); } },
        { label: 'Duration', render: function(r) { return dur(r.startedAt, r.endedAt); } },
      ],
      runs,
      { onClickAttr: function(r) { return "showRun('" + escHtml(r.runId) + "')"; }, emptyMessage: 'No runs yet for this job' }
    );
};

// =============== SESSIONS ===============
async function renderSessions(c) {
  var data = await apiGet('/api/sessions');
  var sessions = (data && data.sessions) || [];
  c.innerHTML = '<div class="section-title">Sessions (' + sessions.length + ')</div>' +
    buildTable(
      [
        { label: 'Session ID', render: function(s) { return '<code>' + short(s.sessionId) + '</code>'; } },
        { label: 'Type', render: function(s) { return escHtml(s.sessionType || '-'); } },
        { label: 'Owner', render: function(s) { return escHtml(s.owner || '-'); } },
        { label: 'Last Activity', render: function(s) { return ts(s.lastActivityAt); } },
      ],
      sessions,
      { onClickAttr: function(s) { return "showTranscript('" + escHtml(s.sessionId) + "')"; }, emptyMessage: 'No sessions yet' }
    );
}

window.showTranscript = async function(sessionId) {
  detailView = 'transcript';
  var c = $('content');
  c.innerHTML = '<div class="empty"><span class="spinner"></span> Loading transcript...</div>';
  var data = await apiGet('/api/sessions/' + encodeURIComponent(sessionId) + '/transcript?limit=100');
  var entries = (data && data.entries) || [];

  var transcriptHtml = '';
  if (entries.length === 0) {
    transcriptHtml = '<div class="empty">No transcript entries</div>';
  } else {
    transcriptHtml = '<div class="transcript">';
    entries.forEach(function(e) {
      var role = e.role || 'system';
      var cls = 'transcript-entry';
      if (role === 'user' || role === 'human') cls += ' user';
      else if (role === 'assistant' || role === 'ai') cls += ' assistant';
      else cls += ' system';

      var trustHtml = '';
      if (e.trustLevel) {
        var trustCls = 'trust-tag';
        if (e.trustLevel === 'full') trustCls += ' trust-full';
        else if (e.trustLevel === 'limited') trustCls += ' trust-limited';
        else trustCls += ' trust-none';
        trustHtml = '<span class="' + trustCls + '">' + escHtml(e.trustLevel) + '</span>';
      }

      var contentText = '';
      if (typeof e.content === 'string') contentText = e.content;
      else if (e.content != null) contentText = JSON.stringify(e.content, null, 2);

      transcriptHtml += '<div class="' + cls + '">' +
        '<div class="meta">' + escHtml(role) + ' &middot; ' + ts(e.timestamp) + trustHtml + '</div>' +
        '<div>' + escHtml(contentText).replace(/\\n/g, '<br>') + '</div>' +
      '</div>';
    });
    transcriptHtml += '</div>';
  }

  c.innerHTML =
    '<span class="back" onclick="backToList()">Back to Sessions</span>' +
    '<div class="toolbar">' +
      '<div class="section-title" style="margin-bottom:0">Transcript: ' + short(sessionId) + '</div>' +
      '<button class="btn btn-danger" onclick="deleteSession(\\'' + escHtml(sessionId) + '\\')">Delete Session</button>' +
    '</div>' +
    transcriptHtml;
};

window.deleteSession = async function(sessionId) {
  var ok = await confirmAction('Delete this session and its transcript? This cannot be undone.');
  if (!ok) return;
  var res = await apiCall('DELETE', '/api/sessions/' + encodeURIComponent(sessionId));
  if (res.ok) { toast('Session deleted'); detailView = null; render(); }
  else { toast('Failed: ' + res.error, 'error'); }
};

// =============== PROJECTS ===============
async function renderProjects(c) {
  var data = await apiGet('/api/projects');
  var projects = (data && data.projects) || [];
  c.innerHTML =
    '<div class="toolbar">' +
      '<div class="section-title" style="margin-bottom:0">All Projects (' + projects.length + ')</div>' +
      '<button class="btn btn-primary" onclick="showAddProjectForm()">+ Add Project</button>' +
    '</div>' +
    '<div id="projectFormArea"></div>' +
    buildTable(
      [
        { label: 'Name', render: function(p) { return '<strong>' + escHtml(p.name) + '</strong>'; } },
        { label: 'Path', render: function(p) { return '<span style="font-size:12px;color:var(--text2)">' + escHtml(p.path) + '</span>'; } },
        { label: 'Kind', render: function(p) { return escHtml(p.kind || '-'); } },
        { label: 'Daemon Port', render: function(p) { return p.daemonPort ? '<span class="badge badge-blue">:' + p.daemonPort + '</span>' : '-'; } },
        { label: 'Last Active', render: function(p) { return ts(p.lastActiveAt); } },
        { label: 'Tags', render: function(p) { return (p.tags && p.tags.length) ? p.tags.map(function(t) { return '<span class="badge badge-gray">' + escHtml(t) + '</span>'; }).join(' ') : '-'; } },
        { label: '', render: function(p) {
          return '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); removeProject(\\'' + escHtml(p.path).replace(/'/g, "\\\\'") + '\\')">Remove</button>';
        }},
      ],
      projects,
      { emptyMessage: 'No projects registered yet. Click "Add Project" or run <code>ao setup</code> in a project directory.' }
    );
}

window.showAddProjectForm = function() {
  showInlineForm('projectFormArea', [
    { name: 'path', label: 'Project Path', placeholder: '/path/to/project' },
    { name: 'name', label: 'Name', placeholder: 'my-project' },
    { name: 'tags', label: 'Tags (comma-separated)', placeholder: 'web, frontend' },
    { name: 'daemonPort', label: 'Daemon Port (optional)', placeholder: '3100' },
  ], async function(data) {
    var payload = {
      path: data.path,
      name: data.name,
      tags: data.tags ? data.tags.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [],
    };
    if (data.daemonPort) payload.daemonPort = parseInt(data.daemonPort, 10);
    var res = await apiCall('POST', '/api/projects', payload);
    if (res.ok) { toast('Project added'); render(); }
    else { toast('Failed: ' + res.error, 'error'); }
  });
};

window.removeProject = async function(path) {
  var ok = await confirmAction('Remove project at "' + path + '" from the registry?');
  if (!ok) return;
  var res = await apiCall('DELETE', '/api/projects', { path: path });
  if (res.ok) { toast('Project removed'); render(); }
  else { toast('Failed: ' + res.error, 'error'); }
};

// ---- Back to list helper ----
window.backToList = function() {
  detailView = null;
  render();
};

// ---- Init ----
render();
</script>
</body>
</html>`
