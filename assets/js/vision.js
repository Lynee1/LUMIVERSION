(function () {
  'use strict';
  const A = () => window.YaoyiApp, I = window.YaoyiI18n, t_ = I.t, VC = window.YaoyiVCore;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const fmt = (v, d) => (v != null && isFinite(v)) ? (+v).toLocaleString(I.locale(), { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- calibration data: the user's 15 measured largemouth bass (L = total length incl. tail fin, H = max body height) ----------
  const USER_DATA = [
    [94.5, 18.6, 5.3, 3], [120.5, 20, 6.2, 3], [118.1, 21.4, 5.6, 2.5], [154.2, 22, 6.5, 3], [88.6, 17.5, 5, 2.5],
    [171.7, 21.8, 6.6, 3], [194.4, 23, 7, 3], [268.8, 25, 8.3, 3.2], [213.6, 24.4, 7.4, 3.3], [243.8, 24.4, 8.3, 3.4],
    [206.7, 22.8, 6.9, 3.2], [72.6, 16.9, 4.9, 2.4], [70.4, 17, 4.6, 2.5], [74.6, 16.5, 5, 2], [172.3, 20.6, 6.7, 2.7],
  ];
  // the user's underwater stereo frames (ZED, side-by-side 2560 × 720). axis = a hand-placed snout → tail-fin tip for the demo
  const SAMPLES = [
    { src: 'samples/pair1.jpg', axis: [[642, 522], [960, 524]] },
    { src: 'samples/pair2.jpg' },
    { src: 'samples/pair3.jpg', axis: [[490, 333], [882, 327]] },
    { src: 'samples/pair4.jpg' },
  ];
  // ZED factory calibration (left camera; per resolution) and baseline
  const CAMS = {
    zed_hd: { B: 120.027, f: 528.085, cx: 656.435, cy: 341.689, half: 1280 },
    zed_fhd: { B: 120.027, f: 1056.17, cx: 995.87, cy: 506.378, half: 1920 },
    zed_2k: { B: 120.027, f: 1056.17, cx: 1139.87, cy: 587.378, half: 2208 },
    zed_vga: { B: 120.027, f: 264.0425, cx: 343.7175, cy: 178.3445, half: 672 },
  };
  const N_WATER = 1.333, STORE = 'yaoyi.vision.records.v1';
  const V = {
    data: USER_DATA.map(r => ({ W: r[0], L: r[1], H: r[2], T: r[3] })),
    modelSel: 'auto', fits: null, best: null,
    img: null, imgW: 0, imgH: 0, pix: null, G: null, gen: 0, type: 'stereo', view: 'both', sample: 0, srcName: '',
    meas: null, R: { len: [], hgt: [] }, match: null, ref: [], roi: null, pending: null, hgtManual: false,
    cands: [], candSel: -1, mode: 'axis', drag: null, busy: null, msg: null, bound: false, fromImg: false,
    recs: [], recId: null, clearArm: false,
  };
  const hw = () => V.type === 'stereo' ? V.imgW / 2 : V.imgW;

  // ---------- regression ----------
  const MODELS = [
    { id: 'lh', name: 'W = a·L^b·H^c', cols: r => [1, Math.log(r.L), Math.log(r.H)], off: () => 0, predictive: true },
    { id: 'l', name: 'W = a·L^b', cols: r => [1, Math.log(r.L)], off: () => 0, predictive: true },
    { id: 'h', name: 'W = a·H^c', cols: r => [1, Math.log(r.H)], off: () => 0, predictive: true },
    { id: 'lh2', name: 'W = k·L·H²', cols: () => [1], off: r => Math.log(r.L) + 2 * Math.log(r.H), predictive: true },
    { id: 'lht', name: 'W = a·L^b·H^c·T^d', cols: r => [1, Math.log(r.L), Math.log(r.H), Math.log(r.T)], off: () => 0, predictive: false, needT: true },
  ];
  function solveSym(M, b) {
    const n = b.length, A2 = M.map((r, i) => r.concat([b[i]]));
    for (let i = 0; i < n; i++) {
      let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(A2[k][i]) > Math.abs(A2[p][i])) p = k;
      [A2[i], A2[p]] = [A2[p], A2[i]];
      if (Math.abs(A2[i][i]) < 1e-12) return null;
      for (let k = i + 1; k < n; k++) { const f = A2[k][i] / A2[i][i]; for (let j = i; j <= n; j++) A2[k][j] -= f * A2[i][j]; }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let s = A2[i][n]; for (let j = i + 1; j < n; j++) s -= A2[i][j] * x[j]; x[i] = s / A2[i][i]; }
    return x;
  }
  function inv(M) { const n = M.length, out = []; for (let j = 0; j < n; j++) { const e = new Array(n).fill(0); e[j] = 1; const c = solveSym(M, e); if (!c) return null; out.push(c); } return M.map((_, i) => out.map(c => c[i])); }
  function ols(m, rows) {
    const X = rows.map(m.cols), y = rows.map(r => Math.log(r.W) - m.off(r)), k = X[0] ? X[0].length : 0, n = rows.length;
    if (!k || n <= k) return null;
    const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, x) => s + x[i] * x[j], 0)));
    const Xty = Array.from({ length: k }, (_, i) => X.reduce((s, x, r) => s + x[i] * y[r], 0));
    const beta = solveSym(XtX, Xty); if (!beta) return null;
    const res = y.map((v, r) => v - X[r].reduce((s, x, i) => s + x * beta[i], 0));
    const s2 = res.reduce((s, e) => s + e * e, 0) / (n - k);
    return { beta, s2, XtXi: inv(XtX), df: n - k, k, n };
  }
  const predictLog = (m, f, r) => m.cols(r).reduce((s, v, i) => s + v * f.beta[i], 0) + m.off(r);
  function tq(df) { // 97.5% Student-t quantile, Cornish–Fisher expansion
    const z = 1.959964, z3 = z ** 3, z5 = z ** 5, z7 = z ** 7;
    return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df ** 2) + (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df ** 3);
  }
  function refit() {
    const rows = V.data.filter(r => [r.W, r.L, r.H].every(v => isFinite(v) && v > 0));
    const hasT = rows.length && rows.every(r => isFinite(r.T) && r.T > 0);
    V.rows = rows;
    V.fits = MODELS.filter(m => !m.needT || hasT).map(m => {
      const f = rows.length ? ols(m, rows) : null; if (!f) return { m, ok: false };
      const pred = rows.map(r => Math.exp(predictLog(m, f, r)));
      const loo = rows.map((r, i) => { const g = ols(m, rows.filter((_, j) => j !== i)); return g ? Math.exp(predictLog(m, g, r)) : NaN; });
      const Wm = rows.reduce((s, r) => s + r.W, 0) / rows.length;
      const sse = rows.reduce((s, r, i) => s + (r.W - pred[i]) ** 2, 0), sst = rows.reduce((s, r) => s + (r.W - Wm) ** 2, 0);
      const mape = a => rows.reduce((s, r, i) => s + Math.abs(r.W - a[i]) / r.W, 0) / rows.length * 100;
      const lres = rows.reduce((s, r, i) => s + (Math.log(r.W) - Math.log(pred[i])) ** 2, 0) / rows.length;
      return { m, ok: true, f, pred, loo, r2: 1 - sse / sst, rmse: Math.sqrt(sse / rows.length), mape: mape(pred), loomape: mape(loo),
        loormse: Math.sqrt(rows.reduce((s, r, i) => s + (r.W - loo[i]) ** 2, 0) / rows.length), aic: rows.length * Math.log(lres) + 2 * (f.k + 1) };
    });
    const pr = V.fits.filter(x => x.ok && x.m.predictive && isFinite(x.loomape));
    V.best = pr.length ? pr.reduce((a, b) => b.loomape < a.loomape ? b : a) : null;
    V.hlRatio = rows.length ? rows.reduce((s, r) => s + r.H / r.L, 0) / rows.length : 0.3;
  }
  function active() {
    if (!V.fits) refit();
    if (V.modelSel !== 'auto') { const f = V.fits.find(x => x.m.id === V.modelSel && x.ok); if (f) return f; }
    return V.best;
  }
  function estimate(L, H, F) {
    F = F || active(); if (!F || !(L > 0) || !(H > 0)) return null;
    const r = { L, H }, mu = predictLog(F.m, F.f, r), x = F.m.cols(r);
    let q = 0; for (let i = 0; i < x.length; i++) for (let j = 0; j < x.length; j++) q += x[i] * F.f.XtXi[i][j] * x[j];
    const se = Math.sqrt(F.f.s2 * (1 + q)), t = tq(F.f.df);
    return { W: Math.exp(mu), lo: Math.exp(mu - t * se), hi: Math.exp(mu + t * se) };
  }
  function eqText(F) {
    const b = F.f.beta, a = Math.exp(b[0]);
    if (F.m.id === 'lh') return `W = ${fmt(a, 4)} · L<sup>${fmt(b[1], 3)}</sup> · H<sup>${fmt(b[2], 3)}</sup>`;
    if (F.m.id === 'l') return `W = ${fmt(a, 5)} · L<sup>${fmt(b[1], 3)}</sup>`;
    if (F.m.id === 'h') return `W = ${fmt(a, 4)} · H<sup>${fmt(b[1], 3)}</sup>`;
    if (F.m.id === 'lh2') return `W = ${fmt(a, 4)} · L · H<sup>2</sup>`;
    return `W = ${fmt(a, 4)} · L<sup>${fmt(b[1], 3)}</sup> · H<sup>${fmt(b[2], 3)}</sup> · T<sup>${fmt(b[3], 3)}</sup>`;
  }

  // ---------- measurement jobs: in a worker when possible, inline otherwise (e.g. opened from file://) ----------
  const Jobs = {
    w: null, seq: 0, wait: new Map(), latest: {},
    init() {
      try {
        this.w = new Worker('assets/js/vworker.js');
        this.w.onmessage = e => { const cb = this.wait.get(e.data.id); if (cb) { this.wait.delete(e.data.id); cb(e.data); } };
        this.w.onerror = () => { this.w = null; this.wait.forEach(cb => cb({ fallback: true })); this.wait.clear(); };
      } catch (e) { this.w = null; }
    },
    inline(m) {
      const withMatch = meas => ({ meas, match: !meas.error && m.stereo ? VC.matchRight(V.G, meas.len.concat(meas.hgt || []), meas.mask, m.half) : null });
      if (m.type === 'pick') return VC.autoPick(V.pix, V.G, m.half, m.cal, m.stereo);
      if (m.type === 'axis') return withMatch(VC.measureAxis(V.pix, m.p0, m.p1));
      if (m.type === 'roi') return withMatch(VC.autoMeasure(V.pix, m.roi, m.seed));
      if (m.type === 'match') return VC.matchRight(V.G, m.pts, m.mask, m.half);
      return null;
    },
    // run a job; only the newest job of each kind ('measure' covers pick / axis / roi) delivers its result
    async run(kind, m) {
      const id = ++this.seq, gen = V.gen; this.latest[kind] = id; m.id = id;
      if (this.w && this.readyP) await this.readyP;
      return new Promise(res => {
        const done = r => { if (this.latest[kind] === id && V.gen === gen) res(r); };
        const local = () => setTimeout(() => { let r = null; try { r = this.inline(m); } catch (e) { console.error(e); } done(r); }, 20);
        if (!this.w || !this.ready) return local();
        this.wait.set(id, d => d.fallback ? local() : done(d.err ? null : d.r));
        this.w.postMessage(m);
      });
    },
    sendImage() {
      this.ready = false; if (!this.w) return;
      const id = ++this.seq, gen = V.gen, d = new Uint8ClampedArray(V.pix.d);
      this.readyP = new Promise(res => {
        const t = setTimeout(() => { this.wait.delete(id); res(); }, 4000); // worker unresponsive: fall back to inline
        this.wait.set(id, r => { clearTimeout(t); if (V.gen === gen && !r.fallback && !r.err) this.ready = true; res(); });
      });
      this.w.postMessage({ type: 'img', id, d, w: V.pix.w, h: V.pix.h }, [d.buffer]);
    },
  };

  // ---------- calibration & metric size ----------
  function cal() {
    const B = parseFloat($('#vB').value), f = parseFloat($('#vf').value), cx = parseFloat($('#vcx').value), cy = parseFloat($('#vcy').value);
    const water = $('#vwater').checked;
    return { B, f: f > 0 ? f * (water ? N_WATER : 1) : NaN, cx, cy, h: V.imgH };
  }
  function setCam(key) {
    $('#vcam').value = key;
    const c = CAMS[key]; if (!c) return;
    $('#vB').value = c.B; $('#vf').value = c.f; $('#vcx').value = c.cx; $('#vcy').value = c.cy;
  }
  function camForImage() { // pick the ZED resolution that matches the frame; keep a custom setting otherwise
    const half = hw(), k = Object.keys(CAMS).find(k => CAMS[k].half === half && Math.abs(CAMS[k].cy * 2 - V.imgH) < V.imgH * 0.25);
    if (k) setCam(k); else if ($('#vcam').value !== 'custom') { $('#vcam').value = 'custom'; $('#vcx').value = ''; $('#vcy').value = ''; }
  }
  const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function measured() {
    const out = { pxLen: null, pxHgt: null, L: null, H: null, disp: null, Z: null, ppc: null };
    const M = V.meas; if (!M) return out;
    if (M.len && M.len.length === 2) out.pxLen = D(M.len[0], M.len[1]);
    if (M.hgt && M.hgt.length === 2) out.pxHgt = D(M.hgt[0], M.hgt[1]);
    if (V.type === 'mono') {
      if (V.ref.length === 2) { const cm = parseFloat($('#vscale').value); if (cm > 0) out.ppc = D(V.ref[0], V.ref[1]) / cm; }
      if (out.ppc) { if (out.pxLen) out.L = out.pxLen / out.ppc; if (out.pxHgt) out.H = out.pxHgt / out.ppc; }
      return out;
    }
    const s = VC.metricSize(M.len, V.R.len, M.hgt, V.R.hgt, hw(), cal());
    return Object.assign(out, { L: s.L, H: s.H, disp: s.disp, Z: s.Z });
  }
  function syncRight(which) {
    if (V.type !== 'stereo' || !V.match || !V.meas) return;
    const sh = p => [p[0] - V.match.d + hw(), p[1] + V.match.dy];
    (which ? [which] : ['len', 'hgt']).forEach(k => { V.R[k] = (V.meas[k] || []).map(sh); });
  }

  // ---------- applying results ----------
  function applyMeas(meas, match, method, msg) {
    if (!meas || meas.error) { V.msg = { k: meas ? meas.error : 'auto_none' }; update(); return false; }
    V.meas = { len: meas.len, hgt: meas.hgt || [], mask: meas.mask || null, outline: meas.outline || null, feat: meas.feat, method };
    V.match = match || null; V.R = { len: [], hgt: [] }; syncRight(); V.hgtManual = false; V.pending = null;
    V.fromImg = true; V.recId = null;
    V.msg = msg || null;
    if (V.type === 'stereo') V.msg2 = match ? { k: match.s >= 0.6 ? 'match_ok' : 'match_low', v: { d: match.d, s: fmt(match.s, 2) } } : { k: 'match_none' };
    update(); return true;
  }
  async function autoDetect(thenAxis) {
    if (!V.pix) return;
    V.busy = 'busy_auto'; V.cands = []; V.candSel = -1; update();
    const res = await Jobs.run('pick', { type: 'pick', half: hw(), cal: cal(), stereo: V.type === 'stereo' });
    V.busy = null;
    if (!res) { update(); return; }
    V.cands = res;
    if (thenAxis) { renderCands(); return runAxis(thenAxis[0], thenAxis[1], 'sample'); }
    if (res.length) { pickCand(0, true); }
    else { V.meas = null; V.msg = { k: 'auto_pick_none' }; setMode('axis'); update(); }
  }
  function pickCand(i, first) {
    const c = V.cands[i]; if (!c) return;
    V.candSel = i; V.roi = null;
    applyMeas(c.meas, c.match, 'auto', { k: first ? 'auto_pick_ok' : 'auto_pick_sel', v: { n: V.cands.length, k: i + 1, s: c.match ? fmt(c.match.s, 2) : '—' } });
    setMode('axis');
  }
  async function runAxis(p0, p1, method) {
    V.busy = 'busy_axis'; V.pending = null; V.candSel = -1; update();
    const r = await Jobs.run('measure', { type: 'axis', p0, p1, half: hw(), stereo: V.type === 'stereo' });
    V.busy = null;
    if (!r) { update(); return; }
    applyMeas(r.meas, r.match, method || 'axis', { k: method === 'sample' ? 'axis_sample' : 'axis_done' });
  }
  async function runRoi(roi) {
    V.busy = 'busy_auto'; V.candSel = -1; update();
    const r = await Jobs.run('measure', { type: 'roi', roi, half: hw(), stereo: V.type === 'stereo' });
    V.busy = null;
    if (!r) { update(); return; }
    applyMeas(r.meas, r.match, 'roi', r.meas && !r.meas.error ? { k: 'auto_done', v: { feat: t_(r.meas.feat), eta: fmt(r.meas.eta, 2), n: r.meas.n } } : null);
  }
  // after the length end-points move: re-trace the body height along the new axis (unless the user placed it by hand)
  async function remeasureAfterDrag() {
    const M = V.meas; if (!M || M.len.length !== 2) return;
    if (V.hgtManual) {
      if (V.type !== 'stereo') { update(); return; }
      const m = await Jobs.run('measure', { type: 'match', pts: M.len.concat(M.hgt), mask: M.mask, half: hw() });
      if (m) { V.match = m; syncRight(); V.msg2 = { k: m.s >= 0.6 ? 'match_ok' : 'match_low', v: { d: m.d, s: fmt(m.s, 2) } }; }
      update(); return;
    }
    const keep = M.method === 'auto' || M.method === 'sample' ? 'axis' : M.method === 'roi' ? 'axis' : M.method;
    const rid = V.recId;
    await runAxis(M.len[0], M.len[1], keep);
    V.recId = rid;
  }

  // ---------- canvas ----------
  function srcRect() {
    if (V.type === 'mono' || V.view === 'both') return { x: 0, w: V.imgW };
    return V.view === 'left' ? { x: 0, w: hw() } : { x: hw(), w: hw() };
  }
  function geom() {
    const cv = $('#vcanvas'), wrap = cv.parentElement, cw = wrap.clientWidth || 800, sr = srcRect();
    let s = cw / sr.w; const maxH = 560; if (V.imgH * s > maxH) s = maxH / V.imgH;
    return { cv, s, sr, cw: sr.w * s, ch: V.imgH * s };
  }
  function draw() {
    if (!V.img) return;
    const { cv, s, sr, cw, ch } = geom(), dpr = window.devicePixelRatio || 1;
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    g.setTransform(dpr * s, 0, 0, dpr * s, -sr.x * dpr * s, 0);
    g.drawImage(V.img, 0, 0, V.imgW, V.imgH);
    const lw = 2 / s, rad = 5.5 / s, fs = 12.5 / s;
    if (V.type === 'stereo') { g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5 / s; g.beginPath(); g.moveTo(hw(), 0); g.lineTo(hw(), V.imgH); g.stroke(); }
    const label = (txt, x, y, bg) => {
      g.font = `700 ${fs}px "Archivo","Noto Sans SC",sans-serif`; const tw = g.measureText(txt).width;
      let lx = x - tw / 2 - 6 / s, ly = y; lx = Math.max(sr.x + 4 / s, Math.min(sr.x + sr.w - tw - 16 / s, lx)); ly = Math.max(4 / s, Math.min(V.imgH - 24 / s, ly));
      g.fillStyle = bg || 'rgba(7,16,25,.82)'; g.fillRect(lx, ly, tw + 12 / s, 20 / s); g.fillStyle = '#fff'; g.fillText(txt, lx + 6 / s, ly + 14.5 / s);
    };
    // automatic candidates
    V.cands.forEach((c, i) => {
      if (i === V.candSel) return;
      const r = c.roi; g.save(); g.setLineDash([4 / s, 4 / s]); g.strokeStyle = c.ok ? 'rgba(244,183,64,.75)' : 'rgba(255,255,255,.35)'; g.lineWidth = 1.2 / s;
      g.strokeRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); g.restore();
      label(String(i + 1), r[0] + 10 / s, r[1] + 3 / s, c.ok ? 'rgba(160,110,10,.85)' : 'rgba(7,16,25,.6)');
    });
    const M = V.meas;
    if (M && $('#v-mask').checked) {
      if (M.mask) {
        const K = M.mask; g.save(); g.globalAlpha = 0.28; g.fillStyle = '#2DBFCB';
        for (let y = 0; y < K.h; y++) { let x = 0; while (x < K.w) { if (K.fish[y * K.w + x]) { let x2 = x; while (x2 < K.w && K.fish[y * K.w + x2]) x2++; g.fillRect(K.x0 + x / K.f, K.y0 + y / K.f, (x2 - x) / K.f, 1 / K.f + 0.3); x = x2; } else x++; } }
        g.restore();
      }
      if (M.outline) { g.save(); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.3 / s; g.beginPath(); M.outline.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke(); g.restore(); }
    }
    if (V.roi) { const r = V.roi, x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]); g.save(); g.setLineDash([6 / s, 4 / s]); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.5 / s; g.strokeRect(x, y, Math.abs(r[2] - r[0]), Math.abs(r[3] - r[1])); g.restore(); }
    const Mz = measured();
    const seg = (pts, color, dashed) => {
      if (!pts || !pts.length) return;
      g.save(); if (dashed) g.setLineDash([5 / s, 4 / s]);
      g.strokeStyle = color; g.lineWidth = lw;
      if (pts.length === 2) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]); g.stroke(); }
      g.restore();
      pts.forEach(p => { g.beginPath(); g.arc(p[0], p[1], rad, 0, 7); g.fillStyle = '#fff'; g.fill(); g.lineWidth = lw; g.strokeStyle = color; g.stroke(); });
    };
    seg(V.ref, '#F4B740');
    if (M) { seg(M.len, '#2DBFCB'); seg(M.hgt, '#EE6E68'); seg(V.R.len, '#2DBFCB', true); seg(V.R.hgt, '#EE6E68', true); }
    if (V.pending) { seg([V.pending], '#2DBFCB'); label(t_('lbl_snout'), V.pending[0], V.pending[1] + 12 / s); }
    if (V.ref.length === 2) label(t_('lbl_ref', { v: fmt(parseFloat($('#vscale').value), 1) }), (V.ref[0][0] + V.ref[1][0]) / 2, Math.min(V.ref[0][1], V.ref[1][1]) - 30 / s);
    if (M && M.len.length === 2) label(Mz.L != null ? t_('lbl_len', { v: fmt(Mz.L, 1) }) : t_('lbl_len_px', { v: fmt(Mz.pxLen, 0) }), (M.len[0][0] + M.len[1][0]) / 2, Math.max(M.len[0][1], M.len[1][1]) + 12 / s);
    if (M && M.hgt.length === 2) { const tp = M.hgt[0][1] < M.hgt[1][1] ? M.hgt[0] : M.hgt[1]; label(Mz.H != null ? t_('lbl_hgt', { v: fmt(Mz.H, 1) }) : t_('lbl_hgt_px', { v: fmt(Mz.pxHgt, 0) }), tp[0], tp[1] - 30 / s); }
    if (V.busy) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.font = `700 13px "Archivo","Noto Sans SC",sans-serif`; const tx = t_(V.busy), tw = g.measureText(tx).width; g.fillStyle = 'rgba(7,16,25,.8)'; g.fillRect(10, 10, tw + 24, 28); g.fillStyle = '#fff'; g.fillText(tx, 22, 29); }
  }
  // a click (not a drag) in the current tool mode
  function clickAt(p) {
    const M = V.meas, inRight = V.type === 'stereo' && p[0] >= hw();
    if (inRight && V.mode !== 'ref') { V.msg = { k: 'roi_left' }; update(); return; }
    if (V.mode === 'roi') { V.roi = [p[0], p[1], p[0], p[1]]; V.drag = { roi: true }; return; }
    if (V.mode === 'ref') { if (V.ref.length >= 2) V.ref = []; V.ref.push(p); update(); return; }
    if (V.mode === 'hgt') {
      if (!M) { V.msg = { k: 'hgt_need_len' }; update(); return; }
      if (V.hgtPick && V.hgtPick.length === 1) { M.hgt = [V.hgtPick[0], p]; V.hgtPick = null; V.hgtManual = true; M.method = 'manual'; syncRight('hgt'); V.fromImg = true; V.msg = { k: 'hgt_done' }; }
      else { V.hgtPick = [p]; M.hgt = [p]; V.R.hgt = []; }
      update(); return;
    }
    // two-point mode: snout, then tail-fin tip
    if (!V.pending) { V.pending = p; V.msg = { k: 'axis_first' }; update(); return; }
    const p0 = V.pending; V.pending = null; runAxis(p0, p, 'axis');
  }
  function bindCanvas() {
    const cv = $('#vcanvas');
    const toImg = e => { const r = cv.getBoundingClientRect(), { s, sr } = geom(); return { p: [sr.x + (e.clientX - r.left) / s, (e.clientY - r.top) / s], s }; };
    let moved = false, down = null;
    cv.addEventListener('pointerdown', e => {
      if (!V.img || V.busy) return; const { p, s } = toImg(e); cv.setPointerCapture(e.pointerId); moved = false; down = [e.clientX, e.clientY];
      const M = V.meas, near = q => D(q, p) * s < 14;
      if (M) for (const [S, k] of [['L', 'len'], ['L', 'hgt'], ['R', 'len'], ['R', 'hgt']]) {
        const arr = S === 'L' ? M[k] : V.R[k];
        arr.forEach((q, i) => { if (!V.drag && near(q)) V.drag = { S, k, i }; });
      }
      V.ref.forEach((q, i) => { if (!V.drag && near(q)) V.drag = { ref: true, i }; });
      if (V.drag) { V.drag.p = p; return; }
      clickAt(p);
    });
    cv.addEventListener('pointermove', e => {
      if (!V.drag) return;
      if (!moved && down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) return;
      const { p } = toImg(e); moved = true;
      if (V.drag.roi) { V.roi[2] = Math.min(p[0], hw()); V.roi[3] = p[1]; draw(); return; }
      if (V.drag.ref) { V.ref[V.drag.i] = p; update(true); return; }
      const { S, k, i } = V.drag, M = V.meas;
      if (S === 'L') {
        const old = M[k][i]; M[k][i] = p;
        if (V.R[k][i]) V.R[k][i] = [V.R[k][i][0] + p[0] - old[0], V.R[k][i][1] + p[1] - old[1]];
        if (k === 'hgt') { V.hgtManual = true; M.method = 'manual'; }
        M.outline = k === 'len' ? null : M.outline;
      } else V.R[k][i] = p;
      V.fromImg = true; update(true);
    });
    const end = () => {
      const d = V.drag; V.drag = null;
      if (d && !d.roi && !moved && d.p && V.mode !== 'roi') { clickAt(d.p); return; } // a click on a point counts as a click
      if (d && d.roi) {
        const r = V.roi, w = Math.abs(r[2] - r[0]), h = Math.abs(r[3] - r[1]);
        if (w > 20 && h > 12) runRoi([Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]); else { V.roi = null; update(); }
        return;
      }
      if (d && moved && d.S === 'L' && d.k === 'len') { remeasureAfterDrag(); return; }
      update();
    };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  }
  function setMode(m) {
    V.mode = m; V.pending = null; V.hgtPick = null;
    $$('#vtools [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    renderTip();
  }
  function renderTip() {
    const k = V.mode === 'roi' ? (V.type === 'stereo' ? 'tip_roi_s' : 'tip_roi_m') : V.mode === 'axis' ? 'tip_axis' : V.mode === 'hgt' ? 'tip_hgt' : 'tip_ref';
    $('#vtip').textContent = t_(k);
  }
  function setType(tp, silent) {
    V.type = tp; V.R = { len: [], hgt: [] }; V.match = null; V.msg2 = null;
    $$('#vtype [data-type]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === tp)));
    $('#vtool-ref').hidden = tp !== 'mono'; $('#vcal-stereo').hidden = tp !== 'stereo'; $('#vcal-mono').hidden = tp !== 'mono';
    $('#vviewg').hidden = tp !== 'stereo'; $('#vmatch').hidden = tp !== 'stereo';
    if (tp === 'stereo' && V.mode === 'ref') setMode('axis');
    renderTip();
    if (!silent && V.img) { camForImage(); autoDetect(); }
  }
  function setView(v) { V.view = v; $$('#vview [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v))); draw(); }
  function renderCands() {
    const box = $('#vcands');
    if (!V.cands.length) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<span class="lbl">${t_('cand_lbl')}</span>` + V.cands.map((c, i) => {
      const sz = c.size, txt = sz && sz.L != null ? `${fmt(sz.L, 1)} × ${fmt(sz.H, 1)} cm` : `${fmt(D(c.meas.len[0], c.meas.len[1]), 0)} px`;
      return `<button type="button" class="chip${c.ok ? '' : ' bad'}" data-c="${i}" aria-pressed="${i === V.candSel}" title="${c.ok ? '' : esc(t_('cand_implaus'))}"><b>${i + 1}</b> ${txt}</button>`;
    }).join('');
    $$('#vcands [data-c]').forEach(b => b.onclick = () => pickCand(+b.dataset.c));
  }

  // ---------- panels ----------
  const METH = { auto: 'meth_auto', axis: 'meth_axis', roi: 'meth_roi', manual: 'meth_manual', sample: 'meth_sample', input: 'meth_input', paste: 'meth_paste' };
  function curMethod() { return !V.fromImg ? 'input' : V.meas ? V.meas.method : 'input'; }
  function update(light) {
    draw();
    renderCands();
    const M = measured();
    if (V.fromImg) { if (M.L != null) $('#vL').value = M.L.toFixed(1); if (M.H != null) $('#vH').value = M.H.toFixed(1); }
    const tiles = [];
    if (M.pxLen != null) tiles.push([t_('m_pxlen'), fmt(M.pxLen, 0) + ' px']);
    if (M.pxHgt != null) tiles.push([t_('m_pxhgt'), fmt(M.pxHgt, 0) + ' px']);
    if (V.type === 'stereo') {
      if (M.disp != null) tiles.push([t_('m_disp'), fmt(M.disp, 1) + ' px']);
      if (V.match) tiles.push([t_('m_match'), fmt(V.match.s, 2)]);
      if (M.Z != null) tiles.push([t_('m_depth'), fmt(M.Z, 1) + ' cm']);
    } else tiles.push([t_('m_scale'), M.ppc ? fmt(M.ppc, 1) + ' px/cm' : t_('not_cal')]);
    $('#vmeta').innerHTML = tiles.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
    const msgs = [];
    if (V.msg) msgs.push(t_(V.msg.k, V.msg.v));
    if (V.type === 'stereo' && V.msg2 && V.meas) msgs.push(t_(V.msg2.k, V.msg2.v));
    if (V.type === 'stereo' && !(parseFloat($('#vB').value) > 0)) msgs.push(t_('cal_need'));
    if (M.L != null && M.H != null && !VC.plausible(M.L, M.H)) msgs.push(t_('size_implaus'));
    $('#vmsg').textContent = msgs.join(' ');
    renderEstimate(light);
  }
  function renderEstimate(light) {
    const F = active();
    if (!F) { $('#vW').textContent = '—'; $('#vPI').innerHTML = t_('not_enough'); return; }
    const L = parseFloat($('#vL').value), H = parseFloat($('#vH').value), e = estimate(L, H);
    const rows = V.rows, Lr = [Math.min(...rows.map(r => r.L)), Math.max(...rows.map(r => r.L))], Hr = [Math.min(...rows.map(r => r.H)), Math.max(...rows.map(r => r.H))];
    const out = isFinite(L) && isFinite(H) && (L < Lr[0] * 0.95 || L > Lr[1] * 1.05 || H < Hr[0] * 0.95 || H > Hr[1] * 1.05);
    $('#vW').textContent = e ? fmt(e.W, 1) : '—';
    $('#vPI').textContent = e ? t_('pi', { lo: fmt(e.lo, 1), hi: fmt(e.hi, 1) }) : t_('pi_need');
    $('#vK').textContent = e ? fmt(100 * e.W / L ** 3, 2) : '—';
    $('#vHL').textContent = isFinite(L) && isFinite(H) ? fmt(H / L, 3) : '—';
    $('#vmodel-o').innerHTML = `${eqText(F)}<span class="hint" style="margin-left:8px">${t_('est_units')}</span>`;
    $('#vwarn').hidden = !out;
    $('#vwarn').textContent = out ? t_('extrap', { l1: fmt(Lr[0], 1), l2: fmt(Lr[1], 1), h1: fmt(Hr[0], 1), h2: fmt(Hr[1], 1) }) : '';
    const m = curMethod();
    $('#vsrcm').innerHTML = `<span class="tag${m === 'auto' ? ' warn' : ' ok'}">${t_(METH[m])}</span>${m === 'auto' ? ` <span class="hint">${t_('auto_verify')}</span>` : ''}`;
    const rec = V.recs.find(r => r.id === V.recId);
    $('#vsave').textContent = rec ? t_('upd_rec', { n: rec.id }) : t_('save_rec');
    $('#vsaveas').hidden = !rec;
    $('#vsave').disabled = !e;
    if (!light) renderCurve(A().th(), e && { L, H, W: e.W });
  }
  function renderCurve(t, cur) {
    const F = active(); if (!F) return; const rows = V.rows;
    const lmin = Math.min(...rows.map(r => r.L)) * 0.85, lmax = Math.max(...rows.map(r => r.L)) * 1.15;
    const Ls = Array.from({ length: 60 }, (_, i) => lmin + (lmax - lmin) * i / 59), E3 = Ls.map(L => estimate(L, V.hlRatio * L, F));
    const tr = [
      { x: Ls, y: E3.map(e => e && e.hi), type: 'scatter', mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
      { x: Ls, y: E3.map(e => e && e.lo), type: 'scatter', mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: A().hexA(t.accent, 0.12), name: t_('tr_pi'), hoverinfo: 'skip' },
      { x: Ls, y: E3.map(e => e && e.W), type: 'scatter', mode: 'lines', line: { color: t.accent, width: 2.5 }, name: t_('tr_curve', { r: fmt(V.hlRatio, 2) }), hovertemplate: 'L %{x:.1f} cm → %{y:.1f} g<extra></extra>' },
      { x: rows.map(r => r.L), y: rows.map(r => r.W), type: 'scatter', mode: 'markers', name: t_('tr_obs'), text: rows.map(r => r.H),
        marker: { size: 10, color: rows.map(r => r.H), colorscale: [[0, t.s[0]], [1, t.s[2]]], line: { color: t.surface, width: 1.5 }, colorbar: { title: { text: t_('cb_h'), font: { size: 11, color: t.muted } }, thickness: 10, len: 0.7, tickfont: { color: t.muted, size: 10 } } },
        hovertemplate: 'L %{x} cm · H %{text} cm<br>W %{y} g<extra></extra>' },
    ];
    const recs = V.recs.map(r => ({ r, e: estimate(r.L, r.H, F) })).filter(x => x.e);
    if (recs.length) tr.push({ x: recs.map(x => x.r.L), y: recs.map(x => x.e.W), text: recs.map(x => '#' + x.r.id), type: 'scatter', mode: 'markers', name: t_('tr_recs'), marker: { size: 8, symbol: 'diamond', color: t.green, line: { color: t.surface, width: 1 } }, hovertemplate: '%{text} · L %{x:.1f} cm → %{y:.1f} g<extra></extra>' });
    if (cur && isFinite(cur.W)) tr.push({ x: [cur.L], y: [cur.W], type: 'scatter', mode: 'markers', name: t_('tr_cur'), marker: { symbol: 'star', size: 17, color: t.amber, line: { color: t.surface, width: 1.5 } }, hovertemplate: 'L %{x:.1f} cm → %{y:.1f} g<extra></extra>' });
    A().plot('p-vcurve', tr, A().layout(t, { hovermode: 'closest', xaxis: { title: { text: t_('ax_L') } }, yaxis: { title: { text: t_('ax_W') } } }));
  }
  function renderFit(t) {
    const F = active(); if (!F) return; const rows = V.rows, mn = Math.min(...rows.map(r => r.W)) * 0.8, mx = Math.max(...rows.map(r => r.W)) * 1.12;
    A().plot('p-vfit', [
      { x: [0, mx], y: [0, mx * 1.1], type: 'scatter', mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
      { x: [0, mx], y: [0, mx * 0.9], type: 'scatter', mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: A().hexA(t.green, 0.1), name: t_('tr_band'), hoverinfo: 'skip' },
      { x: [0, mx], y: [0, mx], type: 'scatter', mode: 'lines', line: { color: t.muted, dash: 'dash', width: 1 }, name: '1:1', hoverinfo: 'skip' },
      { x: rows.map(r => r.W), y: F.loo, type: 'scatter', mode: 'markers', name: t_('tr_loo'), marker: { size: 9, color: 'rgba(0,0,0,0)', line: { color: t.amber, width: 1.8 } }, hovertemplate: t_('hv_loo', { a: '%{x:.1f}', b: '%{y:.1f}' }) + '<extra></extra>' },
      { x: rows.map(r => r.W), y: F.pred, type: 'scatter', mode: 'markers', name: t_('tr_fit'), marker: { size: 9, color: t.accent, line: { color: t.surface, width: 1 } }, hovertemplate: t_('hv_fit', { a: '%{x:.1f}', b: '%{y:.1f}' }) + '<extra></extra>' },
    ], A().layout(t, { hovermode: 'closest', xaxis: { title: { text: t_('ax_obs') }, range: [mn, mx] }, yaxis: { title: { text: t_('ax_pred') }, range: [mn, mx] } }));
  }
  function renderTable() {
    let h = `<table><thead><tr><th>${t_('mh_model')}</th><th>${t_('mh_eq')}</th><th class="r">R²</th><th class="r">RMSE (g)</th><th class="r">MAPE</th><th class="r">${t_('mh_loo')}</th><th class="r">${t_('mh_loormse')}</th><th class="r">AIC</th></tr></thead><tbody>`;
    V.fits.forEach(F => {
      const lbl = t_('ml_' + F.m.id);
      if (!F.ok) { h += `<tr><td>${lbl}</td><td colspan="7" class="hint">${t_('cant_fit')}</td></tr>`; return; }
      h += `<tr${active() === F ? ' style="background:var(--accent-soft)"' : ''}><td><b>${lbl}</b>${V.best === F ? ` <span class="tag ok">${t_('rec')}</span>` : ''}${F.m.predictive ? '' : ` <span class="excl">${t_('ctrl')}</span>`}</td><td>${eqText(F)}</td>
        <td class="r">${fmt(F.r2, 3)}</td><td class="r">${fmt(F.rmse, 1)}</td><td class="r">${fmt(F.mape, 1)}%</td><td class="r"><b>${fmt(F.loomape, 1)}%</b></td><td class="r">${fmt(F.loormse, 1)}</td><td class="r">${fmt(F.aic, 1)}</td></tr>`;
    });
    $('#vtable').innerHTML = h + '</tbody></table>';
    const sel = $('#vmodel');
    sel.innerHTML = `<option value="auto">${t_('model_auto', { m: V.best ? (I.lang === 'en' ? ': ' : '：') + V.best.m.name : '' })}</option>` + V.fits.filter(F => F.ok && F.m.predictive).map(F => `<option value="${F.m.id}">${F.m.name} · ${t_('ml_' + F.m.id)}</option>`).join('');
    sel.value = V.modelSel;
  }
  function renderData() {
    let h = `<table><thead><tr><th>#</th><th class="r">${t_('dh_W')}</th><th class="r">${t_('dh_L')}</th><th class="r">${t_('dh_H')}</th><th class="r">${t_('dh_T')}</th><th></th></tr></thead><tbody>`;
    V.data.forEach((r, i) => {
      const cell = k => `<td class="r"><input class="pricein" style="width:76px" id="vd-${k}-${i}" data-i="${i}" data-k="${k}" type="number" step="0.1" value="${isFinite(r[k]) ? r[k] : ''}" aria-label="${k} ${i + 1}"></td>`;
      h += `<tr><td>${i + 1}</td>${cell('W')}${cell('L')}${cell('H')}${cell('T')}<td><button class="btn sm" type="button" data-del="${i}" aria-label="${t_('del_row', { n: i + 1 })}">✕</button></td></tr>`;
    });
    $('#vdata').innerHTML = h + '</tbody></table>';
    $$('#vdata input').forEach(inp => inp.onchange = () => { V.data[+inp.dataset.i][inp.dataset.k] = parseFloat(inp.value); refitAll(); });
    $$('#vdata [data-del]').forEach(b => b.onclick = () => { V.data.splice(+b.dataset.del, 1); renderData(); refitAll(); });
    $('#vn').textContent = t_('data_n', { n: V.rows ? V.rows.length : V.data.length });
  }
  function refitAll() { refit(); renderTable(); const t = A().th(); renderFit(t); renderEstimate(); renderRecs(t); $('#vn').textContent = t_('data_n', { n: V.rows.length }); }

  // ---------- saved measurements ----------
  function loadRecs() { try { const a = JSON.parse(localStorage.getItem(STORE) || '[]'); if (Array.isArray(a)) V.recs = a.filter(r => r && isFinite(r.L) && isFinite(r.H)); } catch (e) { V.recs = []; } }
  function storeRecs() { try { localStorage.setItem(STORE, JSON.stringify(V.recs)); } catch (e) { /* storage unavailable: records stay for this visit */ } }
  const imgLabel = () => V.sample != null ? 'sample:' + (V.sample + 1) : (V.srcName || '—');
  const showImg = s => s && s.startsWith('sample:') ? t_('sample_n', { n: s.slice(7) }) : s;
  function snapshot() {
    const L = parseFloat($('#vL').value), H = parseFloat($('#vH').value), Mz = measured(), m = curMethod();
    const fromImg = V.fromImg && V.meas;
    return {
      L: Math.round(L * 10) / 10, H: Math.round(H * 10) / 10, method: m, img: fromImg ? imgLabel() : '—',
      disp: fromImg && Mz.disp != null ? Math.round(Mz.disp * 10) / 10 : null, Z: fromImg && Mz.Z != null ? Math.round(Mz.Z * 10) / 10 : null,
      s: fromImg && V.match ? Math.round(V.match.s * 100) / 100 : null, t: new Date().toISOString(),
      pts: fromImg ? { len: V.meas.len, hgt: V.meas.hgt, Rl: V.R.len, Rh: V.R.hgt, d: V.match && V.match.d, dy: V.match && V.match.dy, sc: V.match && V.match.s, type: V.type } : null,
    };
  }
  function saveRec(asNew) {
    const snap = snapshot(); if (!(snap.L > 0 && snap.H > 0)) return;
    const rec = !asNew && V.recs.find(r => r.id === V.recId);
    if (rec) { Object.assign(rec, snap); V.flash = t_('rec_updated', { n: rec.id }); }
    else { const id = V.recs.reduce((m, r) => Math.max(m, r.id), 0) + 1; V.recs.push(Object.assign({ id }, snap)); V.recId = id; V.flash = t_('rec_saved', { n: id }); }
    storeRecs(); renderRecs(A().th()); renderEstimate();
  }
  function loadRec(id) {
    const r = V.recs.find(x => x.id === id); if (!r) return;
    V.recId = id;
    if (r.pts && r.img === imgLabel() && r.pts.type === V.type) {
      V.meas = { len: r.pts.len, hgt: r.pts.hgt, mask: null, outline: null, method: r.method };
      V.R = { len: r.pts.Rl || [], hgt: r.pts.Rh || [] }; V.match = r.pts.d != null ? { d: r.pts.d, dy: r.pts.dy, s: r.pts.sc } : null;
      V.hgtManual = r.method === 'manual'; V.fromImg = true; V.candSel = -1; V.msg = { k: 'rec_loaded', v: { n: id } };
      update();
    } else {
      V.fromImg = false; $('#vL').value = r.L; $('#vH').value = r.H;
      V.msg = r.pts ? { k: 'rec_loaded_other', v: { n: id, s: showImg(r.img) } } : { k: 'rec_loaded', v: { n: id } };
      update();
    }
    $('#vest').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function renderRecs(t) {
    const F = active();
    const rows = V.recs.map(r => ({ r, e: estimate(r.L, r.H, F) }));
    if (!rows.length) $('#vrecs').innerHTML = `<div class="empty">${t_('rec_empty')}</div>`;
    else {
      let h = `<table><thead><tr><th>#</th><th>${t_('rh_img')}</th><th>${t_('rh_meth')}</th><th class="r">${t_('dh_L')}</th><th class="r">${t_('dh_H')}</th><th class="r">${t_('rh_W')}</th><th class="r">${t_('rh_pi')}</th><th class="r">${t_('rh_disp')}</th><th class="r">${t_('rh_z')}</th><th>${t_('rh_t')}</th><th></th></tr></thead><tbody>`;
      rows.forEach(({ r, e }) => {
        const tm = new Date(r.t), ts = isFinite(tm) ? tm.toLocaleString(I.locale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
        h += `<tr${r.id === V.recId ? ' style="background:var(--accent-soft)"' : ''}><td>${r.id}</td><td>${esc(showImg(r.img))}</td><td><span class="tag${r.method === 'auto' ? '' : ' n'}">${t_(METH[r.method] || 'meth_input')}</span></td>
          <td class="r"><input class="pricein" style="width:64px" type="number" step="0.1" data-r="${r.id}" data-k="L" value="${r.L}" aria-label="${t_('dh_L')} #${r.id}"></td>
          <td class="r"><input class="pricein" style="width:64px" type="number" step="0.1" data-r="${r.id}" data-k="H" value="${r.H}" aria-label="${t_('dh_H')} #${r.id}"></td>
          <td class="r"><b>${e ? fmt(e.W, 1) : '—'}</b></td><td class="r">${e ? fmt(e.lo, 0) + '–' + fmt(e.hi, 0) : '—'}</td><td class="r">${fmt(r.disp, 1)}</td><td class="r">${fmt(r.Z, 1)}</td><td>${ts}</td>
          <td style="white-space:nowrap"><button class="btn sm" type="button" data-load="${r.id}">${t_('rec_load')}</button> <button class="btn sm" type="button" data-rdel="${r.id}" aria-label="${t_('rec_del', { n: r.id })}">✕</button></td></tr>`;
      });
      $('#vrecs').innerHTML = h + '</tbody></table>';
      $$('#vrecs input[data-r]').forEach(inp => inp.onchange = () => { const r = V.recs.find(x => x.id === +inp.dataset.r), v = parseFloat(inp.value); if (r && v > 0) { r[inp.dataset.k] = Math.round(v * 10) / 10; if (r.method !== 'paste') r.method = 'manual'; storeRecs(); } renderRecs(A().th()); renderEstimate(); });
      $$('#vrecs [data-load]').forEach(b => b.onclick = () => loadRec(+b.dataset.load));
      $$('#vrecs [data-rdel]').forEach(b => b.onclick = () => { const id = +b.dataset.rdel; V.recs = V.recs.filter(x => x.id !== id); if (V.recId === id) V.recId = null; storeRecs(); renderRecs(A().th()); renderEstimate(); });
    }
    $('#vrec-msg').textContent = V.flash || ''; V.flash = null;
    const est = rows.filter(x => x.e).map(x => x.e.W);
    V.batch = est;
    const n = est.length, mean = n ? est.reduce((s, v) => s + v, 0) / n : NaN, sd = n > 1 ? Math.sqrt(est.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : NaN;
    const Nf = window.YaoyiEngine.C.Nfish;
    $('#vbstats').innerHTML = `<div><span>${t_('b_n')}</span><b>${n}</b></div><div><span>${t_('b_mean')}</span><b>${fmt(mean, 1)} g</b></div><div><span>${t_('b_cv')}</span><b>${n > 1 ? fmt(sd / mean * 100, 1) + '%' : '—'}</b></div><div><span>${t_('b_stock', { n: Nf.toLocaleString(I.locale()) })}</span><b>${fmt(mean * Nf / 1000, 0)} kg</b></div>`;
    $('#vuse').disabled = !n;
    $('#vuse').textContent = n ? t_('use_w0', { w: fmt(mean, 1) }) : t_('use_w0_0');
    $('#vexport').disabled = !V.recs.length; $('#vclearrec').disabled = !V.recs.length;
    $('#vclearrec').textContent = V.clearArm ? t_('clear_recs_sure') : t_('clear_recs');
    $('#p-vhist').hidden = !n;
    A().plot('p-vhist', n ? [{ x: est, type: 'histogram', nbinsx: Math.min(14, Math.max(5, Math.round(Math.sqrt(n) * 2))), marker: { color: A().hexA(t.accent, 0.75), line: { color: t.surface, width: 1 } }, hovertemplate: t_('hist_hover', { x: '%{x}', y: '%{y}' }) + '<extra></extra>' }] : [],
      A().layout(t, { showlegend: false, hovermode: 'closest', bargap: 0.06, margin: { t: 14 }, xaxis: { title: { text: t_('ax_estw') } }, yaxis: { title: { text: t_('ax_cnt') } },
        shapes: n ? [{ type: 'line', x0: mean, x1: mean, yref: 'paper', y0: 0, y1: 1, line: { color: t.amber, width: 2, dash: 'dot' } }] : [] }));
  }
  function exportCsv() {
    const F = active(), head = ['id', 'image', 'method', 'length_cm', 'height_cm', 'weight_g', 'pi95_lo_g', 'pi95_hi_g', 'disparity_px', 'distance_cm', 'match_score', 'time'];
    const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [head.join(',')].concat(V.recs.map(r => { const e = estimate(r.L, r.H, F); return [r.id, showImg(r.img), r.method, r.L, r.H, e ? e.W.toFixed(1) : '', e ? e.lo.toFixed(1) : '', e ? e.hi.toFixed(1) : '', r.disp, r.Z, r.s, r.t].map(q).join(','); }));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'yaoyi_measurements.csv'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const parseRows = text => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => l.split(/[\s,，;；\t]+/).map(parseFloat)).filter(a => a.length >= 2 && a.every(isFinite));

  // ---------- images ----------
  function resetMeasure() { V.meas = null; V.R = { len: [], hgt: [] }; V.match = null; V.ref = []; V.roi = null; V.pending = null; V.hgtPick = null; V.hgtManual = false; V.cands = []; V.candSel = -1; V.msg = null; V.msg2 = null; V.recId = null; }
  function loadImage(src, name, cb) {
    const im = new Image();
    im.onload = () => {
      V.gen++; V.img = im; V.imgW = im.naturalWidth; V.imgH = im.naturalHeight; V.srcName = name; resetMeasure();
      const c = document.createElement('canvas'); c.width = V.imgW; c.height = V.imgH;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
      try { V.pix = { d: g.getImageData(0, 0, V.imgW, V.imgH).data, w: V.imgW, h: V.imgH, c: 4 }; V.G = VC.grayFull(V.pix); Jobs.sendImage(); }
      catch (e) { V.pix = null; V.G = null; V.msg = { k: 'auto_pix' }; }
      cb && cb();
    };
    im.onerror = () => { V.msg = { k: 'img_err' }; update(); };
    im.src = src;
  }
  function renderSrc() {
    $('#vsrc').textContent = V.sample != null ? t_('sample_n', { n: V.sample + 1 }) + ' · 2560 × 720' : V.srcName + (V.imgW ? ` · ${V.imgW} × ${V.imgH}` : '');
    $('#vthumbs').innerHTML = SAMPLES.map((s, i) => `<button type="button" class="thumb" data-s="${i}" aria-pressed="${V.sample === i}"><img src="${s.src}" alt=""><span>${t_('sample_n', { n: i + 1 })}</span></button>`).join('');
    $$('#vthumbs .thumb').forEach(b => b.onclick = () => loadSample(+b.dataset.s));
  }
  function loadSample(i) {
    const s = SAMPLES[i];
    V.sample = i;
    loadImage(s.src, '', () => { setType('stereo', true); camForImage(); renderSrc(); setMode('axis'); update(); autoDetect(s.axis); });
  }
  function loadFile(file) {
    const fr = new FileReader();
    fr.onload = () => loadImage(fr.result, file.name, () => {
      V.sample = null; renderSrc();
      setType(V.imgW / V.imgH >= 2.6 ? 'stereo' : 'mono', true); camForImage(); setMode('axis'); update(); autoDetect();
    });
    fr.readAsDataURL(file);
  }

  function bind() {
    if (V.bound) return; V.bound = true;
    refit(); loadRecs(); Jobs.init(); bindCanvas();
    $$('#vtools [data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
    $$('#vtype [data-type]').forEach(b => b.onclick = () => setType(b.dataset.type));
    $$('#vview [data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
    $('#vauto').onclick = () => autoDetect();
    $('#vmatch').onclick = async () => {
      const M = V.meas; if (!M || V.type !== 'stereo') return;
      const m = await Jobs.run('measure', { type: 'match', pts: M.len.concat(M.hgt), mask: M.mask, half: hw() });
      if (m) { V.match = m; syncRight(); V.msg2 = { k: m.s >= 0.6 ? 'match_ok' : 'match_low', v: { d: m.d, s: fmt(m.s, 2) } }; }
      update();
    };
    $('#vclear').onclick = () => { const c = V.cands; resetMeasure(); V.cands = c; V.fromImg = false; setMode('axis'); update(); };
    $('#vcam').onchange = () => { setCam($('#vcam').value); V.fromImg = !!V.meas; update(); };
    ['#vB', '#vf', '#vcx', '#vcy'].forEach(s => $(s).addEventListener('input', () => { $('#vcam').value = 'custom'; V.fromImg = !!V.meas; update(); }));
    ['#vwater'].forEach(s => $(s).addEventListener('change', () => { V.fromImg = !!V.meas; update(); }));
    $('#vscale').addEventListener('input', () => { V.fromImg = !!V.meas; update(); });
    $('#v-mask').onchange = () => draw();
    $('#vfile').onchange = e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; };
    ['#vL', '#vH'].forEach(s => $(s).addEventListener('input', () => { V.fromImg = false; renderEstimate(); }));
    $('#vmodel').onchange = () => { V.modelSel = $('#vmodel').value; renderTable(); const t = A().th(); renderFit(t); renderEstimate(); renderRecs(t); };
    $('#vsave').onclick = () => saveRec(false);
    $('#vsaveas').onclick = () => saveRec(true);
    $('#vexport').onclick = exportCsv;
    $('#vclearrec').onclick = () => {
      if (!V.clearArm) { V.clearArm = true; renderRecs(A().th()); setTimeout(() => { if (V.clearArm) { V.clearArm = false; renderRecs(A().th()); } }, 4000); return; }
      V.clearArm = false; V.recs = []; V.recId = null; storeRecs(); renderRecs(A().th()); renderEstimate();
    };
    $('#vbatch-go').onclick = () => {
      const rows = parseRows($('#vbatch').value).filter(a => a[0] > 0 && a[1] > 0);
      if (!rows.length) { $('#vbatch-msg').textContent = t_('paste_none'); return; }
      let id = V.recs.reduce((m, r) => Math.max(m, r.id), 0); const now = new Date().toISOString();
      rows.forEach(a => V.recs.push({ id: ++id, L: a[0], H: a[1], method: 'paste', img: '—', disp: null, Z: null, s: null, t: now, pts: null }));
      storeRecs(); $('#vbatch').value = ''; $('#vbatch-msg').textContent = t_('paste_batch_ok', { n: rows.length }); renderRecs(A().th()); renderEstimate();
    };
    $('#vbatch-demo').onclick = () => { $('#vbatch').value = USER_DATA.map(r => `${r[1]}, ${r[2]}`).join('\n'); };
    $('#vuse').onclick = () => { if (!V.batch.length) return; const m = V.batch.reduce((s, v) => s + v, 0) / V.batch.length; A().useInitialWeight(Math.round(m * 10) / 10); };
    $('#vrow').onclick = () => { V.data.push({ W: NaN, L: NaN, H: NaN, T: NaN }); renderData(); };
    $('#vreset').onclick = () => { V.data = USER_DATA.map(r => ({ W: r[0], L: r[1], H: r[2], T: r[3] })); renderData(); refitAll(); };
    $('#vpaste-go').onclick = () => {
      const rows = parseRows($('#vpaste').value).filter(a => a.length >= 3);
      if (!rows.length) { $('#vpaste-msg').textContent = t_('paste_none'); return; }
      V.data = rows.map(a => ({ W: a[0], L: a[1], H: a[2], T: a.length > 3 ? a[3] : NaN }));
      $('#vpaste-msg').textContent = t_('paste_ok', { n: rows.length }); renderData(); refitAll();
    };
    window.addEventListener('resize', () => { if (A().tab() === 'vision') draw(); });
    I.on(() => { if (A().tab() === 'vision') render(A().th()); });
    setCam('zed_hd'); renderSrc(); setType('stereo', true);
    loadSample(0);
  }
  function render(t) {
    bind();
    renderSrc(); renderTip(); renderTable(); renderData(); renderFit(t); update(); renderRecs(t);
  }
  window.YaoyiVision = { render, estimate: (L, H) => estimate(L, H), _state: V };
})();
