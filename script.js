// script.js
const els = {
  bgPending: document.getElementById("bgPending"),
  bgPendingHex: document.getElementById("bgPendingHex"),
  bgAppliedHex: document.getElementById("bgHex"),
  confirmBg: document.getElementById("confirmBg"),
  lightness: document.getElementById("lightness"),
  lightnessVal: document.getElementById("lightnessVal"),
  wheel: document.getElementById("wheel"),
  bgSwatch: document.getElementById("bgSwatch"),
  fgSwatch: document.getElementById("fgSwatch"),
  fgHex: document.getElementById("fgHex"),
  cr: document.getElementById("cr"),
  t3: document.getElementById("t3"),
  t45: document.getElementById("t45"),
  t7: document.getElementById("t7"),
};

const ctx = els.wheel.getContext("2d", { willReadFrequently: true });

/** Set isolines to any values (>1) you want */
const ISOLINES = [3.0, 4.5, 7.0];

// Selection state: store canvas coords so we can draw a selector circle
let selected = {
  x: els.wheel.width / 2,
  y: els.wheel.height / 2,
  rgb: { r: 255, g: 255, b: 255 },
};

let baseImageData = null; // stores wheel pixels WITHOUT isolines/labels/selector

let isDragging = false;

let appliedBgHex = "#fafafa"; // only this triggers recomputation

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  const to2 = (x) => x.toString(16).padStart(2, "0");
  return "#" + to2(r) + to2(g) + to2(b);
}

function srgb8ToLinear(c8) {
  const cs = c8 / 255;
  return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb) {
  const R = srgb8ToLinear(rgb.r);
  const G = srgb8ToLinear(rgb.g);
  const B = srgb8ToLinear(rgb.b);
  const linRegrVars = [0.2126, 0.7152, 0.0722];
  return linRegrVars[0] * R + linRegrVars[1] * G + linRegrVars[2] * B;
}

function contrastRatio(rgb1, rgb2) {
  const L1 = relativeLuminance(rgb1);
  const L2 = relativeLuminance(rgb2);
  const Lmax = Math.max(L1, L2);
  const Lmin = Math.min(L1, L2);
  return (Lmax + 0.05) / (Lmin + 0.05);
}

