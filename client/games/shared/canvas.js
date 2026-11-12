/* A drawing surface several people share. Strokes are kept in page units (1600 × 1000) so every
   screen shows the same picture whatever its size. A stroke is { id, by, color, size, erase, fill, points }.
   A fill is a stroke with one point: the area around it, up to the lines, takes its colour. */
'use strict';

const PAGE_W = 1600;
const PAGE_H = 1000;
const COLORS = ['#1b1b1f', '#ffffff', '#8a8a8a', '#e8453c', '#f08a4b', '#ffc93c', '#5cb85c', '#2e8b57', '#3b82f6', '#1e3a8a', '#9b5de5', '#f472b6', '#8b5a2b', '#f5d0a9'];
const COLOR_NAMES = ['Black', 'White', 'Grey', 'Red', 'Orange', 'Yellow', 'Green', 'Dark green', 'Blue', 'Navy', 'Purple', 'Pink', 'Brown', 'Peach'];
const SIZE_NAMES = ['Fine', 'Medium', 'Thick', 'Huge'];
const SIZES = [4, 10, 22, 44];

class SharedCanvas {
  /** onStroke(part) is called as you draw: { id, color, size, erase, points, done }. */
  constructor(canvas, { onStroke, background = '#fffdf7' } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.background = background;
    this.strokes = new Map(); // id -> stroke, in drawing order
    this.color = COLORS[0];
    this.size = SIZES[1];
    this.erase = false;
    this.fill = false;
    this.enabled = true;
    this.onStroke = onStroke;
    this.drawing = null;
    this.pending = [];
    this.filled = new WeakMap(); // fill -> the rows it covered, so a redraw needn't work it out again
    this.fit();
    new ResizeObserver(() => this.fit()).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(ev, (e) => this.up(e));
    canvas.style.touchAction = 'none';
    // Strokes go out in small pieces while you draw, so others see them as they happen.
    setInterval(() => this.flush(false), 60);
  }
  fit() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const scale = Math.min(box.width / PAGE_W, box.height / PAGE_H);
    const w = Math.max(1, Math.floor(PAGE_W * scale));
    const h = Math.max(1, Math.floor(PAGE_H * scale));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.k = (w * dpr) / PAGE_W;
    this.redraw();
  }
  point(e) {
    const r = this.canvas.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * PAGE_W), Math.round(((e.clientY - r.top) / r.height) * PAGE_H)];
  }
  down(e) {
    // One finger (or pen, or mouse) draws at a time: a second finger or a palm doesn't start a stroke of its own.
    if (!this.enabled || this.drawing || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* drawing still works without it */ }
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    if (this.fill && !this.erase) {
      // A fill is done with one tap: it goes out whole, straight away.
      const s = { id, by: null, color: this.color, size: this.size, erase: false, fill: true, points: [this.point(e)] };
      this.strokes.set(id, s);
      this.paint(s);
      this.onStroke?.({ id, color: s.color, size: s.size, erase: false, fill: true, points: s.points.slice(), done: true });
      return;
    }
    this.drawing = { id, by: null, color: this.color, size: this.size, erase: this.erase, points: [this.point(e)] };
    this.strokes.set(id, this.drawing);
    this.pending = [...this.drawing.points];
    this.paint(this.drawing);
  }
  move(e) {
    if (!this.drawing || e.pointerId !== this.pointerId) return;
    // A quick finger moves further than one event a frame: the in-between points keep the line smooth.
    const all = e.getCoalescedEvents?.();
    for (const ev of all?.length ? all : [e]) {
      const p = this.point(ev);
      const last = this.drawing.points[this.drawing.points.length - 1];
      if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 3) continue;
      this.drawing.points.push(p);
      this.pending.push(p);
      this.paintSegment(this.drawing, last, p);
    }
  }
  up(e) {
    if (!this.drawing || (e && e.pointerId !== this.pointerId)) return;
    this.flush(true);
    this.drawing = null;
  }
  flush(done) {
    if (!this.drawing || (!this.pending.length && !done)) return;
    const s = this.drawing;
    if (this.pending.length) this.refillAfter(s.id);
    this.onStroke?.({ id: s.id, color: s.color, size: s.size, erase: s.erase, points: this.pending.splice(0), done });
  }
  /** Someone's piece of a stroke: added to theirs (or a new one). */
  add(part, by) {
    let s = this.strokes.get(part.id);
    if (!s) {
      s = { id: part.id, by, color: String(part.color), size: Number(part.size) || 10, erase: !!part.erase, fill: !!part.fill, points: [] };
      this.strokes.set(part.id, s);
    }
    if (s.fill) {
      if (s.points.length) return; // a fill comes whole, once
      const p = part.points?.[0];
      if (!p) return;
      s.points.push([Number(p[0]) || 0, Number(p[1]) || 0]);
      return this.paint(s);
    }
    const from = s.points[s.points.length - 1];
    if (from) this.refillAfter(s.id);
    for (const p of part.points || []) s.points.push([Number(p[0]) || 0, Number(p[1]) || 0]);
    if (from) this.paintFrom(s, s.points.indexOf(from)); else this.paint(s);
  }
  remove(id) {
    if (!this.strokes.has(id)) return;
    this.refillAfter(id);
    this.strokes.delete(id);
    this.redraw();
  }
  /** A stroke changed: the fills that came after it are worked out again at the next redraw. */
  refillAfter(id) {
    let after = false;
    for (const s of this.strokes.values()) {
      if (after && s.fill) this.filled.delete(s);
      else if (s.id === id) after = true;
    }
  }
  clear() { this.strokes.clear(); this.drawing = null; this.pending = []; this.redraw(); }
  load(strokes) { this.strokes = new Map(strokes.map((s) => [s.id, s])); this.redraw(); }
  all() { return [...this.strokes.values()]; }
  style(s) {
    const c = this.ctx;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = s.size * this.k;
    c.strokeStyle = s.erase ? this.background : s.color;
    c.fillStyle = c.strokeStyle;
  }
  paint(s) {
    if (s.fill) return this.floodFill(s);
    const c = this.ctx;
    this.style(s);
    const [x, y] = s.points[0] || [0, 0];
    if (s.points.length === 1) { c.beginPath(); c.arc(x * this.k, y * this.k, (s.size * this.k) / 2, 0, Math.PI * 2); c.fill(); return; }
    c.beginPath();
    c.moveTo(x * this.k, y * this.k);
    for (const [px, py] of s.points.slice(1)) c.lineTo(px * this.k, py * this.k);
    c.stroke();
  }
  paintFrom(s, i) {
    if (i < 0) return this.paint(s);
    for (let j = i + 1; j < s.points.length; j++) this.paintSegment(s, s.points[j - 1], s.points[j]);
  }
  paintSegment(s, a, b) {
    const c = this.ctx;
    this.style(s);
    c.beginPath();
    c.moveTo(a[0] * this.k, a[1] * this.k);
    c.lineTo(b[0] * this.k, b[1] * this.k);
    c.stroke();
  }
  /** Colours the area around the fill's point that matches the colour under it. Lines are smoothed
      at their edges, so the fill spreads one pixel past where it stops, under the line, to leave no
      pale rim. Worked out on this screen's pixels, so it fits the picture as this screen shows it. */
  floodFill(s) {
    const c = this.ctx;
    c.fillStyle = '#000000';
    c.fillStyle = String(s.color); // a colour the canvas can't read leaves black
    const W = this.canvas.width;
    const H = this.canvas.height;
    let rows = this.filled.get(s);
    if (!rows || rows.W !== W || rows.H !== H) {
      rows = this.fillRows(s, W, H, c.fillStyle);
      this.filled.set(s, rows);
    }
    const r = rows.spans;
    for (let i = 0; i < r.length; i += 3) c.fillRect(r[i + 1], r[i], r[i + 2] - r[i + 1], 1);
  }
  /** The runs of pixels a fill covers on a W × H page: [y, from x, to x (not included), ...]. */
  fillRows(s, W, H, color) {
    const none = { W, H, spans: [] };
    const p = s.points?.[0];
    if (!p) return none;
    const x0 = Math.min(W - 1, Math.max(0, Math.floor((Number(p[0]) || 0) * this.k)));
    const y0 = Math.min(H - 1, Math.max(0, Math.floor((Number(p[1]) || 0) * this.k)));
    const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000';
    const fr = parseInt(hex.slice(1, 3), 16), fg = parseInt(hex.slice(3, 5), 16), fb = parseInt(hex.slice(5, 7), 16);
    const d = this.ctx.getImageData(0, 0, W, H).data;
    const t = (y0 * W + x0) * 4;
    const tr = d[t], tg = d[t + 1], tb = d[t + 2];
    if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 12) return none; // already that colour
    const TOL = 96; // how far (r + g + b) a pixel can be from the one tapped and still be filled
    const near = (j) => Math.abs(d[j] - tr) + Math.abs(d[j + 1] - tg) + Math.abs(d[j + 2] - tb) <= TOL;
    const mask = new Uint8Array(W * H);
    const stack = [x0, y0];
    let minX = x0, maxX = x0, minY = y0, maxY = y0;
    // Line by line: fill a row as far as it goes each way, then look at the rows above and below.
    while (stack.length) {
      const y = stack.pop();
      let x = stack.pop();
      const row = y * W;
      if (mask[row + x]) continue;
      while (x > 0 && !mask[row + x - 1] && near((row + x - 1) * 4)) x--;
      let upOpen = false, downOpen = false;
      for (; x < W && !mask[row + x] && near((row + x) * 4); x++) {
        mask[row + x] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y > 0) {
          const ok = !mask[row - W + x] && near((row - W + x) * 4);
          if (ok && !upOpen) stack.push(x, y - 1);
          upOpen = ok;
        }
        if (y < H - 1) {
          const ok = !mask[row + W + x] && near((row + W + x) * 4);
          if (ok && !downOpen) stack.push(x, y + 1);
          downOpen = ok;
        }
      }
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    minX = Math.max(0, minX - 1); maxX = Math.min(W - 1, maxX + 1);
    minY = Math.max(0, minY - 1); maxY = Math.min(H - 1, maxY + 1);
    const spans = [];
    for (let y = minY; y <= maxY; y++) {
      let from = -1;
      for (let x = minX; x <= maxX + 1; x++) {
        const m = y * W + x;
        // Filled, or right beside a filled pixel (the soft edge of a line).
        const on = x <= maxX && (mask[m] || (x > 0 && mask[m - 1] === 1) || (x < W - 1 && mask[m + 1] === 1) || (y > 0 && mask[m - W] === 1) || (y < H - 1 && mask[m + W] === 1));
        if (on && from < 0) from = x;
        else if (!on && from >= 0) { spans.push(y, from, x); from = -1; }
      }
    }
    return { W, H, spans: Int32Array.from(spans) };
  }
  redraw() {
    const c = this.ctx;
    c.fillStyle = this.background;
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.strokes.values()) this.paint(s);
  }
  /** The picture as a PNG, at full page size. Made straight away (no waiting), so a phone's share
      sheet still counts it as the tap that asked for it. */
  toBlob() {
    const out = document.createElement('canvas');
    out.width = PAGE_W;
    out.height = PAGE_H;
    const keep = { canvas: this.canvas, ctx: this.ctx, k: this.k };
    this.canvas = out; this.ctx = out.getContext('2d'); this.k = 1;
    this.redraw();
    Object.assign(this, keep);
    const bytes = atob(out.toDataURL('image/png').split(',')[1]);
    const buf = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    return new Blob([buf], { type: 'image/png' });
  }
}

