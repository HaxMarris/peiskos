/* A drawing surface several people share. Strokes are kept in page units (1600 × 1000) so every
   screen shows the same picture whatever its size. A stroke is { id, by, color, size, erase, points }. */
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
    this.enabled = true;
    this.onStroke = onStroke;
    this.drawing = null;
    this.pending = [];
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

/** The colour and size pickers and the eraser, wired to a canvas. */
function toolbar(box, sc, extra = []) {
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
    b.onclick = () => { sc.color = color; sc.erase = false; mark(); };
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
    b.onclick = () => { sc.size = size; mark(); };
    sizes.append(b);
  });
  const eraser = el('button', 'tool', 'Eraser');
  eraser.type = 'button';
  eraser.onclick = () => { sc.erase = !sc.erase; mark(); };
  const row = el('div', 'tool-row');
  row.append(sizes, eraser, ...extra);
  box.append(swatches, row);
  function mark() {
    const on = (b, yes) => { b.classList.toggle('on', yes); b.setAttribute('aria-pressed', String(yes)); };
    swatches.querySelectorAll('.swatch').forEach((b) => on(b, !sc.erase && b.dataset.color === sc.color));
    sizes.querySelectorAll('.size').forEach((b) => on(b, Number(b.dataset.size) === sc.size));
    on(eraser, sc.erase);
  }
  mark();
}
