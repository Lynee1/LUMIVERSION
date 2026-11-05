// Yaoyi browser engine — same model as the Pyomo DAE (3-objective "fine" script), solved by
// (1) per-stage LP frontier: min (α·price + β·GWP + γ·EP) per kg feed s.t. nutrient constraints and ASSIM = a
// (2) ODE simulation of growth, intake, stage feed integrals F_k and cost for given stage ASSIM levels
// (3) direct search over the three ASSIM levels.
// Exactness: every objective depends on a stage formulation only through its ASSIM, price, GWP and EP per kg,
// and cost / GWP / EP are Σ_k (per-kg value)_k × F_k with F_k ≥ 0 fixed by the trajectory, so for a fixed
// trajectory the best formulation of each stage is the weighted LP above.
(function (root) {
  const C = {
    Nfish: 5000, START: [2025, 3, 1], // JS month index (April)
    PREMIX_KG: 50, TOTAL_KG: 1000, VARS_KG: 950, DM_MIN: 0.90, CP_TOL: 0.010, STARCH_CAP_AF: 0.15,
    W1: 10, W2: 100, SIGK: 0.15,
    a2: 0.3393, b2: -0.3486, SDA: 0.20, u: 0.150, m: 0.028, g: 0.0196, speed: 5,
    TMAX: 37.0, TOPT: 27.5, Q10: 2.65,
    ENV_WEIGHTS: [0.5, 0.35, 0.15], // profit : GWP : EP for the "profit + environment" strategy
  };
  const FISH_PRICE = { 1: 29.715, 2: 31.115, 3: 31.36, 4: 33.915, 5: 33.915, 6: 35.5915, 7: 38.535, 8: 38.955, 9: 39.97, 10: 38.29, 11: 34.965, 12: 35.49 };
  const STAGES = [
    { name: '<10g', CP_eq: 0.53, EE_min: 0.06, ee_max: 0.12, ME_min: 12.0, lys_min: 0.033, lys_cp: 0.065, p_min: 0.010, p_max: 0.022 },
    { name: '10-100g', CP_eq: 0.50, EE_min: 0.07, ee_max: 0.12, ME_min: 12.5, lys_min: 0.032, lys_cp: 0.065, p_min: 0.010, p_max: 0.022 },
    { name: '>100g', CP_eq: 0.48, EE_min: 0.09, ee_max: 0.12, ME_min: 13.0, lys_min: 0.030, lys_cp: 0.060, p_min: 0.010, p_max: 0.022 },
  ];
  const FEEDX = (() => {
    const l = Math.log(C.Q10), S1 = l * (C.TMAX - C.TOPT), S2 = l * (C.TMAX - C.TOPT + 2.0);
    return (S1 ** 2 * (1 + (1 + 40.0 / S2) ** 0.5) ** 2) / 400.0;
  })();
  const TM = [8.9, 11.1, 15.0, 20.0, 23.3, 26.1, 29.4, 29.4, 25.0, 19.4, 15.0, 10.0];
  const START_MS = Date.UTC(C.START[0], C.START[1], C.START[2]);
  const DAY = 86400000;

  function dateAt(t) { return new Date(START_MS + t * DAY); }
  function airTemp(d) {
    const y = d.getUTCFullYear(), mn = d.getUTCMonth() + 1, dy = d.getUTCDate();
    const nxt = mn === 12 ? 1 : mn + 1;
    const days = Math.round((Date.UTC(y + (mn === 12 ? 1 : 0), nxt - 1, 1) - Date.UTC(y, mn - 1, 1)) / DAY);
    const w = (dy - 1) / Math.max(days - 1, 1);
    return (1 - w) * TM[mn - 1] + w * TM[nxt - 1];
  }
  const BASE_T = []; // water temperature depends only on the calendar day
  function baseTemp(day) {
    if (BASE_T[day] === undefined) BASE_T[day] = Math.max(Math.min(airTemp(dateAt(day)), 32.0), 20.0);
    return BASE_T[day];
  }
  function waterTemp(t, off) { return Math.max(Math.min(baseTemp(Math.floor(t + 1e-9)) + off, 32.0), 10.0); }
  function tauOf(T) { const V = (C.TMAX - T) / (C.TMAX - C.TOPT); return Math.pow(V, FEEDX) * Math.exp(FEEDX * (1 - V)); }
  function fishPrice(t) { return FISH_PRICE[dateAt(t).getUTCMonth() + 1]; }
  function sig(x) { return 0.5 * (Math.tanh(C.SIGK * x / 2) + 1); }
  function blendW(W) { const s10 = sig(W - C.W1), s100 = sig(W - C.W2); return [1 - s10, s10 - s100, s100]; }

  // ---------------- LP per stage ----------------
  function assimDense(i) { return 23.6 * i.CP * i.ADCN + 39.5 * i.EE * i.ADCL; }
  function meAf(i) { return 23.6 * i.CP + 39.5 * i.EE + 17.2 * i.ST; }
  const gwpOf = i => (isFinite(i.GWP) ? i.GWP : 0), epOf = i => (isFinite(i.EP_P) ? i.EP_P : 0);
  const hasLCA = ING => ING.some(i => i.GWP > 0 || i.EP_P > 0);

  function stageModel(ING, k, prices, opt) {
    const s = STAGES[k], wt = opt.w || [1, 0, 0];
    const cons = {
      mass: { equal: C.VARS_KG },
      dm: { min: C.DM_MIN * C.TOTAL_KG - C.PREMIX_KG },
      cp_lo: { min: 0 }, cp_hi: { max: 0 }, ee_lo: { min: 0 }, ee_hi: { max: 0 },
      me_lo: { min: s.ME_min * C.TOTAL_KG }, lys_lo: { min: 0 }, lys_cp: { min: 0 },
      p_lo: { min: 0 }, p_hi: { max: 0 }, st_cap: { max: C.STARCH_CAP_AF * C.TOTAL_KG },
    };
    if (opt.assim != null) cons.assim = { equal: opt.assim * C.TOTAL_KG };
    const vars = {};
    ING.forEach((i, j) => {
      const o = {
        mass: 1, dm: i.DM,
        cp_lo: i.CP - (s.CP_eq - C.CP_TOL) * i.DM, cp_hi: i.CP - (s.CP_eq + C.CP_TOL) * i.DM,
        ee_lo: i.EE - (s.EE_min - 0.005) * i.DM, ee_hi: i.EE - s.ee_max * i.DM,
        me_lo: meAf(i), lys_lo: i.LYS - s.lys_min * i.DM, lys_cp: i.LYS - s.lys_cp * i.CP,
        p_lo: i.P - s.p_min * i.DM, p_hi: i.P - s.p_max * i.DM, st_cap: i.ST,
        assim: assimDense(i), assimObj: assimDense(i),
        cmb: wt[0] * prices[j] + wt[1] * gwpOf(i) + wt[2] * epOf(i),
      };
      o['lb' + j] = 1; o['ub' + j] = 1;
      vars['x' + j] = o;
      cons['lb' + j] = { min: i.lb };
      cons['ub' + j] = { max: i.ub };
    });
    return { optimize: opt.obj, opType: opt.type, constraints: cons, variables: vars };
  }
  function stageValues(ING, prices, x) {
    let a = 0, p = 0, g = 0, e = 0;
    ING.forEach((i, j) => { a += assimDense(i) * x[j]; p += prices[j] * x[j]; g += gwpOf(i) * x[j]; e += epOf(i) * x[j]; });
    return { assim: a / C.TOTAL_KG, price: p / C.TOTAL_KG, gwp: g / C.TOTAL_KG, ep: e / C.TOTAL_KG };
  }
  function solveLP(LP, ING, k, prices, opt) {
    const r = LP.Solve(stageModel(ING, k, prices, opt));
    if (!r.feasible || !isFinite(r.result)) return null;
    const x = ING.map((_, j) => Math.max(0, r['x' + j] || 0));
    if (checkStage(ING, k, x, opt.assim) > 1e-3) return null;
    return Object.assign({ x }, stageValues(ING, prices, x));
  }
  function checkStage(ING, k, x, assim) {
    const s = STAGES[k]; let v = 0;
    const sum = f => ING.reduce((a, i, j) => a + f(i) * x[j], 0);
    const ge = (val, lo) => { v = Math.max(v, lo - val); };
    const le = (val, hi) => { v = Math.max(v, val - hi); };
    ge(sum(() => 1), C.VARS_KG); le(sum(() => 1), C.VARS_KG);
    ge(sum(i => i.DM) + C.PREMIX_KG, C.DM_MIN * C.TOTAL_KG);
    ge(sum(i => i.CP - (s.CP_eq - C.CP_TOL) * i.DM), 0); le(sum(i => i.CP - (s.CP_eq + C.CP_TOL) * i.DM), 0);
    ge(sum(i => i.EE - (s.EE_min - 0.005) * i.DM), 0); le(sum(i => i.EE - s.ee_max * i.DM), 0);
    ge(sum(meAf), s.ME_min * C.TOTAL_KG);
    ge(sum(i => i.LYS - s.lys_min * i.DM), 0); ge(sum(i => i.LYS - s.lys_cp * i.CP), 0);
    ge(sum(i => i.P - s.p_min * i.DM), 0); le(sum(i => i.P - s.p_max * i.DM), 0);
    le(sum(i => i.ST), C.STARCH_CAP_AF * C.TOTAL_KG);
    ING.forEach((i, j) => { ge(x[j], i.lb); le(x[j], i.ub); });
    if (assim != null) { const a = sum(assimDense); v = Math.max(v, Math.abs(a - assim * C.TOTAL_KG)); }
    return v;
  }

  // frontier: weighted per-kg objective as a function of ASSIM on a grid (stores price, GWP, EP of each LP solution)
  function frontier(LP, ING, prices, w, G) {
    const out = [];
    for (let k = 0; k < 3; k++) {
      const lo = solveLP(LP, ING, k, prices, { obj: 'assimObj', type: 'min' });
      const hi = solveLP(LP, ING, k, prices, { obj: 'assimObj', type: 'max' });
      if (!lo || !hi) return { ok: false, stage: k };
      const amin = lo.assim, amax = hi.assim;
      const pm = solveLP(LP, ING, k, prices, { obj: 'cmb', type: 'min', w });
      const pts = [];
      if (pm) pts.push(pm);
      for (let g = 0; g < G; g++) {
        let a = amin + (amax - amin) * g / (G - 1);
        if (g === 0) a = amin + 1e-7 * (amax - amin); if (g === G - 1) a = amax - 1e-7 * (amax - amin);
        const r = solveLP(LP, ING, k, prices, { obj: 'cmb', type: 'min', w, assim: a });
        if (r) { r.assim = a; pts.push(r); }
      }
      pts.sort((u, v) => u.assim - v.assim);
      if (pts.length < 2) return { ok: false, stage: k };
      out.push({ amin: pts[0].assim, amax: pts[pts.length - 1].assim, pts, a0: pm ? pm.assim : pts[0].assim });
    }
    return { ok: true, F: out };
  }
  function interp(f, a) {
    const P = f.pts, last = P.length - 1;
    const pick = p => ({ price: p.price, gwp: p.gwp, ep: p.ep });
    if (a <= P[0].assim) return pick(P[0]); if (a >= P[last].assim) return pick(P[last]);
    let lo = 0, hi = last;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].assim <= a) lo = m; else hi = m; }
    const u = (a - P[lo].assim) / (P[hi].assim - P[lo].assim);
    return { price: P[lo].price + u * (P[hi].price - P[lo].price), gwp: P[lo].gwp + u * (P[hi].gwp - P[lo].gwp), ep: P[lo].ep + u * (P[hi].ep - P[lo].ep) };
  }

  // ---------------- ODE ----------------
  function rhs(t, W, A3, P3, off) {
    const T = waterTemp(t, off), tau = tauOf(T), Wp = W + 1e-8;
    const Cmax = 0.065 * Math.pow(Wp, 0.75) * tau, C3 = 0.03 * W;
    const Cf = 0.5 * (Cmax + C3 - Math.sqrt((Cmax - C3) ** 2 + 1e-6));
    const w = blendW(W);
    const ass = w[0] * A3[0] + w[1] * A3[1] + w[2] * A3[2];
    const ppg = (w[0] * P3[0] + w[1] * P3[1] + w[2] * P3[2]) / 1000;
    const A = Cf * ass, S = C.SDA * A, U = C.u * A, Ef = 5.01 * Math.pow(Wp, 0.046);
    const RA = 13.56 * C.a2 * Math.pow(Wp, C.b2) * Math.exp(C.m * T) * Math.exp(C.g * C.speed) * W * 0.024;
    const dW = (A - S - U - RA) / (Ef + 1e-8);
    return { dW, dF: Cf, dCost: Cf * ppg * C.Nfish, T, tau, Cf, w, ppg };
  }
  // stage values S3[k] = {price, gwp, ep} per kg feed
  function simulate(A3, S3, w0, days, off, dt, record) {
    const P3 = S3.map(s => s.price);
    const n = Math.max(1, Math.ceil(days / dt)), h = days / n;
    let W = w0, F = 0, K = 0, viol = 0; const Fk = [0, 0, 0];
    const tr = record ? { t: [], W: [], F: [], cost: [], intake: [], T: [], tau: [], w: [[], [], []], fp: [], dW: [], gwp: [], ep: [] } : null;
    const envNow = () => S3.reduce((s, v, k) => s + v.gwp * Fk[k] * C.Nfish / 1000, 0);
    const epNow = () => S3.reduce((s, v, k) => s + v.ep * Fk[k] * C.Nfish / 1000, 0);
    const push = (t, r) => {
      if (!tr) return;
      tr.t.push(t); tr.W.push(W); tr.F.push(F); tr.cost.push(K); tr.intake.push(r.Cf); tr.T.push(r.T); tr.tau.push(r.tau);
      tr.w[0].push(r.w[0]); tr.w[1].push(r.w[1]); tr.w[2].push(r.w[2]); tr.fp.push(r.ppg * 1e6); tr.dW.push(r.dW);
      tr.gwp.push(envNow()); tr.ep.push(epNow());
    };
    for (let s = 0; s <= n; s++) {
      const t = s * h;
      const r1 = rhs(t, W, A3, P3, off);
      viol = Math.max(viol, -r1.dW / Math.max(W, 1e-6), (r1.dW - 0.03 * W) / Math.max(W, 1e-6)); // 0 ≤ dW/dt ≤ 0.03 W
      push(t, r1);
      if (s === n) break;
      const r2 = rhs(t + h / 2, W + h / 2 * r1.dW, A3, P3, off);
      const r3 = rhs(t + h / 2, W + h / 2 * r2.dW, A3, P3, off);
      const r4 = rhs(t + h, W + h * r3.dW, A3, P3, off);
      W += h / 6 * (r1.dW + 2 * r2.dW + 2 * r3.dW + r4.dW);
      F += h / 6 * (r1.dF + 2 * r2.dF + 2 * r3.dF + r4.dF);
      K += h / 6 * (r1.dCost + 2 * r2.dCost + 2 * r3.dCost + r4.dCost);
      for (let k = 0; k < 3; k++) Fk[k] += h / 6 * (r1.Cf * r1.w[k] + 2 * r2.Cf * r2.w[k] + 2 * r3.Cf * r3.w[k] + r4.Cf * r4.w[k]);
      if (!(W > 0) || !isFinite(W)) { viol = 1e9; break; }
    }
    const rev = C.Nfish * W / 1000 * fishPrice(days);
    const FkKg = Fk.map(v => v * C.Nfish / 1000);
    const gwp = S3.reduce((s, v, k) => s + v.gwp * FkKg[k], 0), ep = S3.reduce((s, v, k) => s + v.ep * FkKg[k], 0);
    return { WT: W, feed: F, cost: K, revenue: rev, profit: rev - K, gwp, ep, Fk, FkKg, viol, tr };
  }

  // objective for a strategy; ws uses the normalised weighted sum of the 3-objective script
  function objective(sim, spec) {
    let f;
    if (spec.kind === 'profit') f = -sim.profit;
    else if (spec.kind === 'gwp') f = sim.gwp;
    else if (spec.kind === 'ep') f = sim.ep;
    else if (spec.kind === 'ws') { const a = spec.anchors, w = spec.w; f = w[0] * (a.Pmax - sim.profit) / a.dP + w[1] * (sim.gwp - a.Gmin) / a.dG + w[2] * (sim.ep - a.Emin) / a.dE; }
    else f = sim.cost;
    const scale = spec.kind === 'ws' ? 1e3 : 1e6;
    return f + scale * Math.max(0, sim.viol);
  }
  function lpWeights(spec) {
    if (spec.kind === 'gwp') return [0, 1, 0];
    if (spec.kind === 'ep') return [0, 0, 1];
    if (spec.kind === 'ws') { const a = spec.anchors, w = spec.w; return [w[0] / a.dP, w[1] / a.dG, w[2] / a.dE]; }
    return [1, 0, 0];
  }

  // ---------------- outer search ----------------
  function nelderMead(f, x0, step, iters) {
    const n = x0.length; let S = [x0.slice()];
    for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += (x[i] + step > 1 ? -step : step); S.push(x); }
    let V = S.map(f);
    for (let it = 0; it < iters; it++) {
      const idx = V.map((v, i) => i).sort((a, b) => V[a] - V[b]); S = idx.map(i => S[i]); V = idx.map(i => V[i]);
      if (Math.abs(V[n] - V[0]) < 1e-10 * (1 + Math.abs(V[0])) && it > 20) break;
      const cen = new Array(n).fill(0); for (let i = 0; i < n; i++) for (let d = 0; d < n; d++) cen[d] += S[i][d] / n;
      const pt = c => cen.map((v, d) => v + c * (S[n][d] - v));
      const xr = pt(-1), fr = f(xr);
      if (fr < V[0]) { const xe = pt(-2), fe = f(xe); if (fe < fr) { S[n] = xe; V[n] = fe; } else { S[n] = xr; V[n] = fr; } }
      else if (fr < V[n - 1]) { S[n] = xr; V[n] = fr; }
      else {
        const xc = fr < V[n] ? pt(-0.5) : pt(0.5), fc = f(xc);
        if (fc < Math.min(fr, V[n])) { S[n] = xc; V[n] = fc; }
        else { for (let i = 1; i <= n; i++) { S[i] = S[i].map((v, d) => S[0][d] + 0.5 * (v - S[0][d])); V[i] = f(S[i]); } }
      }
    }
    let b = 0; for (let i = 1; i <= n; i++) if (V[i] < V[b]) b = i;
    return { x: S[b], f: V[b] };
  }

  // single-strategy solve. quality: 'full' (final answers) or 'fast' (anchors of a knee scan)
  async function solveSpec(LP, ING, pricesKg, inp, spec, quality, tick) {
    const Q = quality === 'fast' ? { G: 5, starts: 2, nm: 120, pol: 50, dtS: 1, dtP: 0.5 } : { G: 7, starts: 3, nm: 220, pol: 120, dtS: 0.5, dtP: 0.25 };
    const w = lpWeights(spec);
    const FR = frontier(LP, ING, pricesKg, w, quality === 'fast' ? 25 : 41);
    if (!FR.ok) return { ok: false, reason: 'lp', stage: FR.stage };
    const F = FR.F;
    const toA = u => u.map((v, k) => F[k].amin + Math.min(1, Math.max(0, v)) * (F[k].amax - F[k].amin));
    const box = u => u.reduce((s, v) => s + Math.max(0, -v) + Math.max(0, v - 1), 0);
    const evalU = (u, dt) => {
      const A3 = toA(u), S3 = A3.map((a, k) => interp(F[k], a));
      return objective(simulate(A3, S3, inp.w0, inp.days, inp.toff, dt, false), spec) + 1e6 * box(u);
    };
    const exactU = (u, dt) => {
      const A3 = toA(u);
      const sol = A3.map((a, k) => solveLP(LP, ING, k, pricesKg, { obj: 'cmb', type: 'min', w, assim: a }));
      if (sol.some(x => !x)) return { f: 1e12, sol };
      const sm = simulate(sol.map(x => x.assim), sol, inp.w0, inp.days, inp.toff, dt, false);
      return { f: objective(sm, spec) + 1e6 * box(u), sol };
    };
    const clip = u => u.map(v => Math.min(1, Math.max(0, v)));
    const u0 = F.map(f => (f.a0 - f.amin) / Math.max(f.amax - f.amin, 1e-12));
    if (tick) await tick('grid');
    const G = Q.G, cand = [{ u: u0, f: evalU(u0, 1) }];
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) for (let l = 0; l < G; l++) {
      const u = [i / (G - 1), j / (G - 1), l / (G - 1)]; cand.push({ u, f: evalU(u, 1) });
    }
    cand.sort((a, b) => a.f - b.f);
    const starts = cand.slice(0, Q.starts).map(c => c.u); starts.push(u0);
    let best = null;
    for (const s0 of starts) {
      if (tick) await tick('search');
      const r = nelderMead(u => evalU(u, Q.dtS), s0, 0.1, Q.nm);
      if (!best || r.f < best.f) best = r;
    }
    if (tick) await tick('polish');
    const pol = [clip(best.x), u0].map(s0 => nelderMead(u => exactU(u, Q.dtP).f, s0, 0.01, Q.pol));
    pol.sort((a, b) => a.f - b.f);
    const u = clip(pol[0].x);
    const sol = exactU(u, Q.dtP).sol;
    if (sol.some(s => !s)) return { ok: false, reason: 'lp' };
    const sim = simulate(sol.map(s => s.assim), sol, inp.w0, inp.days, inp.toff, quality === 'fast' ? 0.25 : 0.1, quality !== 'fast');
    const feasible = sim.viol <= 1e-4;
    return { ok: feasible, reason: feasible ? null : 'path', sim, sol, spec };
  }

  function anchorsFrom(pts) { // same construction as compute_anchors_3obj
    const P = pts.map(p => p.sim.profit), Gw = pts.map(p => p.sim.gwp), Ep = pts.map(p => p.sim.ep);
    const a = { Pmax: Math.max(...P), Pmin: Math.min(...P), Gmin: Math.min(...Gw), Gmax: Math.max(...Gw), Emin: Math.min(...Ep), Emax: Math.max(...Ep) };
    a.dP = Math.max(a.Pmax - a.Pmin, 1e-9); a.dG = Math.max(a.Gmax - a.Gmin, 1e-9); a.dE = Math.max(a.Emax - a.Emin, 1e-9);
    return a;
  }
  function nondominated(pts) {
    return pts.filter(p => !pts.some(q => q !== p && q.sim.profit >= p.sim.profit - 1e-9 && q.sim.gwp <= p.sim.gwp + 1e-9 && q.sim.ep <= p.sim.ep + 1e-9 &&
      (q.sim.profit > p.sim.profit + 1e-9 || q.sim.gwp < p.sim.gwp - 1e-9 || q.sim.ep < p.sim.ep - 1e-9)));
  }
  function lattice(n) { const out = []; for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) out.push([i / (n - 1), j / (n - 1), (n - 1 - i - j) / (n - 1)]); return out; }

  // public entry. inp.mode: 'cost' | 'profit' | 'env' | 'knee'
  async function optimise(LP, ING, pricesKg, inp, onProgress) {
    const t0 = Date.now();
    let prog = 0.02;
    const tick = async (msg, p) => { if (p != null) prog = p; if (onProgress) { onProgress(prog, msg); await new Promise(r => setTimeout(r, 0)); } };
    await tick('lp', 0.02);
    if ((inp.mode === 'env' || inp.mode === 'knee') && !hasLCA(ING)) return { ok: false, reason: 'nolca' };
    if (inp.mode === 'cost' || inp.mode === 'profit') {
      const r = await solveSpec(LP, ING, pricesKg, inp, { kind: inp.mode }, 'full', m => tick(m, Math.min(0.9, prog + 0.12)));
      return Object.assign(r, { ms: Date.now() - t0 });
    }
    // anchors: profit-max, GWP-min, EP-min
    const anc = [];
    for (const [i, kind] of ['profit', 'gwp', 'ep'].entries()) {
      await tick('anchor', 0.05 + 0.12 * i);
      const r = await solveSpec(LP, ING, pricesKg, inp, { kind }, 'fast', null);
      if (!r.ok) return Object.assign(r, { ms: Date.now() - t0 });
      anc.push(r);
    }
    const anchors = anchorsFrom(anc);
    if (inp.mode === 'env') {
      await tick('ws', 0.45);
      const r = await solveSpec(LP, ING, pricesKg, inp, { kind: 'ws', w: C.ENV_WEIGHTS, anchors }, 'full', m => tick(m, Math.min(0.92, prog + 0.1)));
      return Object.assign(r, { anchors, anchorPts: anc, weights: C.ENV_WEIGHTS, ms: Date.now() - t0 });
    }
    // knee: weighted-sum scan on a simplex lattice, non-dominated filter, minimum normalised distance to the ideal point
    const W = lattice(5), scan = [];
    for (let i = 0; i < W.length; i++) {
      await tick('scan', 0.40 + 0.45 * i / W.length);
      const r = await solveSpec(LP, ING, pricesKg, inp, { kind: 'ws', w: W[i], anchors }, 'fast', null);
      if (r.ok) { r.w = W[i]; scan.push(r); }
    }
    const nd = nondominated(scan.concat(anc.map((p, i) => Object.assign(p, { w: [[1, 0, 0], [0, 1, 0], [0, 0, 1]][i] }))));
    const dist = p => Math.hypot((anchors.Pmax - p.sim.profit) / anchors.dP, (p.sim.gwp - anchors.Gmin) / anchors.dG, (p.sim.ep - anchors.Emin) / anchors.dE);
    const kp = nd.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    await tick('polish', 0.88);
    const r = await solveSpec(LP, ING, pricesKg, inp, { kind: 'ws', w: kp.w, anchors }, 'full', null);
    const cloud = scan.map(p => ({ w: p.w, profit: p.sim.profit, gwp: p.sim.gwp, ep: p.sim.ep, WT: p.sim.WT, cost: p.sim.cost, nd: nd.includes(p) }));
    return Object.assign(r, { anchors, anchorPts: anc, weights: kp.w, kneeDist: dist(r.ok ? r : kp), cloud, ms: Date.now() - t0 });
  }

  const api = { C, STAGES, FISH_PRICE, FEEDX, waterTemp, tauOf, fishPrice, dateAt, blendW, simulate, optimise, solveLP, frontier, checkStage, assimDense, meAf, hasLCA, stageValues };
  if (typeof module !== 'undefined') module.exports = api; else root.YaoyiEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
