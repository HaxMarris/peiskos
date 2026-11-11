/* SKETCHPAD: one page everyone at the fire draws on together.
   The host's copy keeps the page; everyone's strokes go to the host, which passes them to the rest
   and gives the whole page to anyone who joins late. Undo takes back your own last stroke; only the
   host can clear the page. */
'use strict';

const MAX_STROKES = 4000;
const BATCH = 12000; // characters of strokes per message (Peiskos takes up to 16 KB)
const mine = []; // ids of your strokes, newest last, for undo
let fullWarned = false;

const sc = new SharedCanvas($('page'), {
  onStroke(part) {
    if (part.points.length) mine.includes(part.id) || mine.push(part.id);
    if (Peiskos.isHost) { relay(Peiskos.me.id, part); saveSoon(); }
    else Peiskos.send(Peiskos.hostId, { type: 'stroke', part });
  },
});

const undo = el('button', 'tool', 'Undo');
undo.type = 'button';
undo.onclick = () => {
  const id = mine.pop();
  if (!id) return;
  sc.remove(id);
  if (Peiskos.isHost) { Peiskos.send('all', { type: 'remove', id }); saveSoon(); } else Peiskos.send(Peiskos.hostId, { type: 'undo', id });
};
const clearBtn = el('button', 'tool', 'Clear page');
clearBtn.type = 'button';
clearBtn.onclick = () => {
  if (!Peiskos.isHost || !confirm('Clear the page for everyone?')) return;
  sc.clear();
  mine.length = 0;
  Peiskos.send('all', { type: 'clear' });
  saveSoon();
};
drawingTools($('tools'), sc, [undo, clearBtn]);

// ---- host

function relay(by, part) {
  if (!part || typeof part.id !== 'string' || !Array.isArray(part.points)) return;
  // A full page takes no new strokes. The host's own stroke comes off its page (everyone else's
  // never reached the others), and the host hears about it once a stroke, not with every piece.
  const own = by === Peiskos.me.id;
  const had = sc.strokes.get(part.id);
  const isNew = own ? had?.by == null : !had; // the host's own is on its page from the first touch, not yet passed on
  if (isNew && sc.strokes.size - (own && had ? 1 : 0) >= MAX_STROKES) {
    if (own) { sc.remove(part.id); sc.drawing = null; } else Peiskos.send(by, { type: 'full', id: part.id });
    if (!fullWarned) { fullWarned = true; showToast('The page is full. Clear it to keep drawing.'); setTimeout(() => { fullWarned = false; }, 4000); }
    return;
  }
  part = { id: part.id.slice(0, 24), color: String(part.color).slice(0, 9), size: Math.min(60, Math.max(1, Number(part.size) || 10)), erase: !!part.erase, points: part.points.slice(0, 400) };
  if (by !== Peiskos.me.id) sc.add(part, by);
  else if (had) had.by = by;
  Peiskos.send('all', { type: 'stroke', by, part });
}
/** The whole page, in pieces small enough to send. */
function sendPage(to) {
  let batch = [];
  let size = 0;
  let first = true;
  const out = () => { Peiskos.send(to, { type: 'page', strokes: batch, first }); first = false; batch = []; size = 0; };
  for (const s of sc.all()) {
    const n = JSON.stringify(s).length;
    if (size + n > BATCH && batch.length) out();
    if (n <= BATCH) { batch.push(s); size += n; }
  }
  out();
}
let saveTimer = 0;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1500);
}
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  Peiskos.snapshot({ strokes: sc.all() });
}
// Popping out (or closing) reloads this page: the last strokes are saved first, not lost.
addEventListener('pagehide', () => { if (Peiskos.isHost && saveTimer) saveNow(); });

Peiskos.on('msg', (from, d) => {
  if (Peiskos.isHost) {
    if (d.type === 'hello') sendPage(from);
    else if (d.type === 'stroke') { relay(from, d.part); saveSoon(); }
    else if (d.type === 'undo') {
      const s = sc.strokes.get(String(d.id));
      if (s && s.by === from) { sc.remove(s.id); Peiskos.send('all', { type: 'remove', id: s.id }); saveSoon(); }
    }
    return;
  }
  if (from !== Peiskos.hostId) return;
  if (d.type === 'stroke' && d.by !== Peiskos.me.id) sc.add(d.part, d.by);
  else if (d.type === 'remove') sc.remove(d.id);
  else if (d.type === 'full') {
    if (sc.drawing?.id === d.id) sc.drawing = null;
    sc.remove(d.id);
    if (!fullWarned) { fullWarned = true; showToast('The page is full. Ask the host to clear it.'); setTimeout(() => { fullWarned = false; }, 4000); }
  }
  else if (d.type === 'clear') { sc.clear(); mine.length = 0; showToast(`${nameOf(Peiskos.hostId)} cleared the page`); }
  else if (d.type === 'page') {
    if (d.first) sc.clear();
    for (const s of d.strokes || []) sc.strokes.set(s.id, s);
    sc.redraw();
  }
});

Peiskos.on('init', (resume) => {
  clearBtn.classList.toggle('hidden', !Peiskos.isHost);
  $('btnLeave').textContent = Peiskos.isHost ? 'End' : 'Leave';
  $('btnLeave').title = Peiskos.isHost ? 'Ends the sketchpad for everyone. Save the picture first if you want it.' : '';
  if (Peiskos.isHost && resume && Array.isArray(resume.strokes)) sc.load(resume.strokes);
  if (!Peiskos.isHost) Peiskos.send(Peiskos.hostId, { type: 'hello' });
  who();
});
Peiskos.on('players', who);
function who() {
  const n = Peiskos.players.length;
  $('who').textContent = `${n} drawing`;
  $('who').title = Peiskos.players.map((p) => p.name).join(', ');
}

$('btnLeave').onclick = () => {
  if (Peiskos.isHost && sc.strokes.size && !confirm('End the sketchpad for everyone? The page goes with it.')) return;
  Peiskos.leave();
};
$('btnSave').onclick = () => Peiskos.save(sc.toBlob(), `sketchpad-${new Date().toISOString().slice(0, 10)}.png`);
