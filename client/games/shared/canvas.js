/* A drawing surface several people share. Strokes are kept in page units (1600 × 1000) so every
   screen shows the same picture whatever its size. A stroke is { id, by, color, size, erase, points }. */
'use strict';

const PAGE_W = 1600;
const PAGE_H = 1000;
const COLORS = ['#1b1b1f', '#ffffff', '#8a8a8a', '#e8453c', '#f08a4b', '#ffc93c', '#5cb85c', '#2e8b57', '#3b82f6', '#1e3a8a', '#9b5de5', '#f472b6', '#8b5a2b', '#f5d0a9'];
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
    this.enabled = true;
    this.onStroke = onStroke;
    this.drawing = null;
    this.pending = [];
    this.fit();
    new ResizeObserver(() => this.fit()).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(ev, (e) => this.up(e));
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
    // One finger draws: a second one landing doesn't take the stroke over.
    if (!this.enabled || this.drawing || (e.button !== undefined && e.button > 0)) return;
    this.finger = e.pointerId;
    this.canvas.setPointerCapture?.(e.pointerId);
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    this.drawing = { id, by: null, color: this.color, size: this.size, erase: this.erase, points: [this.point(e)] };
    this.strokes.set(id, this.drawing);
    this.pending = [...this.drawing.points];
    this.paint(this.drawing);
  }
  move(e) {
    if (!this.drawing || (e.pointerId !== undefined && e.pointerId !== this.finger)) return;
    const p = this.point(e);
    const last = this.drawing.points[this.drawing.points.length - 1];
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 3) return;
    this.drawing.points.push(p);
    this.pending.push(p);
    this.paintSegment(this.drawing, last, p);
  }
  up(e) {
    if (!this.drawing || (e?.pointerId !== undefined && e.pointerId !== this.finger)) return;
    this.flush(true);
    this.drawing = null;
  }
  flush(done) {
    if (!this.drawing || (!this.pending.length && !done)) return;
    const s = this.drawing;
    this.onStroke?.({ id: s.id, color: s.color, size: s.size, erase: s.erase, points: this.pending.splice(0), done });
  }
  /** Someone's piece of a stroke: added to theirs (or a new one). */
  add(part, by) {
    let s = this.strokes.get(part.id);
    if (!s) {
      s = { id: part.id, by, color: String(part.color), size: Number(part.size) || 10, erase: !!part.erase, points: [] };
      this.strokes.set(part.id, s);
    }
    const from = s.points[s.points.length - 1];
    for (const p of part.points || []) s.points.push([Number(p[0]) || 0, Number(p[1]) || 0]);
    if (from) this.paintFrom(s, s.points.indexOf(from)); else this.paint(s);
  }
  remove(id) { if (this.strokes.delete(id)) this.redraw(); }
  clear() { this.strokes.clear(); this.drawing = null; this.redraw(); }
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
  redraw() {
    const c = this.ctx;
    c.fillStyle = this.background;
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.strokes.values()) this.paint(s);
  }
  /** The picture as a PNG file, at full page size. */
  toBlob() {
    const out = document.createElement('canvas');
    out.width = PAGE_W;
    out.height = PAGE_H;
    const keep = { canvas: this.canvas, ctx: this.ctx, k: this.k };
    this.canvas = out; this.ctx = out.getContext('2d'); this.k = 1;
    this.redraw();
    Object.assign(this, keep);
    return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  }
}

/** The colour and size pickers and the eraser, wired to a canvas. */
function toolbar(box, sc, extra = []) {
  box.innerHTML = '';
  const swatches = el('div', 'swatches');
  for (const color of COLORS) {
    const b = el('button', 'swatch');
    b.type = 'button';
    b.style.background = color;
    b.title = color;
    b.setAttribute('aria-label', `Colour ${color}`);
    b.onclick = () => { sc.color = color; sc.erase = false; mark(); };
    b.dataset.color = color;
    swatches.append(b);
  }
  const sizes = el('div', 'sizes');
  for (const size of SIZES) {
    const b = el('button', 'size');
    b.type = 'button';
    b.dataset.size = size;
    b.setAttribute('aria-label', `Brush size ${size}`);
    b.innerHTML = `<span style="width:${Math.min(26, 4 + size / 2)}px;height:${Math.min(26, 4 + size / 2)}px"></span>`;
    b.onclick = () => { sc.size = size; mark(); };
    sizes.append(b);
  }
  const eraser = el('button', 'tool', 'Eraser');
  eraser.type = 'button';
  eraser.onclick = () => { sc.erase = !sc.erase; mark(); };
  box.append(swatches, sizes, eraser, ...extra);
  function mark() {
    swatches.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('on', !sc.erase && b.dataset.color === sc.color));
    sizes.querySelectorAll('.size').forEach((b) => b.classList.toggle('on', Number(b.dataset.size) === sc.size));
    eraser.classList.toggle('on', sc.erase);
  }
  mark();
}
