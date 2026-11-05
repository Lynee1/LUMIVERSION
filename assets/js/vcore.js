/* Yaoyi — image measurement core (pure functions, no DOM).
 * Mirrors streamlit/vision_core.py step by step so both editions give the same numbers.
 * img = { d: RGB(A) bytes, w, h, c: channels (3 or 4) } — the full side-by-side frame for stereo.
 */
(function (root) {
  'use strict';
  const TL_RANGE = [8, 45], HL_RANGE = [0.18, 0.45], AXIS_BAND = 0.32, AXIS_DECAY = 0.28;

  // ---------- sampling ----------
  function sample(img, X, Y, n) { // bilinear RGB at float coords; X/Y Float64Array length n → {r,g,b}
    const { d, w, h, c } = img, r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = Math.min(Math.max(X[i], 0), w - 1.001), y = Math.min(Math.max(Y[i], 0), h - 1.001);
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const i00 = (y0 * w + x0) * c, i01 = i00 + c, i10 = i00 + w * c, i11 = i10 + c;
      const a = (1 - fx) * (1 - fy), bb = fx * (1 - fy), cc = (1 - fx) * fy, dd = fx * fy;
      r[i] = d[i00] * a + d[i01] * bb + d[i10] * cc + d[i11] * dd;
      g[i] = d[i00 + 1] * a + d[i01 + 1] * bb + d[i10 + 1] * cc + d[i11 + 1] * dd;
      b[i] = d[i00 + 2] * a + d[i01 + 2] * bb + d[i10 + 2] * cc + d[i11 + 2] * dd;
    }
    return { r, g, b };
  }
  function resampleRect(img, x0, y0, rw, rh, w, h) { // pixel-centre bilinear resampling of a rectangle to w × h
    const n = w * h, X = new Float64Array(n), Y = new Float64Array(n), sx = rw / w, sy = rh / h;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { X[j * w + i] = x0 + (i + 0.5) * sx - 0.5; Y[j * w + i] = y0 + (j + 0.5) * sy - 0.5; }
    return sample(img, X, Y, n);
  }
  function grayFull(img) {
    const n = img.w * img.h, out = new Float32Array(n), d = img.d, c = img.c;
    for (let i = 0; i < n; i++) out[i] = 0.299 * d[i * c] + 0.587 * d[i * c + 1] + 0.114 * d[i * c + 2];
    return { d: out, w: img.w, h: img.h };
  }

  // ---------- filters ----------
  function box3n(v, w, h) { // 3×3 mean, 'nearest' borders (scipy uniform_filter size 3)
    const t = new Float32Array(w * h), o = new Float32Array(w * h), cl = (a, n) => a < 0 ? 0 : a >= n ? n - 1 : a;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[y * w + x] = (v[y * w + cl(x - 1, w)] + v[y * w + x] + v[y * w + cl(x + 1, w)]) / 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = (t[cl(y - 1, h) * w + x] + t[y * w + x] + t[cl(y + 1, h) * w + x]) / 3;
    return o;
  }
  const box2 = (v, w, h) => box3n(box3n(v, w, h), w, h);
  const refl = (i, n) => { while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1; return i; };
  function corr1d(v, w, h, k, axis) { // scipy correlate1d, mode 'reflect'; k centred
    const o = new Float32Array(w * h), R = (k.length - 1) / 2;
    if (axis === 0) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let j = -R; j <= R; j++) s += k[j + R] * v[refl(y + j, h) * w + x]; o[y * w + x] = s; } }
    else { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let j = -R; j <= R; j++) s += k[j + R] * v[y * w + refl(x + j, w)]; o[y * w + x] = s; } }
    return o;
  }
  function gauss(v, w, h, sigma) {
    const R = Math.floor(4 * sigma + 0.5), k = []; let s = 0;
    for (let i = -R; i <= R; i++) { const e = Math.exp(-0.5 * i * i / (sigma * sigma)); k.push(e); s += e; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    return corr1d(corr1d(v, w, h, k, 0), w, h, k, 1);
  }
  const sobel0 = (v, w, h) => corr1d(corr1d(v, w, h, [-1, 0, 1], 0), w, h, [1, 2, 1], 1);
  function percentile(v, p) { const a = Float64Array.from(v).sort(), pos = p / 100 * (a.length - 1), i = Math.floor(pos); return i + 1 < a.length ? a[i] + (a[i + 1] - a[i]) * (pos - i) : a[i]; }
  function otsu(v) {
    let mn = Infinity, mx = -Infinity; for (const x of v) { if (x < mn) mn = x; if (x > mx) mx = x; }
    const hist = new Float64Array(256), sc = 255 / Math.max(mx - mn, 1e-9);
    for (const x of v) hist[Math.round((x - mn) * sc)]++;
    const N = v.length; let tot = 0, sq = 0; for (let i = 0; i < 256; i++) { tot += i * hist[i]; sq += i * i * hist[i]; }
    const varT = sq / N - (tot / N) ** 2;
    let wB = 0, sB = 0, best = -1, thr = 0;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; sB += i * hist[i]; const wF = N - wB; if (!wB || !wF) continue;
      const b = wB * wF * (sB / wB - (tot - sB) / wF) ** 2 / (N * N); if (b > best) { best = b; thr = i; }
    }
    return { t: mn + (thr + 0.5) / sc, eta: varT > 0 ? best / varT : 0 };
  }

  // ---------- binary morphology (outside = 0, like scipy border_value=0) ----------
  function erode(m, w, h, it) { let a = m; for (let n = 0; n < (it || 1); n++) { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let q = 1; for (let dy = -1; dy <= 1 && q; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h || !a[yy * w + xx]) { q = 0; break; } } o[y * w + x] = q; } a = o; } return a; }
  function dilate(m, w, h, it) { let a = m; for (let n = 0; n < (it || 1); n++) { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let q = 0; for (let dy = -1; dy <= 1 && !q; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && a[yy * w + xx]) { q = 1; break; } } o[y * w + x] = q; } a = o; } return a; }
  const closeB = (m, w, h) => erode(dilate(m, w, h), w, h);
  const openB = (m, w, h, it) => dilate(erode(m, w, h, it), w, h, it);
  function discOpen(m, w, h, rad) { // opening with a disc of radius rad
    const off = []; for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= rad * rad) off.push(dx, dy);
    const e = new Uint8Array(w * h), o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue; let q = 1;
      for (let k = 0; k < off.length; k += 2) { const xx = x + off[k], yy = y + off[k + 1]; if (xx < 0 || yy < 0 || xx >= w || yy >= h || !m[yy * w + xx]) { q = 0; break; } }
      e[y * w + x] = q;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!e[y * w + x]) continue;
      for (let k = 0; k < off.length; k += 2) { const xx = x + off[k], yy = y + off[k + 1]; if (xx >= 0 && yy >= 0 && xx < w && yy < h) o[yy * w + xx] = 1; }
    }
    return o;
  }
  function label4(m, w, h) { // 4-connected labels in raster order of first pixel; returns {lab, n, size[], box[]}
    const lab = new Int32Array(w * h), size = [0], box = [null], st = []; let n = 0;
    for (let i = 0; i < w * h; i++) {
      if (!m[i] || lab[i]) continue; n++; lab[i] = n; st.push(i); let cnt = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      while (st.length) {
        const p = st.pop(), x = p % w, y = (p / w) | 0; cnt++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = n; st.push(p - 1); } if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = n; st.push(p + 1); }
        if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = n; st.push(p - w); } if (y < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = n; st.push(p + w); }
      }
      size.push(cnt); box.push([x0, y0, x1, y1]);
    }
    return { lab, n, size, box };
  }
  function fillHoles(m, w, h) {
    const out = new Uint8Array(w * h), q = [];
    const seed = i => { if (!m[i] && !out[i]) { out[i] = 1; q.push(i); } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); } for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (q.length) { const p = q.pop(), x = p % w, y = (p / w) | 0; if (x > 0) seed(p - 1); if (x < w - 1) seed(p + 1); if (y > 0) seed(p - w); if (y < h - 1) seed(p + w); }
    const f = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) f[i] = out[i] ? 0 : 1; return f;
  }

  // ---------- box segmentation (auto_measure) ----------
  function autoMeasure(img, roi, seed) {
    let x0 = Math.round(roi[0]), y0 = Math.round(roi[1]), x1 = Math.round(roi[2]), y1 = Math.round(roi[3]);
    [x0, x1] = [Math.max(0, x0), Math.min(img.w, x1)].sort((a, b) => a - b); [y0, y1] = [Math.max(0, y0), Math.min(img.h, y1)].sort((a, b) => a - b);
    const rw = x1 - x0, rh = y1 - y0;
    if (rw < 20 || rh < 12) return { error: 'auto_small' };
    const f = Math.min(1, 380 / Math.max(rw, rh)), w = Math.max(8, Math.round(rw * f)), h = Math.max(8, Math.round(rh * f)), N = w * h;
    const { r, g, b } = resampleRect(img, x0, y0, rw, rh, w, h);
    const gr = new Float32Array(N), rg = new Float32Array(N);
    for (let i = 0; i < N; i++) { gr[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i]; rg[i] = r[i] - g[i]; }
    const cands = [['feat_gray', box2(gr, w, h)], ['feat_rg', box2(rg, w, h)]].map(([k, v]) => ({ k, v, o: otsu(v) }));
    const C = cands[1].o.eta >= 0.45 ? cands[1] : (cands[1].o.eta > cands[0].o.eta ? cands[1] : cands[0]);
    const v = C.v, thr = C.o.t;
    let above = 0, nb = 0; const edge = i => { nb++; if (v[i] > thr) above++; };
    for (let x = 0; x < w; x++) edge(x); for (let x = 0; x < w; x++) edge((h - 1) * w + x); for (let y = 0; y < h; y++) edge(y * w); for (let y = 0; y < h; y++) edge(y * w + w - 1);
    const fgHigh = above / nb < 0.5;
    let m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = (v[i] > thr) === fgHigh ? 1 : 0;
    m = closeB(m, w, h); m = openB(m, w, h); m = openB(m, w, h);
    const L4 = label4(m, w, h); if (!L4.n) return { error: 'auto_none' };
    let pick = 1; for (let k = 2; k <= L4.n; k++) if (L4.size[k] > L4.size[pick]) pick = k;
    if (seed) {
      const sx = Math.round((seed[0] - x0) * f), sy = Math.round((seed[1] - y0) * f);
      if (sx >= 0 && sx < w && sy >= 0 && sy < h && L4.lab[sy * w + sx] > 0) pick = L4.lab[sy * w + sx];
      else {
        const cx = new Float64Array(L4.n + 1), cy = new Float64Array(L4.n + 1);
        for (let i = 0; i < N; i++) { const l = L4.lab[i]; if (l) { cx[l] += i % w; cy[l] += (i / w) | 0; } }
        let bd = Infinity; for (let k = 1; k <= L4.n; k++) { const dd = Math.hypot(cx[k] / L4.size[k] - sx, cy[k] / L4.size[k] - sy) - Math.sqrt(L4.size[k]) * 0.3; if (dd < bd) { bd = dd; pick = k; } }
      }
    }
    if (L4.size[pick] < (seed ? 0.01 : 0.03) * N) return { error: 'auto_none' };
    const one = new Uint8Array(N); for (let i = 0; i < N; i++) one[i] = L4.lab[i] === pick ? 1 : 0;
    const fish = fillHoles(one, w, h);
    let n = 0, mx = 0, my = 0; for (let i = 0; i < N; i++) if (fish[i]) { n++; mx += i % w; my += (i / w) | 0; } mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < N; i++) if (fish[i]) { const dx = i % w - mx, dy = ((i / w) | 0) - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th), vx = -uy, vy = ux;
    let smin = Infinity, smax = -Infinity; const sl = new Map();
    for (let i = 0; i < N; i++) if (fish[i]) {
      const dx = i % w - mx, dy = ((i / w) | 0) - my, s = dx * ux + dy * uy, rr = dx * vx + dy * vy;
      if (s < smin) smin = s; if (s > smax) smax = s;
      const k = Math.round(s), e = sl.get(k); if (e) { if (rr < e[0]) e[0] = rr; if (rr > e[1]) e[1] = rr; } else sl.set(k, [rr, rr]);
    }
    const L = smax - smin, endR = k0 => { const e = sl.get(Math.round(k0)) || [0, 0]; return (e[0] + e[1]) / 2; };
    // body height: open with a disc ~4% of the length to strip thin fins, then take the deepest slice in the middle 70%
    const rad = Math.max(1, Math.round(0.04 * L));
    let body = discOpen(fish, w, h, rad), nbody = 0; for (let i = 0; i < N; i++) nbody += body[i];
    if (nbody < 0.3 * n) body = fish;
    const bsl = new Map();
    for (let i = 0; i < N; i++) if (body[i]) {
      const dx = i % w - mx, dy = ((i / w) | 0) - my, k = Math.round(dx * ux + dy * uy), rr = dx * vx + dy * vy, e = bsl.get(k);
      if (e) { if (rr < e[0]) e[0] = rr; if (rr > e[1]) e[1] = rr; } else bsl.set(k, [rr, rr]);
    }
    let wb = -Infinity, sb = 0, rb = [0, 0];
    Array.from(bsl.keys()).sort((a, b) => a - b).forEach(k => { const u = (k - smin) / L, e = bsl.get(k); const wd = (u >= 0.15 && u <= 0.85) ? e[1] - e[0] : -1; if (wd > wb) { wb = wd; sb = k; rb = e; } });
    const toImg = (X, Y) => [x0 + X / f, y0 + Y / f];
    const ra = endR(smin + 1), rbb = endR(smax - 1);
    return {
      len: [toImg(mx + smin * ux + ra * vx, my + smin * uy + ra * vy), toImg(mx + smax * ux + rbb * vx, my + smax * uy + rbb * vy)],
      hgt: [toImg(mx + sb * ux + rb[0] * vx, my + sb * uy + rb[0] * vy), toImg(mx + sb * ux + rb[1] * vx, my + sb * uy + rb[1] * vy)],
      mask: { fish, w, h, f, x0, y0 }, feat: C.k, eta: C.o.eta, n,
    };
  }

  // ---------- two-click measurement (measure_axis) ----------
  function dpPath(E, n, m, rowOf) { // E accessor rows (distance from axis) × columns; rowOf(i, j) gives E value
    let sc = new Float64Array(n); for (let i = 0; i < n; i++) sc[i] = rowOf(i, 0);
    const bp = new Int32Array(n * m);
    for (let j = 1; j < m; j++) {
      const best = new Float64Array(n).fill(-1e18), arg = new Int32Array(n);
      for (let d = -2; d <= 2; d++) for (let i = 0; i < n; i++) { const s = i + d; if (s < 0 || s >= n) continue; const c = sc[s] - 0.15 * Math.abs(d); if (c > best[i]) { best[i] = c; arg[i] = s; } }
      for (let i = 0; i < n; i++) { best[i] += rowOf(i, j); bp[i * m + j] = arg[i]; }
      sc = best;
    }
    const path = new Int32Array(m); let bi = 0; for (let i = 1; i < n; i++) if (sc[i] > sc[bi]) bi = i; path[m - 1] = bi;
    for (let j = m - 1; j > 0; j--) path[j - 1] = bp[path[j] * m + j];
    return path;
  }
  function median5(h) { const n = h.length, o = new Float64Array(n); for (let i = 0; i < n; i++) { const a = []; for (let k = -2; k <= 2; k++) a.push(h[Math.min(n - 1, Math.max(0, i + k))]); a.sort((x, y) => x - y); o[i] = a[2]; } return o; }
  function measureAxis(img, p0, p1) {
    const [ax, ay] = p0, [bx, by] = p1, Lp = Math.hypot(bx - ax, by - ay);
    if (Lp < 20) return { len: [p0, p1], error: 'axis_short' };
    const ux = (bx - ax) / Lp, uy = (by - ay) / Lp, vx = -uy, vy = ux;
    const ns = Math.trunc(Math.min(360, Math.max(60, Math.round(Lp)))), sc = ns / Lp;
    const nr = Math.round(2 * AXIS_BAND * Lp * sc) | 1, c0 = nr >> 1, N = ns * nr;
    const X = new Float64Array(N), Y = new Float64Array(N);
    for (let i = 0; i < nr; i++) { const r = (i - c0) / sc; for (let j = 0; j < ns; j++) { const s = (j + 0.5) / sc; X[i * ns + j] = ax + s * ux + r * vx; Y[i * ns + j] = ay + s * uy + r * vy; } }
    const P = sample(img, X, Y, N), G = new Float32Array(N), Q = new Float32Array(N);
    for (let i = 0; i < N; i++) { G[i] = P.r[i] * 0.299 + P.g[i] * 0.587 + P.b[i] * 0.114; Q[i] = P.r[i] - P.g[i]; }
    const gy = sobel0(gauss(G, ns, nr, 1.5), ns, nr), qy = sobel0(gauss(Q, ns, nr, 2.5), ns, nr);
    for (let i = 0; i < N; i++) { gy[i] = Math.abs(gy[i]); qy[i] = Math.abs(qy[i]); }
    const pg = percentile(gy, 99) + 1e-9, pq = percentile(qy, 99) + 1e-9, E = new Float32Array(N);
    for (let i = 0; i < nr; i++) { const dw = Math.sqrt(Math.max(0, 1 - Math.abs(i - c0) / ns / AXIS_DECAY)); for (let j = 0; j < ns; j++) { const k = i * ns + j; E[k] = Math.min(gy[k] / pg + 0.5 * qy[k] / pq, 1.5) * dw; } }
    const j0 = Math.trunc(0.08 * ns), j1 = Math.trunc(0.92 * ns), m = j1 - j0, rmin = Math.max(2, Math.trunc(0.03 * ns));
    const nTop = c0 - rmin + 1, nBot = nr - (c0 + rmin);
    const pt = dpPath(E, nTop, m, (i, j) => E[(c0 - rmin - i) * ns + j + j0]), pb = dpPath(E, nBot, m, (i, j) => E[(c0 + rmin + i) * ns + j + j0]);
    const hgt = new Float64Array(m); for (let j = 0; j < m; j++) { pt[j] += rmin; pb[j] += rmin; hgt[j] = pt[j] + pb[j]; }
    const lo = Math.trunc(0.15 * ns) - j0, hi = Math.trunc(0.85 * ns) - j0, hm = median5(hgt);
    let jj = lo; for (let j = lo; j < hi; j++) if (hm[j] > hm[jj]) jj = j;
    const sj = (jj + j0 + 0.5) / sc, toImg = rr => [ax + sj * ux + rr * vx, ay + sj * uy + rr * vy];
    // fish region between the outlines, rasterised image-aligned (for stereo matching and display)
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (let j = 0; j < m; j++) for (let i = c0 - pt[j]; i <= c0 + pb[j]; i++) { const k = i * ns + j + j0; if (X[k] < xmin) xmin = X[k]; if (X[k] > xmax) xmax = X[k]; if (Y[k] < ymin) ymin = Y[k]; if (Y[k] > ymax) ymax = Y[k]; }
    const x0i = Math.floor(xmin), y0i = Math.floor(ymin), x1i = Math.ceil(xmax) + 1, y1i = Math.ceil(ymax) + 1;
    const mf = Math.min(1, 380 / Math.max(x1i - x0i, y1i - y0i, 1)), mw = Math.max(2, Math.round((x1i - x0i) * mf)), mh = Math.max(2, Math.round((y1i - y0i) * mf));
    const fish = new Uint8Array(mw * mh);
    for (let yy = 0; yy < mh; yy++) for (let xx = 0; xx < mw; xx++) {
      const Xm = x0i + (xx + 0.5) / mf - ax, Ym = y0i + (yy + 0.5) / mf - ay;
      const s_ = Math.round((Xm * ux + Ym * uy) * sc - 0.5), r_ = Math.round((Xm * vx + Ym * vy) * sc) + c0, j = s_ - j0;
      if (j >= 0 && j < m && r_ >= c0 - pt[j] && r_ <= c0 + pb[j]) fish[yy * mw + xx] = 1;
    }
    const outline = [];
    for (let j = 0; j < m; j += 4) { const s = (j + j0 + 0.5) / sc; outline.push([ax + s * ux - pt[j] / sc * vx, ay + s * uy - pt[j] / sc * vy]); }
    for (let j = m - 1; j >= 0; j -= 4) { const s = (j + j0 + 0.5) / sc; outline.push([ax + s * ux + pb[j] / sc * vx, ay + s * uy + pb[j] / sc * vy]); }
    return { len: [p0, p1], hgt: [toImg(-pt[jj] / sc), toImg(pb[jj] / sc)], mask: { fish, w: mw, h: mh, f: mf, x0: x0i, y0: y0i }, outline, feat: 'feat_edge' };
  }

  // ---------- stereo correspondence ----------
  function nccSearch(G, P, half, dmin, dmax, dstep, dys) {
    const n = P.length / 2; if (n < 20) return null;
    const W = G.w, H = G.h, pz = new Float64Array(n); let pm = 0;
    for (let i = 0; i < n; i++) pm += G.d[P[2 * i + 1] * W + P[2 * i]]; pm /= n;
    let pn = 0; for (let i = 0; i < n; i++) { pz[i] = G.d[P[2 * i + 1] * W + P[2 * i]] - pm; pn += pz[i] * pz[i]; }
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < n; i++) { const x = P[2 * i], y = P[2 * i + 1]; if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    let best = null;
    for (const dy of dys) {
      if (ymin + dy < 0 || ymax + dy >= H) continue;
      for (let d = dmin; d <= dmax; d += dstep) {
        if (xmin - d + half < half || xmax - d + half >= W) continue;
        let s1 = 0, s2 = 0, sxy = 0;
        for (let i = 0; i < n; i++) { const g = G.d[(P[2 * i + 1] + dy) * W + P[2 * i] - d + half]; s1 += g; s2 += g * g; sxy += pz[i] * g; }
        const vr = s2 - s1 * s1 / n; if (vr <= 1e-6) continue;
        const s = sxy / Math.sqrt(pn * vr); if (!best || s > best.s) best = { d, dy, s };
      }
    }
    return best;
  }
  function matchRight(G, pts, mask, half) {
    if (pts.length < 2) return null;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const padx = (Math.max(...xs) - Math.min(...xs)) * 0.04 + 3, pady = (Math.max(...ys) - Math.min(...ys)) * 0.08 + 3;
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - padx)), x1 = Math.min(half - 1, Math.ceil(Math.max(...xs) + padx));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - pady)), y1 = Math.min(G.h - 1, Math.ceil(Math.max(...ys) + pady));
    const points = (step, useMask) => {
      const P = [];
      for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
        if (useMask) { const mx = Math.round((x - mask.x0) * mask.f), my = Math.round((y - mask.y0) * mask.f); if (!(mx >= 0 && my >= 0 && mx < mask.w && my < mask.h && mask.fish[my * mask.w + mx])) continue; }
        P.push(x, y);
      }
      return P;
    };
    const st = Math.max(2, Math.round(Math.max(x1 - x0, y1 - y0) / 90)), dmax = Math.round(half * 0.85), dys = [];
    for (let d = -18; d <= 18; d += st) dys.push(d);
    const cm = mask ? nccSearch(G, points(st, true), half, 0, dmax, st, dys) : null;
    const cb = nccSearch(G, points(st, false), half, 0, dmax, st, dys);
    const useMask = !!(cm && (!cb || cm.s > cb.s)), c = useMask ? cm : cb;
    if (!c) return null;
    const fdys = []; for (let d = c.dy - st; d <= c.dy + st; d++) fdys.push(d);
    const fine = nccSearch(G, points(1, useMask), half, Math.max(0, c.d - st - 1), c.d + st + 1, 1, fdys);
    return fine || c;
  }
  // metric size from left/right point pairs. cal = { B (mm), f (px, optional), cx, cy }
  function metricSize(lenL, lenR, hgtL, hgtR, half, cal) {
    const B = cal.B, f = cal.f, cx = isFinite(cal.cx) ? cal.cx : half / 2, cy = isFinite(cal.cy) ? cal.cy : cal.h / 2;
    const pair = (Lp, Rp) => {
      if (!Lp || !Rp || Lp.length !== 2 || Rp.length !== 2) return null;
      const d = [0, 1].map(i => Lp[i][0] - (Rp[i][0] - half));
      if (d.some(v => !(v > 0.5))) return null;
      if (B > 0 && f > 0) {
        const P3 = [0, 1].map(i => { const Z = f * B / d[i]; return [(Lp[i][0] - cx) * Z / f, (Lp[i][1] - cy) * Z / f, Z]; });
        return { cm: Math.hypot(P3[0][0] - P3[1][0], P3[0][1] - P3[1][1], P3[0][2] - P3[1][2]) / 10, d: (d[0] + d[1]) / 2, Z: (P3[0][2] + P3[1][2]) / 20 };
      }
      const dm = (d[0] + d[1]) / 2;
      return { cm: B > 0 ? Math.hypot(Lp[0][0] - Lp[1][0], Lp[0][1] - Lp[1][1]) * B / dm / 10 : null, d: dm, Z: null };
    };
    const a = pair(lenL, lenR), b = pair(hgtL, hgtR);
    return { L: a ? a.cm : null, H: b ? b.cm : null, disp: a ? a.d : (b ? b.d : null), Z: a ? a.Z : null };
  }
  const plausible = (L, H) => L == null || H == null || (L >= TL_RANGE[0] && L <= TL_RANGE[1] && H / L >= HL_RANGE[0] && H / L <= HL_RANGE[1]);

  // ---------- automatic candidates ----------
  const iou = (a, b) => { const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), y1 = Math.min(a[3], b[3]); const I = Math.max(0, x1 - x0) * Math.max(0, y1 - y0), U = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - I; return U > 0 ? I / U : 0; };
  function candidateBoxes(img, half, maxN) {
    maxN = maxN || 8;
    const f = 480 / half, W = 480, H = Math.round(img.h * f), N = W * H;
    const { r, g, b } = resampleRect(img, 0, 0, half, img.h, W, H);
    const rg = new Float32Array(N), gr = new Float32Array(N);
    for (let i = 0; i < N; i++) { rg[i] = r[i] - g[i]; gr[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i]; }
    const feats = [[box2(rg, W, H), [1]], [box2(gr, W, H), [1, -1]]], out = [];
    for (const [v, pols] of feats) {
      let mu = 0; for (const x of v) mu += x; mu /= N; let sd = 0; for (const x of v) sd += (x - mu) ** 2; sd = Math.sqrt(sd / N);
      for (const pol of pols) for (let ki = 0; ki < 9; ki++) {
        const k = -0.25 + 0.25 * ki, t = mu + pol * k * sd;
        let m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = (pol > 0 ? v[i] > t : v[i] < t) ? 1 : 0;
        m = openB(closeB(m, W, H), W, H, 2);
        const L4 = label4(m, W, H);
        for (let l = 1; l <= L4.n; l++) {
          const a = L4.size[l], bb = L4.box[l];
          if (a < 0.004 * N || a > 0.15 * N) continue;
          if (bb[0] <= 1 || bb[1] <= 1 || bb[2] >= W - 2 || bb[3] >= H - 2) continue;
          let mx = 0, my = 0; const xs = [], ys = [];
          for (let y = bb[1]; y <= bb[3]; y++) for (let x = bb[0]; x <= bb[2]; x++) if (L4.lab[y * W + x] === l) { xs.push(x); ys.push(y); mx += x; my += y; }
          mx /= a; my /= a;
          let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < a; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
          sxx /= a; syy /= a; sxy /= a;
          const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), root = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2);
          const el = Math.sqrt(((sxx + syy) / 2 + root) / Math.max((sxx + syy) / 2 - root, 1e-9));
          let ang = Math.abs(th * 180 / Math.PI); ang = Math.min(ang, 180 - ang);
          let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
          for (let i = 0; i < a; i++) { const dx = xs[i] - mx, dy = ys[i] - my, u = dx * Math.cos(th) + dy * Math.sin(th), vv = -dx * Math.sin(th) + dy * Math.cos(th); if (u < umin) umin = u; if (u > umax) umax = u; if (vv < vmin) vmin = vv; if (vv > vmax) vmax = vv; }
          const rfill = a / ((umax - umin + 1) * (vmax - vmin + 1));
          if (!(el >= 2 && el <= 6.5 && ang <= 35 && rfill >= 0.5)) continue;
          out.push({ bb: [bb[0] / f, bb[1] / f, (bb[2] + 1) / f, (bb[3] + 1) / f], score: rfill * Math.min(el, 4) / 4 * Math.sqrt(a / N) });
        }
      }
    }
    out.sort((p, q) => q.score - p.score);
    const keep = [];
    for (const c of out) { if (keep.every(k => iou(c.bb, k.bb) < 0.3)) keep.push(c); if (keep.length >= maxN) break; }
    return keep;
  }
  function padBox(bb, w, h, frac) { frac = frac || 0.12; const pw = (bb[2] - bb[0]) * frac + 6, ph = (bb[3] - bb[1]) * frac * 2 + 6; return [Math.max(0, bb[0] - pw), Math.max(0, bb[1] - ph), Math.min(w - 1, bb[2] + pw), Math.min(h - 1, bb[3] + ph)]; }
  function shiftPts(pts, m, half) { return pts.map(p => [p[0] - m.d + half, p[1] + m.dy]); }
  function autoPick(img, G, half, cal, stereo, nTry) {
    const res = [];
    for (const c of candidateBoxes(img, half).slice(0, nTry || 6)) {
      const roi = padBox(c.bb, half, img.h), meas = autoMeasure(img, roi);
      if (meas.error) continue;
      const mt = stereo ? matchRight(G, meas.len.concat(meas.hgt), meas.mask, half) : null;
      const size = mt ? metricSize(meas.len, shiftPts(meas.len, mt, half), meas.hgt, shiftPts(meas.hgt, mt, half), half, cal) : null;
      const ok = plausible(size ? size.L : null, size ? size.H : null);
      res.push({ roi, meas, match: mt, size, ok, q: c.score * (mt ? Math.max(mt.s, 0) : 0.5) * (ok ? 1 : 0.05) });
    }
    res.sort((a, b) => b.q - a.q);
    return res;
  }

  const api = { TL_RANGE, HL_RANGE, grayFull, otsu, autoMeasure, measureAxis, matchRight, metricSize, plausible, candidateBoxes, padBox, autoPick, shiftPts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.YaoyiVCore = api;
})(typeof self !== 'undefined' ? self : this);