// HSL -> sRGB (0..360, 0..1, 0..1)
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0,
    g1 = 0,
    b1 = 0;

  if (0 <= hp && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (1 <= hp && hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (2 <= hp && hp < 3) [r1, g1, b1] = [0, c, x];
  else if (3 <= hp && hp < 4) [r1, g1, b1] = [0, x, c];
  else if (4 <= hp && hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function setBadge(el, ok) {
  el.textContent = ok ? "PASS" : "FAIL";
  el.style.background = ok ? "rgba(0, 200, 0, 0.12)" : "rgba(200, 0, 0, 0.12)";
}

function updateReadout(bgRgb, fgRgb) {
  const cr = contrastRatio(bgRgb, fgRgb);
  const fgHex = rgbToHex(fgRgb).toLowerCase();

  els.fgHex.textContent = fgHex;
  els.fgSwatch.style.background = fgHex;
  els.cr.textContent = cr.toFixed(2) + " : 1";

  setBadge(els.t3, cr >= 3.0);
  setBadge(els.t45, cr >= 4.5);
  setBadge(els.t7, cr >= 7.0);

  const pvSans = document.getElementById("previewSans");
  const pvSerif = document.getElementById("previewSerif");

  pvSans.style.background = appliedBgHex;
  pvSerif.style.background = appliedBgHex;

  pvSans.style.color = fgHex;
  pvSerif.style.color = fgHex;
}

function isolineStrength(T) {
  const t = Math.min(12, Math.max(2, T));
  // return 0.22 + (t - 2) * (0.85 - 0.22) / (12 - 2);
  return 1;
}

function canvasPointFromEvent(evt) {
  const rect = els.wheel.getBoundingClientRect();
  const scaleX = els.wheel.width / rect.width;
  const scaleY = els.wheel.height / rect.height;
  const clientX = evt.clientX ?? (evt.touches && evt.touches[0]?.clientX);
  const clientY = evt.clientY ?? (evt.touches && evt.touches[0]?.clientY);
  return {
    x: Math.floor((clientX - rect.left) * scaleX),
    y: Math.floor((clientY - rect.top) * scaleY),
  };
}

function clampToWheel(x, y, cx, cy, R) {
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  const dist = Math.hypot(dx, dy);
  if (dist <= R) return { x, y, inside: true };

  const k = R / dist;
  const nx = Math.floor(cx + dx * k);
  const ny = Math.floor(cy + dy * k);
  return { x: nx, y: ny, inside: false };
}

function drawSelectorCircle(x, y) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + 0.5, y + 0.5, 5, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0, 0, 0, 1)";
  ctx.stroke();

  ctx.restore();
}

function drawWheel() {
  const bgRgb = hexToRgb(appliedBgHex);
  const l = parseFloat(els.lightness.value) / 100;

  // els.bgHex.textContent = appliedBgHex.toLowerCase();
  els.bgAppliedHex.textContent = appliedBgHex.toLowerCase();

  els.lightnessVal.textContent = String(Math.round(l * 100));
  // els.bgSwatch.style.background = appliedBgHex;
  els.bgSwatch.style.background = appliedBgHex;


  const w = els.wheel.width;
  const h = els.wheel.height;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) / 2 - 2;

  const crField = new Float32Array(w * h);

  // Base wheel
  const img = ctx.createImageData(w, h);
  const data = img.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);

      const idx1 = y * w + x;
      const idx4 = 4 * idx1;

      if (dist > R) {
        data[idx4 + 3] = 0;
        crField[idx1] = NaN;
        continue;
      }

      const sat = clamp01(dist / R);
      let ang = Math.atan2(dy, dx);
      let hue = (ang * 180) / Math.PI;
      hue = (hue + 360) % 360;

      const fgRgb = hslToRgb(hue, sat, l);
      const cr = contrastRatio(bgRgb, fgRgb);
      crField[idx1] = cr;

      // Hide colors that fail all WCAG levels (cr < 3): paint as background
      if (cr < 3.0) {
        data[idx4 + 0] = bgRgb.r;
        data[idx4 + 1] = bgRgb.g;
        data[idx4 + 2] = bgRgb.b;
        data[idx4 + 3] = 255;
      } else {
        data[idx4 + 0] = fgRgb.r;
        data[idx4 + 1] = fgRgb.g;
        data[idx4 + 2] = fgRgb.b;
        data[idx4 + 3] = 255;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  baseImageData = img; // this is the wheel-only image data

  // Isoline overlay
  const overlay = ctx.getImageData(0, 0, w, h);
  const od = overlay.data;

  function darkenPixel(x, y, strength) {
    const i = 4 * (y * w + x);
    od[i + 0] = Math.round(od[i + 0] * (1 - strength));
    od[i + 1] = Math.round(od[i + 1] * (1 - strength));
    od[i + 2] = Math.round(od[i + 2] * (1 - strength));
  }

  const labelPos = new Map();
  const levels = [...ISOLINES]
    .filter((v) => Number.isFinite(v) && v > 1)
    .sort((a, b) => a - b);

  for (let y = 1; y < h - 2; y++) {
    for (let x = 1; x < w - 2; x++) {
      const i = y * w + x;
      const a = crField[i];
      if (!Number.isFinite(a)) continue;

      const b = crField[i + 1];
      const c = crField[i + w];
      if (!Number.isFinite(b) || !Number.isFinite(c)) continue;

      for (const T of levels) {
        const ab = a >= T !== b >= T;
        const ac = a >= T !== c >= T;

        if (ab || ac) {
          darkenPixel(x, y, isolineStrength(T));

          if (!labelPos.has(T)) {
            const dx = x + 0.5 - cx;
            const dy = y + 0.5 - cy;
            const dist = Math.hypot(dx, dy);
            if (dist < R * 0.92 && dist > R * 0.25) labelPos.set(T, { x, y });
          }
        }
      }
    }
  }

  ctx.putImageData(overlay, 0, 0);
  baseImageData = img;

  // Labels
  ctx.save();
  ctx.font =
    "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "middle";

  for (const T of levels) {
    const p = labelPos.get(T);
    if (!p) continue;

    const text = (Math.round(T * 10) / 10).toString();
    const padX = 4,
      boxH = 16;
    const metrics = ctx.measureText(text);
    const boxW = Math.ceil(metrics.width) + padX * 2;

    const bx = p.x + 8;
    const by = p.y;

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(bx, by - boxH / 2, boxW, boxH);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.strokeRect(bx, by - boxH / 2, boxW, boxH);
    ctx.fillStyle = "rgba(0,0,0,0.9)";
    ctx.fillText(text, bx + padX, by);
  }
  ctx.restore();

  // Update selection RGB from stored coords (clamped to wheel)
  const clamped = clampToWheel(selected.x, selected.y, cx, cy, R);
  selected.x = clamped.x;
  selected.y = clamped.y;

  const px = sampleBasePixel(selected.x, selected.y);
  if (px.a !== 0) {
    selected.rgb = { r: px.r, g: px.g, b: px.b };
    updateReadout(bgRgb, selected.rgb);
  }

  // Draw selector circle last
  drawSelectorCircle(selected.x, selected.y);
}

function sampleBasePixel(x, y) {
  if (!baseImageData) return { r: 0, g: 0, b: 0, a: 0 };
  const w = baseImageData.width;
  const h = baseImageData.height;
  if (x < 0 || y < 0 || x >= w || y >= h) return { r: 0, g: 0, b: 0, a: 0 };
  const i = 4 * (y * w + x);
  const d = baseImageData.data;
  return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
}

function setSelectionFromEvent(evt) {
  const w = els.wheel.width;
  const h = els.wheel.height;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) / 2 - 2;

  const p = canvasPointFromEvent(evt);
  const q = clampToWheel(p.x, p.y, cx, cy, R);
  selected.x = q.x;
  selected.y = q.y;
  drawWheel();
}

// els.bg.addEventListener("input", drawWheel);

// Pending picker changes: no recomputation
els.bgPending.addEventListener("input", () => {
  const hex = els.bgPending.value.toLowerCase();
  els.bgPendingHex.textContent = hex;
});

// Confirm: apply + recompute
els.confirmBg.addEventListener("click", () => {
  appliedBgHex = els.bgPending.value.toLowerCase();
  drawWheel();
});

els.lightness.addEventListener("input", drawWheel);

els.wheel.addEventListener("pointerdown", (e) => {
  isDragging = true;
  els.wheel.setPointerCapture(e.pointerId);
  setSelectionFromEvent(e);
});

els.wheel.addEventListener("pointermove", (e) => {
  if (!isDragging) return;
  setSelectionFromEvent(e);
});

els.wheel.addEventListener("pointerup", (e) => {
  isDragging = false;
  try {
    els.wheel.releasePointerCapture(e.pointerId);
  } catch {}
});

els.wheel.addEventListener("pointercancel", () => {
  isDragging = false;
});

(function init() {
  appliedBgHex = els.bgPending.value.toLowerCase();
  els.bgPendingHex.textContent = appliedBgHex;
  els.bgAppliedHex.textContent = appliedBgHex;
  els.fgSwatch.style.background = "#fafafa";
  drawWheel();
})();

