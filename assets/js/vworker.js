/* Yaoyi — background worker for image measurement (keeps the page responsive). */
importScripts('vcore.js');
const VC = self.YaoyiVCore;
let img = null, G = null;
function withMatch(meas, m) {
  return { meas, match: !meas.error && m.stereo ? VC.matchRight(G, meas.len.concat(meas.hgt || []), meas.mask, m.half) : null };
}
self.onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'img') { img = { d: m.d, w: m.w, h: m.h, c: 4 }; G = VC.grayFull(img); self.postMessage({ id: m.id, r: true }); return; }
    let r = null;
    if (m.type === 'pick') r = VC.autoPick(img, G, m.half, m.cal, m.stereo);
    else if (m.type === 'axis') r = withMatch(VC.measureAxis(img, m.p0, m.p1), m);
    else if (m.type === 'roi') r = withMatch(VC.autoMeasure(img, m.roi, m.seed), m);
    else if (m.type === 'match') r = VC.matchRight(G, m.pts, m.mask, m.half);
    self.postMessage({ id: m.id, r });
  } catch (err) { self.postMessage({ id: m.id, err: String(err && err.message || err) }); }
};