/** For the host: whether a player's fill comes too soon after their others. Each fill is worked
    out on every screen, so a stream of them (a stuck button, a changed copy of the game) is dropped. */
const fillTimes = new Map();
function fillTooFast(by) {
  const now = Date.now();
  const t = (fillTimes.get(by) || []).filter((x) => now - x < 2000);
  fillTimes.set(by, t);
  if (t.length >= 8) return true;
  t.push(now);
  return false;
}

/** The colour and size pickers and the eraser, wired to a canvas. */
function drawingTools(box, sc, extra = []) {
  box.innerHTML = '';
  const swatches = el('div', 'swatches');
  swatches.setAttribute('role', 'group');
  swatches.setAttribute('aria-label', 'Colours');
  COLORS.forEach((color, i) => {
    const b = el('button', 'swatch');
    b.type = 'button';
    b.style.background = color;
    b.title = COLOR_NAMES[i];
    b.setAttribute('aria-label', COLOR_NAMES[i]);
    b.onclick = () => { sc.color = color; sc.erase = false; mark(); }; // a colour keeps the fill on: you fill with it
    b.dataset.color = color;
    swatches.append(b);
  });
  const sizes = el('div', 'sizes');
  sizes.setAttribute('role', 'group');
  sizes.setAttribute('aria-label', 'Brush sizes');
  SIZES.forEach((size, i) => {
    const b = el('button', 'size');
    b.type = 'button';
    b.dataset.size = size;
    b.title = SIZE_NAMES[i];
    b.setAttribute('aria-label', `${SIZE_NAMES[i]} brush`);
    b.innerHTML = `<span style="width:${Math.min(26, 4 + size / 2)}px;height:${Math.min(26, 4 + size / 2)}px"></span>`;
    b.onclick = () => { sc.size = size; sc.fill = false; mark(); };
    sizes.append(b);
  });
  const fill = el('button', 'tool', 'Fill');
  fill.type = 'button';
  fill.title = 'Tap an area to fill it with the colour';
  fill.onclick = () => { sc.fill = !sc.fill; sc.erase = false; mark(); };
  const eraser = el('button', 'tool', 'Eraser');
  eraser.type = 'button';
  eraser.onclick = () => { sc.erase = !sc.erase; sc.fill = false; mark(); };
  const row = el('div', 'tool-row');
  row.append(sizes, fill, eraser, ...extra);
  box.append(swatches, row);
  function mark() {
    const on = (b, yes) => { b.classList.toggle('on', yes); b.setAttribute('aria-pressed', String(yes)); };
    swatches.querySelectorAll('.swatch').forEach((b) => on(b, !sc.erase && b.dataset.color === sc.color));
    sizes.querySelectorAll('.size').forEach((b) => on(b, !sc.fill && Number(b.dataset.size) === sc.size));
    on(fill, sc.fill);
    on(eraser, sc.erase);
    sc.canvas.classList.toggle('filling', sc.fill);
  }
  mark();
}
