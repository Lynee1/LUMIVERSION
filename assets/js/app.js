(function () {
  'use strict';
  const E = window.YaoyiEngine, I = window.YaoyiI18n, t_ = I.t;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt0 = v => isFinite(v) ? Math.round(v).toLocaleString(I.locale()) : '—';
  const fmt = (v, d) => isFinite(v) ? v.toLocaleString(I.locale(), { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  // money: the model works in CNY; everything shown to the user is converted to GBP at the rate in the sidebar
  const fx = () => { const v = parseFloat((document.getElementById('fx') || {}).value); return v > 0 ? v : 9.02; };
  const G = v => v / fx();
  const yuan = v => (v < 0 ? '−£' : '£') + fmt0(Math.abs(G(v)));
  const gbp = (v, d) => '£' + fmt(G(v), d);
  const iso = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const SN = () => [t_('st1'), t_('st2'), t_('st3')];
  const SS = () => [t_('ss1'), t_('ss2'), t_('ss3')];
  const MN = m => t_('mode_' + m);
  const PAL = ['#0B8F9B', '#D4861A', '#2C7FB8', '#7BB662', '#B5577A', '#6D5BA8', '#E3B341', '#4A6FA5', '#C8463F', '#5BB8B0', '#8E7A5C', '#9A9FB0', '#2F9E73', '#E07B5B', '#3E5C76', '#A3C4DC'];

  // ---------------- sample ingredient table (demo values) ----------------
  // GWP (kg CO2-eq / kg) and EP_P (kg P-eq / kg) are rounded, illustrative values for the demo only
  const SAMPLE_CSV = `name,price,LB,UB,DM,CP,EE,ST,LYS,P,ADC-N,ADC-L,GWP,EP_P
Fish meal,13500,0,500,92,67,9,0,5.0,2.8,92,90,1.3,0.00035
Poultry meal,7500,0,200,94,65,12,0,3.8,2.0,85,88,2.6,0.00060
Soybean meal,3600,0,250,89,46,1.5,5,2.8,0.65,88,80,0.65,0.00045
Soy protein conc.,6000,0,200,92,65,1,2,4.0,0.8,90,80,1.2,0.00070
Wheat gluten,9000,0,100,92,78,1.5,8,1.4,0.25,95,85,2.1,0.00050
Wheat flour,2800,50,250,88,12,1.5,65,0.35,0.2,85,80,0.50,0.00025
Tapioca starch,3000,0,120,88,0.5,0.3,82,0,0.05,50,50,0.80,0.00020
Fish oil,11000,0,80,99,0,99,0,0,0,0,95,1.5,0.00040
Soybean oil,8000,0,60,99,0,99,0,0,0,0,92,2.4,0.00110
MCP,4000,0,30,97,0,0,0,0,22,0,0,1.6,0.00300
Corn gluten meal,5500,0,100,90,60,2.5,10,1.0,0.45,82,80,1.4,0.00055
Lysine,12000,0,10,98,95,0,0,78,0,100,0,5.5,0.00090
Brewer's yeast,5000,0,60,92,45,1.5,5,3.2,1.3,80,70,0.70,0.00030`;

  // ---------------- CSV loading: same column mapping & unit rules as load_ingredients() ----------------
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }
  function mapCol(c) {
    const s = String(c).trim().toLowerCase().replace(/%/g, '').replace(/ /g, '');
    if (['name', '原料', '品名', 'ingredient'].includes(s)) return 'name';
    if (['price', 'cost', '价格', '单价'].includes(s)) return 'price';
    if (['lb', 'lowerbound', '下限'].includes(s)) return 'LB';
    if (['ub', 'upperbound', '上限'].includes(s)) return 'UB';
    if (['dm', 'drymatter', '干物质'].includes(s)) return 'DM';
    if (['cp', 'crudeprotein', '粗蛋白'].includes(s)) return 'CP';
    if (['ee', 'etherextract', '粗脂肪', '脂肪'].includes(s)) return 'EE';
    if (['st', 'starch', '淀粉'].includes(s)) return 'ST';
    if (['lys', 'lysine', '赖氨酸'].includes(s)) return 'LYS';
    if (['p', 'phosphorus', '磷', '总磷'].includes(s)) return 'P';
    if (['adcn', 'adc-n', 'adc_n'].includes(s)) return 'ADC-N';
    if (['adcl', 'adc-l', 'adc_l'].includes(s)) return 'ADC-L';
    if (s.startsWith('gwp')) return 'GWP';                                  // "GWP/kg CO2 eq"
    if (['epkgpeq', 'ep_p', 'epp', 'ep(p)', 'ep-p'].includes(s)) return 'EP_P'; // "EP kg P eq"
    if (['epkgneq', 'ep_n', 'epn', 'ep(n)', 'ep-n'].includes(s)) return 'EP_N'; // "EP kg N eq"
    return null;
  }
  function loadIngredients(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error(t_('csv_norows'));
    const head = rows[0].map(mapCol), idx = {};
    head.forEach((h, j) => { if (h && idx[h] === undefined) idx[h] = j; });
    const need = ['name', 'price', 'LB', 'UB', 'DM', 'CP', 'EE', 'ST', 'LYS', 'P', 'ADC-N', 'ADC-L'];
    const miss = need.filter(n => idx[n] === undefined);
    if (miss.length) throw new Error(t_('csv_miss', { c: miss.join(', ') }));
    const num = v => { const x = parseFloat(String(v ?? '').replace(/,/g, '').trim()); return isFinite(x) ? x : NaN; };
    const lca = ['GWP', 'EP_P', 'EP_N'].filter(k => idx[k] !== undefined);
    const data = rows.slice(1).map(r => {
      const o = { name: String(r[idx.name] ?? '').trim() };
      need.slice(1).concat(lca).forEach(k => { o[k] = num(r[idx[k]]); });
      return o;
    }).filter(o => o.name !== '');
    if (!data.length) throw new Error(t_('csv_noval'));
    ['DM', 'CP', 'EE', 'ST', 'LYS', 'P', 'ADC-N', 'ADC-L'].forEach(k => {
      const mx = Math.max(...data.map(o => o[k]).filter(isFinite));
      if (mx > 1.01) data.forEach(o => { o[k] = o[k] / 100; });
    });
    const ps = data.map(o => o.price).filter(isFinite).sort((a, b) => a - b);
    const med = ps.length ? (ps.length % 2 ? ps[(ps.length - 1) / 2] : (ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2) : 0;
    if (med > 200) data.forEach(o => { o.price = o.price / 1000; });
    let nanCount = 0;
    const out = data.map(o => {
      const z = v => { if (!isFinite(v)) { nanCount++; return 0; } return v; };
      return { name: o.name, price: z(o.price), lb: isFinite(o.LB) ? o.LB : 0, ub: isFinite(o.UB) ? o.UB : 0,
        DM: z(o.DM), CP: z(o.CP), EE: z(o.EE), ST: z(o.ST), LYS: z(o.LYS), P: z(o.P), ADCN: z(o['ADC-N']), ADCL: z(o['ADC-L']),
        GWP: isFinite(o.GWP) ? o.GWP : 0, EP_P: isFinite(o.EP_P) ? o.EP_P : 0, EP_N: isFinite(o.EP_N) ? o.EP_N : 0 };
    });
    return { ings: out, nanCount, lca: lca.includes('GWP') || lca.includes('EP_P') };
  }
  // sample names are bilingual "中文 English"; show the half matching the interface language
  const ingLabel = n => n;

  // ---------------- state ----------------
  const S = {
    ings: [], src: { kind: 'sample', name: '' }, override: {}, mkt: 0, nan: 0,
    runs: [], active: -1, tab: 'overview', donut: 0, cmpMetric: 'profit', busy: false, lastErr: null, hint: { k: 'run_hint' },
  };
  const inputs = () => ({
    w0: Math.max(0.5, parseFloat($('#w0').value) || 5), days: parseFloat($('#days').value), toff: parseFloat($('#toff').value),
    mode: ($('input[name=mode]:checked') || {}).value || 'env',
  });
  const priceT = (ing) => (S.override[ing.name] ?? ing.price * 1000) * (1 + S.mkt / 100);
  const sig = () => JSON.stringify([inputs(), S.ings.map(priceT).map(v => +v.toFixed(3)), S.src.name, S.ings.length]);

  // ---------------- theme-aware plotting ----------------
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function th() {
    return { ink: css('--ink'), ink2: css('--ink-2'), muted: css('--muted'), line: css('--line'), grid: css('--grid'), surface: css('--surface'),
      accent: css('--accent'), amber: css('--amber'), coral: css('--coral'), green: css('--green'), navy: css('--navy'),
      s: [css('--s1'), css('--s2'), css('--s3')], font: css('--f-body') };
  }
  function layout(t, o = {}) {
    const base = {
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', margin: { l: 16, r: 16, t: 16, b: 16, autoexpand: true },
      font: { family: t.font, size: 12, color: t.ink2 }, hovermode: 'x unified', separators: '.,',
      hoverlabel: { bgcolor: t.surface, bordercolor: t.line, font: { color: t.ink, family: t.font } },
      legend: { orientation: 'h', x: 0, xanchor: 'left', y: 1.02, yanchor: 'bottom', bgcolor: 'rgba(0,0,0,0)', font: { size: 11.5 } },
      xaxis: { gridcolor: 'rgba(0,0,0,0)', linecolor: t.line, tickcolor: t.line, zeroline: false, ticks: 'outside', title: { font: { size: 11.5, color: t.muted } } },
      yaxis: { gridcolor: t.grid, zeroline: false, linecolor: 'rgba(0,0,0,0)', title: { font: { size: 11.5, color: t.muted } } },
    };
    const L = deepMerge(base, o);
    // every axis reserves room for its tick labels and title, so titles never sit on top of tick labels
    Object.keys(L).filter(k => /^[xy]axis\d*$/.test(k)).forEach(k => {
      L[k] = Object.assign({ automargin: true }, L[k]);
      L[k].title = Object.assign({ standoff: 8 }, L[k].title || {});
    });
    return L;
  }
  // padded range for an axis whose values may collapse to a single point
  function padRange(vals, frac) {
    const v = vals.filter(isFinite); if (!v.length) return undefined;
    let lo = Math.min(...v), hi = Math.max(...v); const span = hi - lo, ref = Math.max(Math.abs(hi), Math.abs(lo), 1);
    if (span < 0.02 * ref) { lo -= 0.05 * ref; hi += 0.05 * ref; } else { lo -= span * (frac || 0.08); hi += span * (frac || 0.08); }
    return [lo, hi];
  }
  function deepMerge(a, b) {
    const o = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    for (const k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') ? deepMerge(a[k], b[k]) : b[k];
    return o;
  }
  // left margin that fits the longest category label (CJK characters count double)
  const labelMargin = (labels, min) => Math.max(min || 60, Math.min(230, 18 + 6.4 * Math.max(0, ...labels.map(l => [...String(l)].reduce((a, c) => a + (/[一-鿿]/.test(c) ? 2 : 1), 0)))));
  const PCFG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['toImage', 'lasso2d', 'select2d', 'autoScale2d'] };
  function plot(id, data, lay) { const el = document.getElementById(id); if (el && window.Plotly) Plotly.react(el, data, lay, PCFG); }
  function bands(R, t, labels = true) {
    const shapes = [], ann = [], ss = SS();
    R.spans.forEach((sp, k) => {
      if (!sp) return;
      shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: sp[0], x1: sp[1], y0: 0, y1: 1, fillcolor: t.s[k], opacity: 0.11, line: { width: 0 }, layer: 'below' });
      if (labels) ann.push({ x: (sp[0] + sp[1]) / 2, y: 1, xref: 'x', yref: 'paper', yanchor: 'top', showarrow: false, text: ss[k], font: { size: 10.5, color: t.muted } });
    });
    return { shapes, annotations: ann };
  }
  function hexA(c, a) {
    c = c.trim();
    if (c.startsWith('#')) { let h = c.slice(1); if (h.length === 3) h = h.split('').map(x => x + x).join(''); const n = parseInt(h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
    return c;
  }

  // ---------------- results post-processing (reads solved model only) ----------------
  function stageOfW(w) { return w < E.C.W1 ? 0 : (w < E.C.W2 ? 1 : 2); }
  function spansOf(t, W) {
    const tEnd = t[t.length - 1];
    const f = th => { const i = W.findIndex(w => w >= th); return i < 0 ? null : t[i]; };
    const t10 = f(E.C.W1), t100 = f(E.C.W2);
    const s1 = W[0] < E.C.W1 ? [0, t10 ?? tEnd] : null;
    let s2 = null; if (W[0] < E.C.W2) { const a = W[0] >= E.C.W1 ? 0 : t10; if (a != null) s2 = [a, t100 ?? tEnd]; }
    const s3 = (t100 != null || W[0] >= E.C.W2) ? [W[0] >= E.C.W2 ? 0 : t100, tEnd] : null;
    return [s1, s2, s3].map(s => (s && s[1] > s[0]) ? s : null);
  }
  function nutrients(ING, x) {
    const sum = f => ING.reduce((a, i, j) => a + f(i) * x[j], 0);
    const dm = Math.max(sum(i => i.DM), 1e-9), cp = sum(i => i.CP), lys = sum(i => i.LYS);
    return { DM: (dm + E.C.PREMIX_KG) / E.C.TOTAL_KG, CP: cp / dm, EE: sum(i => i.EE) / dm, ME: sum(E.meAf) / E.C.TOTAL_KG,
      DE: sum(E.assimDense) / E.C.TOTAL_KG, LYS: lys / dm, LYS_CP: lys / Math.max(cp, 1e-9), P: sum(i => i.P) / dm, ST: sum(i => i.ST) / E.C.TOTAL_KG };
  }
  function limits(k) {
    const s = E.STAGES[k], C = E.C;
    return { DM: [C.DM_MIN, null], CP: [s.CP_eq - C.CP_TOL, s.CP_eq + C.CP_TOL], EE: [s.EE_min - 0.005, s.ee_max], ME: [s.ME_min, null], DE: [null, null],
      LYS: [s.lys_min, null], LYS_CP: [s.lys_cp, null], P: [s.p_min, s.p_max], ST: [null, C.STARCH_CAP_AF] };
  }
  function buildResult(o, ING, inp, pricesT) {
    const tr = o.sim.tr, keep = [];
    const step = Math.max(1, Math.round(tr.t.length / 900));
    for (let i = 0; i < tr.t.length; i += step) keep.push(i);
    if (keep[keep.length - 1] !== tr.t.length - 1) keep.push(tr.t.length - 1);
    const pick = a => keep.map(i => a[i]);
    const t = pick(tr.t), W = pick(tr.W);
    const s = o.sim, gain = s.WT - inp.w0, biomass = E.C.Nfish * s.WT / 1000;
    const harvest = E.dateAt(inp.days);
    const byStage = [0, 0, 0];
    for (let i = 1; i < tr.t.length; i++) byStage[stageOfW(tr.W[i - 1])] += tr.cost[i] - tr.cost[i - 1];
    // environmental footprint: per stage = per-kg value × stage feed (kg); per ingredient = Σ_k x_kj/1000 × factor × feed_k
    const FkKg = s.FkKg, gwpStage = o.sol.map((x, k) => x.gwp * FkKg[k]), epStage = o.sol.map((x, k) => x.ep * FkKg[k]);
    const ingGwp = ING.map((i, j) => o.sol.reduce((a, x, k) => a + x.x[j] / E.C.TOTAL_KG * (i.GWP || 0) * FkKg[k], 0));
    const ingEp = ING.map((i, j) => o.sol.reduce((a, x, k) => a + x.x[j] / E.C.TOTAL_KG * (i.EP_P || 0) * FkKg[k], 0));
    const gainKg = E.C.Nfish * gain / 1000;
    return {
      id: 'S' + (S.runs.length + 1), time: new Date().toTimeString().slice(0, 8), ms: o.ms, inputs: inp, mkt: S.mkt,
      ingNames: ING.map(i => i.name), pricesT,
      t, W, cost: pick(tr.cost), feed: pick(tr.F), intake: pick(tr.intake), T: pick(tr.T), tau: pick(tr.tau), fp: pick(tr.fp),
      blend: [pick(tr.w[0]), pick(tr.w[1]), pick(tr.w[2])], dW: pick(tr.dW),
      recipe: o.sol.map(x => x.x), stagePriceT: o.sol.map(x => x.price * 1000), assim: o.sol.map(x => x.assim),
      nutri: o.sol.map(x => nutrients(ING, x.x)), spans: spansOf(t, W), byStage,
      lca: E.hasLCA(ING), gwpT: pick(tr.gwp), epT: pick(tr.ep), FkKg, gwpStage, epStage, ingGwp, ingEp,
      stageGwpT: o.sol.map(x => x.gwp * 1000), stageEpT: o.sol.map(x => x.ep * 1000),
      anchors: o.anchors || null, weights: o.weights || null, cloud: o.cloud || null, kneeDist: o.kneeDist,
      anchorPts: o.anchorPts ? o.anchorPts.map(p => ({ profit: p.sim.profit, gwp: p.sim.gwp, ep: p.sim.ep })) : null,
      kpi: {
        WT: s.WT, cost: s.cost, feed: s.feed, revenue: s.revenue, profit: s.profit, biomass, gain,
        harvest: iso(harvest), harvestMonth: harvest.getUTCMonth() + 1, harvestPrice: E.fishPrice(inp.days),
        fcr: gain > 1e-9 ? s.feed / gain : NaN, cpkg: gain > 1e-9 ? s.cost / (E.C.Nfish * gain / 1000) : NaN,
        avgFeed: s.feed > 1e-9 ? s.cost / (E.C.Nfish * s.feed / 1e6) : NaN, breakeven: biomass > 1e-9 ? s.cost / biomass : NaN,
        margin: s.revenue > 1e-9 ? s.profit / s.revenue : NaN,
        gwp: s.gwp, ep: s.ep, gwpKg: gainKg > 1e-9 ? s.gwp / gainKg : NaN, epKg: gainKg > 1e-9 ? s.ep * 1000 / gainKg : NaN,
        gwpFeed: s.feed > 1e-9 ? s.gwp / (E.C.Nfish * s.feed / 1000) : NaN,
      },
    };
  }

  // ---------------- run ----------------
  function setHint(k, v) { S.hint = { k, v }; $('#run-hint').textContent = t_(k, v); }
  function errText(e) {
    if (!e) return '';
    if (e.k === 'err_lp') return t_('err_lp', { k: e.stage + 1, name: SN()[e.stage] });
    if (e.k === 'err_other') return t_('err_other', { m: e.m || t_('unknown') });
    if (e.k === 'err_csv') return t_('err_csv', e);
    return t_(e.k);
  }
  async function run() {
    if (S.busy) return;
    if (!window.solver) { S.lastErr = { k: 'err_nolib' }; renderAlerts(); return; }
    S.busy = true; S.lastErr = null;
    const btn = $('#run'); btn.disabled = true; $('#run-label').textContent = t_('running'); $('#kpis').classList.add('busy');
    const inp = inputs();
    const pricesT = S.ings.map(priceT), pricesKg = pricesT.map(v => v / 1000);
    let o;
    try {
      o = await E.optimise(window.solver, S.ings, pricesKg, inp, (p, m) => { $('#prog').style.width = (p * 100).toFixed(0) + '%'; setHint('prog_' + m); });
    } catch (e) { o = { ok: false, reason: 'error', err: e }; }
    $('#prog').style.width = '100%';
    if (o.ok) {
      const R = buildResult(o, S.ings, inp, pricesT);
      R.sig = sig();
      S.runs.push(R); S.active = S.runs.length - 1;
      setHint('run_done', { id: R.id, s: (o.ms / 1000).toFixed(1) });
    } else {
      S.lastErr = o.reason === 'lp' ? { k: 'err_lp', stage: o.stage ?? 0 } : o.reason === 'path' ? { k: 'err_path' } : o.reason === 'nolca' ? { k: 'err_nolca' } : { k: 'err_other', m: o.err && o.err.message };
      setHint('run_fail');
    }
    setTimeout(() => { $('#prog').style.width = '0'; }, 600);
    btn.disabled = false; $('#run-label').textContent = t_('run'); $('#kpis').classList.remove('busy');
    S.busy = false;
    renderAll();
  }

  // ---------------- rendering ----------------
  const ICON = {
    fish: '<path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M2 9.5c1.5 1 2.5 1.5 4.5 2.5-2 1-3 1.5-4.5 2.5z"/>',
    trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/>',
    cycle: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    warn: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  };
  const ic = (n, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
  const cur = () => S.active >= 0 ? S.runs[S.active] : null;
  const prev = () => S.active > 0 ? S.runs[S.active - 1] : null;

  function kpiCard(label, value, unit, icon, tone, note, d, goodUp, ref) {
    let foot = `<span>${esc(note)}</span>`;
    if (d != null && isFinite(d) && Math.abs(d) > 1e-6) {
      const good = (d > 0) === goodUp;
      foot = `<span class="d ${good ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${(Math.abs(d) * 100).toFixed(1)}%</span><span>${esc(t_('vs', { id: ref }))}</span>`;
    }
    return `<div class="kpi t-${tone}"><div class="kpi-h"><span>${esc(label)}</span><span class="kpi-ic">${ic(icon, 16)}</span></div>
      <div class="kpi-v">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</div><div class="kpi-f">${foot}</div></div>`;
  }
  const rel = (a, b) => (b == null || !isFinite(b) || Math.abs(b) < 1e-12) ? null : (a - b) / Math.abs(b);
  const sgn = v => (v >= 0 ? '+' : '') ;

  function renderStatus() {
    const R = cur(), inp = inputs(), ne = Object.keys(S.override).length;
    let h = `<span class="chip">${t_('chip_mode')} <b>${MN(inp.mode)}</b></span><span class="chip">${t_('chip_w0')} <b>${fmt(inp.w0, 1)} g</b></span>
      <span class="chip">${t_('chip_days')} <b>${t_('days_o', { n: inp.days })}</b></span><span class="chip">${t_('chip_toff')} <b>${sgn(inp.toff)}${fmt(inp.toff, 1)} °C</b></span>
      <span class="chip">${t_('chip_price')} <b>${sgn(S.mkt)}${S.mkt}%</b>${ne ? t_('chip_edited', { n: ne }) : ''}</span>`;
    if (S.runs.length > 1) {
      h += `<span class="sp"></span><label for="runsel" class="hint">${t_('view_run')}</label><select class="runsel" id="runsel">${S.runs.map((r, i) =>
        `<option value="${i}"${i === S.active ? ' selected' : ''}>${t_('run_opt', { id: r.id, mode: MN(r.inputs.mode), w0: r.inputs.w0, days: r.inputs.days, time: r.time })}</option>`).join('')}</select>`;
    }
    $('#status').innerHTML = h;
    const sel = $('#runsel'); if (sel) sel.onchange = () => { S.active = +sel.value; renderAll(); };
    $('#run-badge').hidden = !(R && R.sig !== sig());
  }
  function renderAlerts() {
    const R = cur(); let h = '';
    if (S.lastErr) h += `<div class="alert err">${ic('warn')}<div><b>${t_('al_nofeas')}</b><br>${esc(errText(S.lastErr))}${R ? '<br>' + t_('al_prev') : ''}</div></div>`;
    if (R && R.sig !== sig() && !S.busy) h += `<div class="alert warn">${ic('warn')}<div>${esc(t_('al_dirty', { id: R.id }))}</div></div>`;
    $('#alerts').innerHTML = h;
  }
  function renderKPIs() {
    const R = cur();
    if (!R) { $('#kpis').innerHTML = ''; $('#strip').innerHTML = ''; return; }
    const K = R.kpi, P = prev() && prev().kpi, ref = prev() ? prev().id : '';
    $('#kpis').innerHTML = [
      kpiCard(t_('k_wt'), fmt(K.WT, 1), t_('u_gfish'), 'fish', 'teal', t_('k_wt_n', { g: fmt(K.gain, 1) }), P && rel(K.WT, P.WT), true, ref),
      kpiCard(t_('k_profit'), yuan(K.profit), '', 'trend', 'green', t_('k_profit_n', { m: fmt(K.margin * 100, 1) }), P && rel(K.profit, P.profit), true, ref),
      kpiCard(t_('k_cost'), yuan(K.cost), '', 'coins', 'amber', t_('k_cost_n', { f: fmt(K.feed, 0) }), P && rel(K.cost, P.cost), false, ref),
      R.lca ? kpiCard(t_('k_gwp'), fmt0(K.gwp), t_('u_co2'), 'leaf', 'navy', t_('k_gwp_n', { v: fmt(K.gwpKg, 2) }), P && P.gwp != null && R.lca && prev().lca ? rel(K.gwp, P.gwp) : null, false, ref)
        : kpiCard(t_('k_gwp'), '—', '', 'leaf', 'navy', t_('k_nolca'), null, false, ref),
    ].join('');
    $('#strip').innerHTML = `
      <div><span>${t_('s_rev')}</span><b>${yuan(K.revenue)}</b><small>${K.harvest} · ${gbp(K.harvestPrice, 2)}/kg</small></div>
      <div><span>${t_('s_cpkg')}</span><b>${gbp(K.cpkg, 2)}</b><small>${t_('s_cpkg_n')}</small></div>
      <div><span>${t_('k_fcr')}</span><b>${fmt(K.fcr, 2)}</b><small>${t_('k_fcr_n')}</small></div>
      <div><span>${t_('s_be')}</span><b>${gbp(K.breakeven, 2)}</b><small>${t_('s_be_n')}</small></div>
      <div><span>${t_('s_gwpkg')}</span><b>${R.lca ? fmt(K.gwpKg, 2) : '—'}</b><small>${t_('s_gwpkg_n')}</small></div>
      <div><span>${t_('s_ep')}</span><b>${R.lca ? fmt(K.ep, 3) : '—'}</b><small>${R.lca ? t_('s_ep_n', { v: fmt(K.epKg, 2) }) : t_('k_nolca')}</small></div>`;
  }
  const spanTxt = sp => t_('stage_span', { a: fmt(sp[0], 0), b: fmt(sp[1], 0), n: fmt(sp[1] - sp[0], 0) });

  function renderOverview(t) {
    const R = cur(); if (!R) return;
    const b = bands(R, t);
    plot('p-main', [
      { x: R.t, y: R.W, name: t_('ax_w'), type: 'scatter', mode: 'lines', line: { color: t.navy, width: 3 }, hovertemplate: `%{y:.1f} g<extra>${t_('tr_w')}</extra>` },
      { x: R.t, y: R.cost.map(G), name: t_('ax_cost'), yaxis: 'y2', type: 'scatter', mode: 'lines', line: { color: t.amber, width: 2.5 }, fill: 'tozeroy', fillcolor: hexA(t.amber, 0.08), hovertemplate: `£%{y:,.0f}<extra>${t_('tr_cost')}</extra>` },
    ], layout(t, { margin: { r: 60 }, shapes: b.shapes, annotations: b.annotations, xaxis: { title: { text: t_('ax_day') } }, yaxis: { title: { text: t_('ax_w') } },
      yaxis2: { overlaying: 'y', side: 'right', showgrid: false, zeroline: false, title: { text: t_('ax_cost'), font: { size: 11.5, color: t.muted } } } }));
    const K = R.kpi, I0 = R.inputs;
    $('#summary').innerHTML = t_('summary', { mode: MN(I0.mode), w0: fmt(I0.w0, 1), days: I0.days, harvest: K.harvest, wt: fmt(K.WT, 1), n: fmt0(E.C.Nfish),
      cost: yuan(K.cost), rev: yuan(K.revenue), profit: yuan(K.profit), fcr: fmt(K.fcr, 2), cpkg: fmt(G(K.cpkg), 2) })
      + (R.lca ? ' ' + t_('summary_env', { gwp: fmt0(K.gwp), gkg: fmt(K.gwpKg, 2), ep: fmt(K.ep, 3) }) : '')
      + (R.weights ? ' ' + t_('summary_w', { a: fmt(R.weights[0], 2), b: fmt(R.weights[1], 2), c: fmt(R.weights[2], 2) }) : '');
    $('#stages').innerHTML = [0, 1, 2].map(k => {
      const sp = R.spans[k];
      return `<div class="stage ${sp ? '' : 'off'}"><i style="background:${t.s[k]}"></i><div><b>${SN()[k]}</b><small>${sp ? spanTxt(sp) : t_('stage_none')}</small><small>${t_('stage_cp', { p: Math.round(E.STAGES[k].CP_eq * 100) })}</small></div>
        <div class="pr">£${fmt0(G(R.stagePriceT[k]))}<small>${t_('stage_price')}</small></div></div>`;
    }).join('');
  }

  function renderGrowth(t) {
    const R = cur(); if (!R) return;
    const P = prev(), b = bands(R, t);
    const sh = b.shapes.slice();
    [E.C.W1, E.C.W2].forEach(thr => { if (Math.min(...R.W) < thr && Math.max(...R.W) > thr) sh.push({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: thr, y1: thr, line: { color: t.muted, width: 1, dash: 'dot' } }); });
    const tr = [{ x: R.t, y: R.W, name: R.id, type: 'scatter', mode: 'lines', line: { color: t.navy, width: 3 }, fill: 'tozeroy', fillcolor: hexA(t.navy, 0.06), hovertemplate: '%{y:.2f} g' }];
    if (P) tr.push({ x: P.t, y: P.W, name: P.id + t_('prev_run'), type: 'scatter', mode: 'lines', line: { color: t.muted, width: 2, dash: 'dash' }, hovertemplate: '%{y:.2f} g' });
    plot('p-w', tr, layout(t, { shapes: sh, annotations: b.annotations, xaxis: { title: { text: t_('ax_day') } }, yaxis: { title: { text: t_('ax_w') } } }));
    const sgr = R.W.map((w, i) => 100 * R.dW[i] / Math.max(w, 1e-9));
    const fr = R.W.map((w, i) => 100 * R.intake[i] / Math.max(w, 1e-9));
    plot('p-sgr', [
      { x: R.t, y: sgr, name: t_('ax_sgr'), type: 'scatter', mode: 'lines', line: { color: t.accent, width: 2.5 }, hovertemplate: '%{y:.2f}' },
      { x: R.t, y: fr, name: t_('ax_fr'), yaxis: 'y2', type: 'scatter', mode: 'lines', line: { color: t.amber, width: 2, dash: 'dot' }, hovertemplate: '%{y:.2f}' },
    ], layout(t, { margin: { r: 54 }, xaxis: { title: { text: t_('ax_day') } }, yaxis: { title: { text: t_('ax_sgr') } },
      yaxis2: { overlaying: 'y', side: 'right', showgrid: false, zeroline: false, title: { text: t_('ax_fr'), font: { size: 11.5, color: t.muted } } } }));
    const b2 = bands(R, t, false);
    plot('p-int', [{ x: R.t, y: R.intake, name: t_('c_int'), type: 'scatter', mode: 'lines', line: { color: t.green, width: 2.5 }, fill: 'tozeroy', fillcolor: hexA(t.green, 0.08), hovertemplate: '%{y:.2f} g/fish/d<extra></extra>' }],
      layout(t, { showlegend: false, margin: { t: 14 }, shapes: b2.shapes, xaxis: { title: { text: t_('ax_day') } }, yaxis: { title: { text: t_('ax_int') } } }));
    plot('p-temp', [{ x: R.t, y: R.T, name: t_('ax_temp'), type: 'scatter', mode: 'lines', line: { color: t.coral, width: 2.5, shape: 'hv' }, hovertemplate: '%{y:.1f} °C<extra></extra>' }],
      layout(t, { showlegend: false, margin: { t: 14 }, xaxis: { title: { text: t_('ax_day') } }, yaxis: { title: { text: t_('ax_temp') } } }));
  }

  function usedIdx(R) {
    const idx = R.ingNames.map((_, j) => j).filter(j => Math.max(R.recipe[0][j], R.recipe[1][j], R.recipe[2][j]) > 0.1);
    idx.sort((a, b) => (R.recipe[0][b] + R.recipe[1][b] + R.recipe[2][b]) - (R.recipe[0][a] + R.recipe[1][a] + R.recipe[2][a]));
    return idx;
  }
  function renderFormula(t) {
    const R = cur(); if (!R) return;
    const used = usedIdx(R), col = {}; used.forEach((j, n) => { col[j] = PAL[n % PAL.length]; });
    const premixC = t.line, sn = SN(), ss = SS(), nm = j => ingLabel(R.ingNames[j]);
    $('#scards').innerHTML = [0, 1, 2].map(k => {
      const sp = R.spans[k], n = R.recipe[k].filter(v => v > 0.1).length;
      const span = sp ? t_('sc_span', { a: fmt(sp[0], 0), b: fmt(sp[1], 0) }) : t_('sc_none');
      return `<div class="scard ${sp ? '' : 'off'}" style="--c:${t.s[k]}"><span>${sn[k]}</span><b>£${fmt0(G(R.stagePriceT[k]))}<small>/t</small></b>
        <em>${t_('sc_meta', { span, n, de: fmt(R.assim[k], 2) })}${R.lca ? ' · ' + t_('sc_gwp', { g: fmt0(R.stageGwpT[k]) }) : ''}</em></div>`;
    }).join('');
    const traces = used.map(j => ({ type: 'bar', orientation: 'h', y: ss, x: [0, 1, 2].map(k => R.recipe[k][j]), name: nm(j), marker: { color: col[j] }, hovertemplate: `${esc(nm(j))}: %{x:.1f} kg/t<extra></extra>` }));
    traces.push({ type: 'bar', orientation: 'h', y: ss, x: [50, 50, 50], name: t_('premix'), marker: { color: premixC }, hovertemplate: `${t_('premix')}: 50 kg/t<extra></extra>` });
    const stEl = $('#p-stack'); stEl.style.height = '';
    let stLeg = $('#stack-leg'); if (!stLeg) { stLeg = document.createElement('div'); stLeg.id = 'stack-leg'; stLeg.className = 'hleg'; stEl.parentNode.insertBefore(stLeg, stEl); }
    stLeg.innerHTML = traces.map(tr => `<span><i style="background:${tr.marker.color}"></i>${esc(tr.name)}</span>`).join('');
    plot('p-stack', traces, layout(t, { barmode: 'stack', bargap: 0.38, hovermode: 'closest', showlegend: false, margin: { l: labelMargin(ss, 70) },
      xaxis: { range: [0, 1000], gridcolor: t.grid }, yaxis: { autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)' } }));
    $('#donut-pick').innerHTML = ss.map((n, k) => `<button type="button" data-k="${k}" aria-pressed="${k === S.donut}">${n}</button>`).join('');
    $$('#donut-pick button').forEach(bn => bn.onclick = () => { S.donut = +bn.dataset.k; renderFormula(th()); });
    const k = S.donut, js = used.filter(j => R.recipe[k][j] > 0.1);
    plot('p-donut', [{ type: 'pie', hole: 0.62, sort: true, labels: js.map(nm).concat([t_('premix')]), values: js.map(j => R.recipe[k][j]).concat([50]),
      marker: { colors: js.map(j => col[j]).concat([premixC]), line: { color: t.surface, width: 2 } }, textinfo: 'percent', textposition: 'inside', insidetextorientation: 'horizontal',
      hovertemplate: '%{label}: %{value:.1f} kg/t (%{percent})<extra></extra>' }],
      layout(t, { showlegend: false, margin: { l: 10, r: 10, t: 10, b: 10 }, hovermode: 'closest',
        annotations: [{ text: `<b>£${fmt0(G(R.stagePriceT[k]))}</b><br><span style="font-size:11px">/t · ${ss[k]}</span>`, showarrow: false, font: { size: 20, color: t.ink } }] }));
    const spec = [['DM', 'p', 1], ['CP', 'p', 1], ['EE', 'p', 1], ['ME', 'mj', 2], ['DE', 'mj', 2], ['LYS', 'p', 2], ['LYS_CP', 'p', 2], ['P', 'p', 2], ['ST', 'p', 1]];
    const f = (v, kd, d) => kd === 'p' ? fmt(v * 100, d) + '%' : fmt(v, d) + ' MJ/kg';
    const rq = (lo, hi, kd, d) => lo != null && hi != null ? `${f(lo, kd, d)}–${f(hi, kd, d)}` : lo != null ? `≥ ${f(lo, kd, d)}` : hi != null ? `≤ ${f(hi, kd, d)}` : '—';
    let h = `<table><thead><tr><th>${t_('n_item')}</th><th>${t_('n_req', { s: ss.join(' / ') })}</th>${[0, 1, 2].map(k => `<th class="r ${R.spans[k] ? '' : 'off'}">${sn[k]}</th>`).join('')}</tr></thead><tbody>`;
    spec.forEach(([key, kd, d]) => {
      const L = [0, 1, 2].map(k => limits(k)[key]);
      const same = L.every(l => l[0] === L[0][0] && l[1] === L[0][1]);
      const req = same ? rq(L[0][0], L[0][1], kd, d) : L.map(l => rq(l[0], l[1], kd, d)).join(' / ');
      h += `<tr><td><b>${t_('n_' + key)}</b></td><td class="hint">${req}</td>` + [0, 1, 2].map(k => {
        const v = R.nutri[k][key], [lo, hi] = L[k];
        if (lo == null && hi == null) return `<td class="r"><span class="na">${f(v, kd, d)}</span></td>`;
        const ok = (lo == null || v >= lo - 1e-4) && (hi == null || v <= hi + 1e-4);
        return `<td class="r"><span class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '✕'} ${f(v, kd, d)}</span></td>`;
      }).join('') + '</tr>';
    });
    $('#nutri').innerHTML = h + '</tbody></table>';
    const mx = Math.max(...used.map(j => Math.max(R.recipe[0][j], R.recipe[1][j], R.recipe[2][j])), 50);
    const cell = (v, k) => `<td><div class="bar-cell"><div class="trk"><i style="width:${(v / mx * 100).toFixed(1)}%;background:${t.s[k]}"></i></div><span>${fmt(v, 1)}</span></div></td>`;
    let r = `<table><thead><tr><th>${t_('r_ing')}</th><th class="r">${t_('r_price')}</th>${sn.map(n => `<th>${n} (kg/t)</th>`).join('')}</tr></thead><tbody>`;
    used.forEach(j => { r += `<tr><td><b><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${col[j]};margin-right:8px"></span>${esc(nm(j))}</b></td><td class="r">${fmt0(G(R.pricesT[j]))}</td>${[0, 1, 2].map(k => cell(R.recipe[k][j], k)).join('')}</tr>`; });
    r += `<tr><td><b>${t_('premix')}</b></td><td class="r">—</td>${[0, 1, 2].map(k => cell(50, k)).join('')}</tr>`;
    r += `<tr><td><b>${t_('r_total')}</b></td><td></td>${[0, 1, 2].map(k => `<td><b>1,000 kg · £${fmt0(G(R.stagePriceT[k]))}/t</b></td>`).join('')}</tr></tbody></table>`;
    $('#recipe').innerHTML = r;
  }

  function renderEcon(t) {
    const R = cur(); if (!R) return;
    const K = R.kpi, sn = SN();
    plot('p-wf', [{ type: 'waterfall', x: [t_('wf_rev'), t_('wf_cost'), t_('wf_gross')], measure: ['relative', 'relative', 'total'], y: [G(K.revenue), -G(K.cost), 0],
      text: [yuan(K.revenue), '−' + yuan(K.cost), yuan(K.profit)], textposition: 'outside', textfont: { color: t.ink },
      increasing: { marker: { color: t.accent } }, decreasing: { marker: { color: t.amber } }, totals: { marker: { color: K.profit >= 0 ? t.green : t.coral } },
      connector: { line: { color: t.line } }, hoverinfo: 'skip' }],
      layout(t, { showlegend: false, hovermode: false, margin: { t: 20 }, yaxis: { range: [Math.min(0, G(K.profit)) * 1.2, G(K.revenue) * 1.18], tickprefix: '£' } }));
    plot('p-sc', [{ type: 'bar', x: SS(), y: R.byStage.map(G), customdata: sn, marker: { color: t.s }, text: R.byStage.map(v => yuan(v)), textposition: 'outside', textfont: { color: t.ink }, hovertemplate: '%{customdata}: £%{y:,.0f}<extra></extra>' }],
      layout(t, { showlegend: false, hovermode: 'closest', margin: { t: 20 }, yaxis: { range: [0, G(Math.max(...R.byStage)) * 1.22 + 1], tickprefix: '£' } }));
    renderWhatIf(t);
    const fpG = R.fp.map(G), lo = Math.min(...fpG), hi = Math.max(...fpG), pad = Math.max(6, (hi - lo) * 0.25), b = bands(R, t);
    plot('p-fp', [{ x: R.t, y: fpG, type: 'scatter', mode: 'lines', line: { color: t.navy, width: 2.5 }, hovertemplate: '£%{y:,.0f}/t<extra></extra>' }],
      layout(t, { showlegend: false, margin: { t: 16 }, shapes: b.shapes, annotations: b.annotations, xaxis: { title: { text: t_('ax_day') } }, yaxis: { range: [lo - pad, hi + pad], title: { text: '£/t' } } }));
  }
  function renderWhatIf(t) {
    const R = cur(); if (!R) return;
    const K = R.kpi, adj = +$('#fadj').value, p = K.harvestPrice * (1 + adj / 100), pr = K.biomass * p - K.cost;
    $('#fadj-o').textContent = (adj > 0 ? '+' : '') + adj + '%';
    $('#wi-price').textContent = gbp(p, 2) + ' /kg';
    $('#wi-profit').textContent = yuan(pr); $('#wi-profit').style.color = pr >= 0 ? t.green : t.coral;
    $('#wi-be').textContent = gbp(K.breakeven, 2) + ' /kg';
    const x0 = Math.max(0, Math.min(K.breakeven * 0.7, K.harvestPrice * 0.55)), x1 = K.harvestPrice * 1.45;
    const xs = Array.from({ length: 90 }, (_, i) => x0 + (x1 - x0) * i / 89), ys = xs.map(x => K.biomass * x - K.cost);
    const hv = '£%{x:.2f}/kg → £%{y:,.0f}<extra></extra>', gx = xs.map(G);
    plot('p-wi', [
      { x: gx, y: ys.map(v => v >= 0 ? G(v) : null), type: 'scatter', mode: 'lines', line: { color: t.green, width: 3 }, fill: 'tozeroy', fillcolor: hexA(t.green, 0.08), name: t_('wf_gross'), hovertemplate: hv },
      { x: gx, y: ys.map(v => v < 0 ? G(v) : null), type: 'scatter', mode: 'lines', line: { color: t.coral, width: 3 }, fill: 'tozeroy', fillcolor: hexA(t.coral, 0.08), showlegend: false, hovertemplate: hv },
      { x: [G(K.harvestPrice)], y: [G(K.profit)], type: 'scatter', mode: 'markers', name: t_('wi_cur'), marker: { size: 11, color: t.navy, line: { color: t.surface, width: 2 } }, hovertemplate: hv },
      ...(adj ? [{ x: [G(p)], y: [G(pr)], type: 'scatter', mode: 'markers', name: (adj > 0 ? '+' : '') + adj + '%', marker: { size: 11, color: t.accent, line: { color: t.surface, width: 2 } }, hovertemplate: hv }] : []),
    ], layout(t, { hovermode: 'closest', shapes: [{ type: 'line', x0: G(K.breakeven), x1: G(K.breakeven), yref: 'paper', y0: 0, y1: 1, line: { color: t.coral, dash: 'dash', width: 1 } }],
      annotations: [{ x: G(K.breakeven), y: 1, yref: 'paper', text: t_('wi_be_s'), showarrow: false, xanchor: 'left', yanchor: 'top', font: { size: 10.5, color: t.coral } }],
      xaxis: { title: { text: t_('ax_fp') } }, yaxis: { title: { text: t_('ax_gross') }, tickprefix: '£' } }));
  }

  function renderCompare(t) {
    if (!S.runs.length) { $('#runs').innerHTML = `<div class="empty">${t_('runs_empty')}</div>`; plot('p-cmp', [], layout(t)); plot('p-cmpb', [], layout(t)); return; }
    let h = `<table><thead><tr><th>${t_('h_run')}</th><th>${t_('h_time')}</th><th>${t_('h_mode')}</th><th class="r">${t_('h_w0')}</th><th class="r">${t_('h_days')}</th><th class="r">${t_('h_toff')}</th><th class="r">${t_('h_price')}</th><th class="r">${t_('h_wt')}</th><th class="r">${t_('h_cost')}</th><th class="r">${t_('h_profit')}</th><th class="r">FCR</th><th class="r">GWP (kg CO₂e)</th><th class="r">EP (kg P eq)</th><th class="r">${t_('h_ms')}</th></tr></thead><tbody>`;
    S.runs.forEach((r, i) => {
      const K = r.kpi, I0 = r.inputs;
      h += `<tr${i === S.active ? ' style="background:var(--accent-soft)"' : ''}><td><b>${r.id}</b></td><td>${r.time}</td><td>${MN(I0.mode)}</td><td class="r">${fmt(I0.w0, 1)}</td><td class="r">${I0.days}</td><td class="r">${sgn(I0.toff)}${fmt(I0.toff, 1)} °C</td><td class="r">${sgn(r.mkt)}${r.mkt}%</td>
        <td class="r"><b>${fmt(K.WT, 1)} g</b></td><td class="r">${yuan(K.cost)}</td><td class="r"><b>${yuan(K.profit)}</b></td><td class="r">${fmt(K.fcr, 2)}</td><td class="r">${r.lca ? fmt0(K.gwp) : '—'}</td><td class="r">${r.lca ? fmt(K.ep, 3) : '—'}</td><td class="r">${(r.ms / 1000).toFixed(1)} s</td></tr>`;
    });
    $('#runs').innerHTML = h + '</tbody></table>';
    const pal = [t.navy, t.accent, t.amber, t.coral, t.green, '#6D5BA8', '#B5577A', '#4A6FA5'];
    const rs = S.runs.slice(-8);
    plot('p-cmp', rs.map((r, i) => ({ x: r.t, y: r.W, name: `${r.id} · ${MN(r.inputs.mode)}`, type: 'scatter', mode: 'lines', line: { color: pal[i % pal.length], width: 2.5 }, hovertemplate: '%{y:.1f} g' })),
      layout(t, { xaxis: { title: { text: t_('ax_day') } }, yaxis: { title: { text: t_('ax_w') } } }));
    const metrics = { profit: [t_('m_profit'), v => yuan(v)], cost: [t_('m_cost'), v => yuan(v)], WT: [t_('m_wt'), v => fmt(v, 1) + ' g'], fcr: ['FCR', v => fmt(v, 2)], gwp: ['GWP', v => fmt0(v)], ep: ['EP', v => fmt(v, 3)] };
    $('#cmp-pick').innerHTML = Object.keys(metrics).map(k => `<button type="button" data-m="${k}" aria-pressed="${k === S.cmpMetric}">${metrics[k][0]}</button>`).join('');
    $$('#cmp-pick button').forEach(b => b.onclick = () => { S.cmpMetric = b.dataset.m; renderCompare(th()); });
    const m = S.cmpMetric, raw = rs.map(r => r.kpi[m]), money = m === 'profit' || m === 'cost', vals = money ? raw.map(G) : raw;
    plot('p-cmpb', [{ type: 'bar', x: rs.map(r => r.id), y: vals, marker: { color: rs.map((_, i) => pal[i % pal.length]) }, text: raw.map(metrics[m][1]), textposition: 'outside', textfont: { color: t.ink }, hovertemplate: '%{x}<extra></extra>' }],
      layout(t, { showlegend: false, hovermode: 'closest', margin: { t: 20 }, yaxis: { range: [Math.min(0, ...vals) * 1.2, Math.max(...vals) * 1.22 || 1] } }));
  }

  function renderEnv(t) {
    const R = cur(); if (!R) return;
    $('#env-note').innerHTML = R.lca ? t_('env_note') : `<div class="alert warn">${ic('warn')}<div>${t_('env_nolca')}</div></div>`;
    if (!R.lca) { ['p-env-stage', 'p-env-ing', 'p-env-cum', 'p-env-trade', 'p-env-runs'].forEach(id => plot(id, [], layout(t))); $('#env-trade-note').textContent = ''; return; }
    const sn = SN();
    plot('p-env-stage', [
      { type: 'bar', x: SS(), y: R.gwpStage, customdata: sn, name: 'GWP (kg CO₂e)', offsetgroup: 'g', marker: { color: t.navy }, hovertemplate: '%{customdata}: %{y:,.1f} kg CO₂e<extra></extra>' },
      { type: 'bar', x: SS(), y: R.epStage.map(v => v * 1000), customdata: sn, name: 'EP (g P eq)', yaxis: 'y2', offsetgroup: 'e', marker: { color: t.amber }, hovertemplate: '%{customdata}: %{y:,.1f} g P eq<extra></extra>' },
    ], layout(t, { barmode: 'group', hovermode: 'closest', margin: { r: 56 }, yaxis: { title: { text: 'kg CO₂e' } },
      yaxis2: { overlaying: 'y', side: 'right', showgrid: false, zeroline: false, rangemode: 'tozero', title: { text: 'g P eq', font: { size: 11.5, color: t.muted } } } }));
    const used = R.ingNames.map((_, j) => j).filter(j => R.ingGwp[j] > 1e-6 || R.ingEp[j] > 1e-9).sort((a, b) => R.ingGwp[b] - R.ingGwp[a]);
    const tg = R.ingGwp.reduce((a, b) => a + b, 0) || 1, te = R.ingEp.reduce((a, b) => a + b, 0) || 1;
    const hgt = Math.max(300, 28 * used.length + 80); $('#p-env-ing').style.height = hgt + 'px';
    plot('p-env-ing', [
      { type: 'bar', orientation: 'h', y: used.map(j => ingLabel(R.ingNames[j])), x: used.map(j => 100 * R.ingGwp[j] / tg), name: t_('env_share_gwp'), marker: { color: t.navy }, hovertemplate: '%{y}: %{x:.1f}%<extra>GWP</extra>' },
      { type: 'bar', orientation: 'h', y: used.map(j => ingLabel(R.ingNames[j])), x: used.map(j => 100 * R.ingEp[j] / te), name: t_('env_share_ep'), marker: { color: t.amber }, hovertemplate: '%{y}: %{x:.1f}%<extra>EP</extra>' },
    ], layout(t, { barmode: 'group', hovermode: 'closest', height: hgt, margin: { l: labelMargin(used.map(j => ingLabel(R.ingNames[j]))), t: 30 }, xaxis: { gridcolor: t.grid, ticksuffix: '%', title: { text: t_('env_share_ax') } }, yaxis: { autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)' } }));
    const b = bands(R, t);
    plot('p-env-cum', [
      { x: R.t, y: R.gwpT, name: 'GWP (kg CO₂e)', type: 'scatter', mode: 'lines', line: { color: t.navy, width: 2.5 }, fill: 'tozeroy', fillcolor: hexA(t.navy, 0.06), hovertemplate: '%{y:,.0f} kg CO₂e<extra></extra>' },
      { x: R.t, y: R.epT.map(v => v * 1000), name: 'EP (g P eq)', yaxis: 'y2', type: 'scatter', mode: 'lines', line: { color: t.amber, width: 2, dash: 'dot' }, hovertemplate: '%{y:,.1f} g P eq<extra></extra>' },
    ], layout(t, { margin: { r: 56 }, shapes: b.shapes, annotations: b.annotations, xaxis: { title: { text: t_('ax_day') } }, yaxis: { title: { text: 'kg CO₂e' } },
      yaxis2: { overlaying: 'y', side: 'right', showgrid: false, zeroline: false, title: { text: 'g P eq', font: { size: 11.5, color: t.muted } } } }));
    // trade-off: scanned weighted-sum solutions (balanced strategy) or the three anchors
    const tr = [];
    if (R.cloud) {
      const nd = R.cloud.filter(p => p.nd), dom = R.cloud.filter(p => !p.nd);
      const txt = p => `w = ${p.w.map(v => fmt(v, 2)).join(' / ')}<br>EP ${fmt(p.ep, 3)} kg P eq`;
      if (dom.length) tr.push({ x: dom.map(p => p.gwp), y: dom.map(p => G(p.profit)), text: dom.map(txt), type: 'scatter', mode: 'markers', name: t_('env_dom'), marker: { size: 8, color: hexA(t.muted, 0.45) }, hovertemplate: 'GWP %{x:,.0f} · £%{y:,.0f}<br>%{text}<extra></extra>' });
      tr.push({ x: nd.map(p => p.gwp), y: nd.map(p => G(p.profit)), text: nd.map(txt), type: 'scatter', mode: 'markers', name: t_('env_nd'), marker: { size: 11, color: nd.map(p => p.ep), colorscale: [[0, t.green], [1, t.amber]], line: { color: t.surface, width: 1 }, colorbar: { title: { text: 'EP', font: { size: 11, color: t.muted } }, thickness: 10, len: 0.7, tickfont: { color: t.muted, size: 10 } } }, hovertemplate: 'GWP %{x:,.0f} · £%{y:,.0f}<br>%{text}<extra></extra>' });
    }
    if (R.anchorPts) {
      const nm = [t_('anc_profit'), t_('anc_gwp'), t_('anc_ep')];
      const ax = R.anchorPts.map(p => p.gwp), xl = Math.min(...ax), xs = (Math.max(...ax) - xl) || 1;
      const pos = R.anchorPts.map((p, i) => (i === 2 ? 'bottom ' : 'top ') + ((p.gwp - xl) / xs > 0.6 ? 'left' : 'right'));
      tr.push({ x: ax, y: R.anchorPts.map(p => G(p.profit)), text: nm, type: 'scatter', mode: 'markers+text', textposition: pos, cliponaxis: false, textfont: { size: 10.5, color: t.muted }, name: t_('env_anchor'), marker: { size: 10, symbol: 'diamond-open', color: t.ink2, line: { width: 2 } }, hovertemplate: '%{text}<br>GWP %{x:,.0f} · £%{y:,.0f}<extra></extra>' });
    }
    tr.push({ x: [R.kpi.gwp], y: [G(R.kpi.profit)], type: 'scatter', mode: 'markers', name: t_('env_cur', { id: R.id }), marker: { size: 18, symbol: 'star', color: t.accent, line: { color: t.surface, width: 1.5 } }, hovertemplate: 'GWP %{x:,.0f} · £%{y:,.0f}<extra></extra>' });
    const allX = tr.flatMap(d => d.x), allY = tr.flatMap(d => d.y);
    plot('p-env-trade', tr, layout(t, { hovermode: 'closest', xaxis: { title: { text: t_('ax_gwp') }, range: padRange(allX, 0.1), tickformat: ',.0f' }, yaxis: { title: { text: t_('ax_profit') }, tickprefix: '£', tickformat: ',.0f', range: padRange(allY, 0.14) } }));
    $('#env-trade-note').textContent = R.cloud ? t_('env_trade_knee', { n: R.cloud.length, k: R.cloud.filter(p => p.nd).length, a: fmt(R.weights[0], 2), b: fmt(R.weights[1], 2), c: fmt(R.weights[2], 2) })
      : R.anchorPts ? t_('env_trade_env', { a: fmt(R.weights[0], 2), b: fmt(R.weights[1], 2), c: fmt(R.weights[2], 2) }) : t_('env_trade_single');
    const rs = S.runs.filter(r => r.lca), modes = ['cost', 'profit', 'env', 'knee'], mc = { cost: t.amber, profit: t.coral, env: t.green, knee: t.accent };
    plot('p-env-runs', modes.filter(m => rs.some(r => r.inputs.mode === m)).map(m => {
      const q = rs.filter(r => r.inputs.mode === m);
      return { x: q.map(r => r.kpi.gwp), y: q.map(r => G(r.kpi.profit)), text: q.map(r => r.id), name: MN(m), type: 'scatter', mode: 'markers',
        marker: { size: q.map(r => r === R ? 16 : 11), color: mc[m], symbol: q.map(r => r === R ? 'star' : 'circle'), line: { color: t.surface, width: 1.5 } },
        hovertemplate: `%{text} · ${esc(MN(m))}<br>GWP %{x:,.0f} kg CO₂e · £%{y:,.0f}<extra></extra>` };
    }), layout(t, { hovermode: 'closest', xaxis: { title: { text: t_('ax_gwp') }, range: padRange(rs.map(r => r.kpi.gwp)), tickformat: ',.0f' },
      yaxis: { title: { text: t_('ax_profit') }, tickprefix: '£', tickformat: ',.0f', range: padRange(rs.map(r => G(r.kpi.profit))) } }));
  }

  function renderIngs(t) {
    let h = `<table><thead><tr><th>${t_('i_name')}</th><th class="r">${t_('i_base')}</th><th class="r">${t_('i_price')}</th><th class="r">${t_('i_lb')}</th><th class="r">${t_('i_ub')}</th><th class="r">${t_('i_dm')}</th><th class="r">${t_('i_cp')}</th><th class="r">${t_('i_ee')}</th><th class="r">${t_('i_st')}</th><th class="r">${t_('i_lys')}</th><th class="r">${t_('i_p')}</th><th class="r">ADC-N</th><th class="r">ADC-L</th><th class="r">GWP</th><th class="r">EP (P)</th></tr></thead><tbody>`;
    const pc = v => fmt(v * 100, 1) + '%';
    S.ings.forEach((i, j) => {
      const base = i.price * 1000, ov = S.override[i.name];
      h += `<tr><td><b>${esc(ingLabel(i.name))}</b>${i.ub <= 0 ? ` <span class="excl">${t_('excluded')}</span>` : ''}</td><td class="r">${fmt0(G(base))}</td>
        <td class="r"><input class="pricein${ov != null ? ' changed' : ''}" id="price-${j}" data-j="${j}" type="number" min="0" step="5" value="${Math.round(G(ov ?? base))}" aria-label="${esc(t_('price_aria', { n: ingLabel(i.name) }))}"></td>
        <td class="r">${fmt0(i.lb)}</td><td class="r">${fmt0(i.ub)}</td><td class="r">${pc(i.DM)}</td><td class="r">${pc(i.CP)}</td><td class="r">${pc(i.EE)}</td><td class="r">${pc(i.ST)}</td><td class="r">${fmt(i.LYS * 100, 2)}%</td><td class="r">${fmt(i.P * 100, 2)}%</td><td class="r">${fmt(i.ADCN, 2)}</td><td class="r">${fmt(i.ADCL, 2)}</td><td class="r">${S.lca ? fmt(i.GWP, 3) : '—'}</td><td class="r">${S.lca ? fmt(i.EP_P * 1000, 3) + '‰' : '—'}</td></tr>`;
    });
    $('#ingtab').innerHTML = h + '</tbody></table>';
    $$('#ingtab .pricein').forEach(inp => inp.onchange = () => {
      const i = S.ings[+inp.dataset.j], v = parseFloat(inp.value) * fx();   // entered in £/t, stored in CNY/t
      if (!isFinite(v) || v < 0 || Math.abs(v - i.price * 1000) < 0.5 * fx()) delete S.override[i.name]; else S.override[i.name] = v;
      inp.classList.toggle('changed', S.override[i.name] != null);
      renderStatus(); renderAlerts(); renderPC(th());
    });
    renderPC(t);
  }
  function renderPC(t) {
    const arr = S.ings.filter(i => i.CP >= 0.05).map(i => ({ n: ingLabel(i.name), v: G(priceT(i)) / 1000 / i.CP })).sort((a, b) => a.v - b.v);
    const hgt = Math.max(300, 30 * arr.length + 70);
    $('#p-pc').style.height = hgt + 'px';
    plot('p-pc', [{ type: 'bar', orientation: 'h', y: arr.map(a => a.n), x: arr.map(a => a.v), marker: { color: arr.map((_, i) => i < 3 ? t.accent : hexA(t.accent, 0.4)) },
      text: arr.map(a => '£' + fmt(a.v, 2)), textposition: 'outside', textfont: { color: t.ink }, hovertemplate: `%{y}: £%{x:.2f}${t_('pc_hover')}<extra></extra>` }],
      layout(t, { showlegend: false, hovermode: 'closest', height: hgt, margin: { l: labelMargin(arr.map(a => a.n)), t: 10, r: 30 }, xaxis: { gridcolor: t.grid, title: { text: t_('ax_pc') }, range: [0, Math.max(...arr.map(a => a.v), 1) * 1.22] }, yaxis: { autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)' } }));
  }

  function renderEmptyPanels() {
    $$('[data-panel] > .empty').forEach(e => e.remove());
    if (cur()) return;
    ['overview', 'growth', 'formula', 'econ', 'env'].forEach(p => {
      document.querySelector(`[data-panel=${p}]`).insertAdjacentHTML('afterbegin', `<div class="empty">${t_('empty_loading')}</div>`);
    });
  }

  function renderTab() {
    const t = th();
    if (S.tab === 'overview') renderOverview(t);
    if (S.tab === 'growth') renderGrowth(t);
    if (S.tab === 'formula') renderFormula(t);
    if (S.tab === 'econ') renderEcon(t);
    if (S.tab === 'compare') renderCompare(t);
    if (S.tab === 'env') renderEnv(t);
    if (S.tab === 'ings') renderIngs(t);
    if (S.tab === 'vision' && window.YaoyiVision) window.YaoyiVision.render(t);
  }
  function renderAll() { renderEmptyPanels(); renderStatus(); renderAlerts(); renderKPIs(); renderTab(); }

  // ---------------- wiring ----------------
  function setTab(name) {
    S.tab = name;
    $$('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
    renderTab();
    try { localStorage.setItem('yaoyi-tab', name); } catch (e) { }
  }
  function syncLabels() {
    const d = +$('#days').value, o = +$('#toff').value;
    $('#days-o').textContent = t_('days_o', { n: d });
    $('#toff-o').textContent = sgn(o) + o.toFixed(1) + ' °C';
    $('#mkt-o').textContent = sgn(S.mkt) + S.mkt + '%';
    $('#harvest-hint').textContent = t_('harvest_hint', { d: iso(E.dateAt(d)), p: fmt(G(E.fishPrice(d)), 2) });
    const pv = `${parseFloat($('#w0').value)},${d},${o}`;
    $$('#presets button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === pv)));
  }
  function onInputChange() { syncLabels(); renderStatus(); renderAlerts(); }
  function renderSource() {
    const usable = S.ings.filter(i => i.ub > 0).length, name = S.src.name, k = S.src.kind;
    const lcaTxt = S.lca ? t_('src_lca') : t_('src_nolca');
    $('#src').innerHTML = k === 'builtin'
      ? `<span class="tag ok">${t_('builtin_name')}</span> ${esc(t_('src_builtin', { n: S.ings.length, u: usable }))} ${lcaTxt}`
      : name
        ? `<span class="tag ok">CSV</span> ${esc(t_('src_loaded', { name, n: S.ings.length, u: usable }))}${S.nan ? esc(t_('src_nan', { n: S.nan })) : ''} ${lcaTxt}`
        : `<span class="tag">Demo</span> ${t_('src_sample')}`;
    $('#lock-box').hidden = k === 'builtin';
    $('#lock-sample').hidden = k === 'sample';
  }
  function setSource(res, name, kind) {
    S.ings = res.ings; S.override = {}; S.nan = res.nanCount; S.lca = !!res.lca; S.src = { kind: kind || (name ? 'file' : 'sample'), name: name || '' };
    renderSource();
    if (S.tab === 'ings') renderIngs(th());
    renderStatus(); renderAlerts();
  }
  function readFile(file) {
    const fr = new FileReader();
    fr.onload = () => {
      const buf = new Uint8Array(fr.result); let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { try { text = new TextDecoder('gbk').decode(buf); } catch (e2) { text = new TextDecoder('utf-8').decode(buf); } }
      try {
        const res = loadIngredients(text);
        if ($('#csvcur').value === 'GBP') res.ings.forEach(i => { i.price *= fx(); });   // the model works in CNY
        setSource(res, file.name); S.lastErr = null; run();
      }
      catch (e) { S.lastErr = { k: 'err_csv', name: file.name, m: e.message }; renderAlerts(); }
    };
    fr.readAsArrayBuffer(file);
  }
  // ---------------- built-in ingredient table (AES-GCM encrypted; the key is derived from a passphrase) ----------------
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function decryptBuiltin(pass) {
    if (!(window.crypto && crypto.subtle)) throw new Error(t_('lock_nocrypto'));
    const res = await fetch('assets/data/ingredients.enc.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(t_('lock_nofile'));
    const box = await res.json();
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(box.salt), iterations: box.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.ct)); } catch (e) { throw new Error(t_('lock_bad')); }
    return new TextDecoder('utf-8').decode(plain);
  }
  async function unlock(pass, remember, auto) {
    const msg = $('#lock-msg'); msg.textContent = t_('lock_busy');
    try {
      const text = await decryptBuiltin(pass);
      setSource(loadIngredients(text), t_('builtin_name'), 'builtin'); S.lastErr = null;
      try { if (remember) localStorage.setItem('yaoyi-key', pass); else localStorage.removeItem('yaoyi-key'); } catch (e) { }
      $('#lock-pass').value = ''; msg.textContent = '';
      if (!auto) run();
      return true;
    } catch (e) {
      msg.textContent = e.message;
      if (auto) { try { localStorage.removeItem('yaoyi-key'); } catch (e2) { } msg.textContent = ''; }
      return false;
    }
  }

  function onLang() {
    syncLabels(); renderSource();
    $('#run-label').textContent = t_(S.busy ? 'running' : 'run');
    $('#run-hint').textContent = t_(S.hint.k, S.hint.v);
    renderAll();
  }

  function init() {
    I.apply();
    setSource(loadIngredients(SAMPLE_CSV), '');
    let fxT; $('#fx').addEventListener('input', () => { clearTimeout(fxT); fxT = setTimeout(() => { syncLabels(); renderAll(); }, 120); });
    $$('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
    $('#tabs').addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const bs = $$('#tabs button'), i = bs.findIndex(b => b.dataset.tab === S.tab), n = bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length];
      setTab(n.dataset.tab); n.focus();
    });
    $$('#presets button').forEach(b => b.onclick = () => { const [w, d, o] = b.dataset.p.split(',').map(Number); $('#w0').value = w; $('#days').value = d; $('#toff').value = o; onInputChange(); });
    ['#w0', '#days', '#toff'].forEach(s => $(s).addEventListener('input', onInputChange));
    $$('input[name=mode]').forEach(r => r.addEventListener('change', onInputChange));
    $('#mkt').addEventListener('input', () => { S.mkt = +$('#mkt').value; syncLabels(); renderStatus(); renderAlerts(); if (S.tab === 'ings') renderPC(th()); });
    $('#run').onclick = run;
    $('#csv').onchange = e => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ''; };
    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
    $('#lock-go').onclick = () => { const v = $('#lock-pass').value.trim(); if (v) unlock(v, $('#lock-rem').checked, false); };
    $('#lock-pass').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#lock-go').click(); } });
    $('#lock-sample').onclick = () => { setSource(loadIngredients(SAMPLE_CSV), ''); try { localStorage.removeItem('yaoyi-key'); } catch (e) { } run(); };
    $('#reset-prices').onclick = () => { S.override = {}; S.mkt = 0; $('#mkt').value = 0; syncLabels(); renderIngs(th()); renderStatus(); renderAlerts(); };
    $('#clear-runs').onclick = () => { const keep = cur(); S.runs = keep ? [keep] : []; if (keep) keep.id = 'S1'; S.active = S.runs.length - 1; renderAll(); };
    $('#fadj').addEventListener('input', () => renderWhatIf(th()));
    $('#copy-recipe').onclick = () => {
      const R = cur(); if (!R) return;
      const used = usedIdx(R), sn = SN();
      const lines = [[t_('r_ing'), t_('r_price'), ...sn.map(n => n + ' (kg/t)')].join('\t')];
      used.forEach(j => lines.push([ingLabel(R.ingNames[j]), Math.round(G(R.pricesT[j])), ...[0, 1, 2].map(k => R.recipe[k][j].toFixed(2))].join('\t')));
      lines.push([t_('premix'), '', '50', '50', '50'].join('\t'));
      lines.push([t_('r_total') + ' (£/t)', '', ...R.stagePriceT.map(v => G(v).toFixed(0))].join('\t'));
      const txt = lines.join('\n');
      const ok = () => { $('#copy-ok').hidden = false; setTimeout(() => { $('#copy-ok').hidden = true; }, 1800); $('#copy-fallback').innerHTML = ''; };
      const fail = () => { $('#copy-fallback').innerHTML = `<textarea class="fallback" id="fallback-text" readonly></textarea><div class="hint">${t_('copy_fallback')}</div>`; const ta = $('#fallback-text'); ta.value = txt; ta.select(); };
      try { navigator.clipboard.writeText(txt).then(ok, fail); } catch (e) { fail(); }
    };
    let tm; const rerender = () => { clearTimeout(tm); tm = setTimeout(() => { renderTab(); if (cur()) renderKPIs(); }, 60); };
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rerender); } catch (e) { }
    new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    let saved = null; try { saved = localStorage.getItem('yaoyi-tab'); } catch (e) { }
    syncLabels(); setHint('run_hint');
    renderEmptyPanels();
    setTab(saved && document.querySelector(`[data-panel=${saved}]`) ? saved : 'overview');
    renderStatus();
    waves();
    let key = null; try { key = localStorage.getItem('yaoyi-key'); } catch (e) { }
    if (key) unlock(key, true, true).then(() => setTimeout(run, 30)); else setTimeout(run, 60);
  }

  function waves() {
    const cv = $('#waves'); if (!cv) return;
    const ctx = cv.getContext('2d'); const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let ph = 0;
    function draw() {
      const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      [[0.16, 9, 0.010, 0.75], [0.10, 6, 0.016, 0.88], [0.07, 4, 0.022, 0.62]].forEach(([a, amp, f, y], n) => {
        ctx.beginPath(); ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 8) ctx.lineTo(x, h * y + Math.sin(x * f + ph * (1 + n * 0.4)) * amp);
        ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = `rgba(126,219,216,${a})`; ctx.fill();
      });
      ph += 0.012;
      if (!reduce) requestAnimationFrame(draw);
    }
    draw();
    window.addEventListener('resize', () => { if (reduce) draw(); });
  }

  window.YaoyiApp = {
    th, plot, layout, hexA, tab: () => S.tab,
    useInitialWeight(w) { $('#w0').value = w; onInputChange(); setTab('overview'); run(); },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
