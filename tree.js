// Рюриковичи — the observatory view.
//
// treeengine.js decides where every visible person goes; this file paints
// them and drives the camera. Names and wires are plain DOM/SVG rebuilt on
// every layout change — a fully open tree is about a thousand rows, which is
// well inside what one rebuild can afford, as long as each row carries only
// what is genuinely its own. Colour is not: it goes out as classes, and
// treestyle.css turns them into paint.

import * as eng from './treeengine.js';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
  'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII', 'XXIV'];

// Twenty is both the longest run the picker offers and what shift-click opens,
// and no branch of the dynasty is deeper than that.
const MAX_GENS = 20;

const generations = (n) => {
  const ten = n % 10, hundred = n % 100;
  if (ten === 1 && hundred !== 11) return 'КОЛЕНО';
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'КОЛЕНА';
  return 'КОЛЕН';
};

// Long enough that reading down a column of names never sets it off, short
// enough that resting on one asks a question and gets an answer.
const TIP_DELAY = 850;

// A finger is not a pointer resting on something. It lands on whoever happens
// to be under it on its way to dragging the canvas, and it is gone again the
// moment the tap ends — so it asks no question about that person, and nothing
// lights up or offers dates in answer. A pen hovers like a mouse and counts as
// one.
const hovers = (e) => e.pointerType !== 'touch';

// The margin the tree keeps from the left of the screen — both when a click
// brings an opening into view and when a swipe settles on a generation, so the
// two agree on where "at the left edge" is.
const EDGE = 24;
// Long enough to read as coming to rest, short enough not to be a journey.
const SNAP_MS = 200;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ENT[c]);

class Observatory {
  constructor() {
    this.stage = document.getElementById('stage');
    this.camEl = document.getElementById('cam');
    this.bandsSvg = document.getElementById('bands');
    this.bandRects = document.getElementById('band-rects');
    this.grad = document.getElementById('bandFade');
    this.wires = document.getElementById('wires');
    this.cards = document.getElementById('cards');
    this.ruler = document.getElementById('ruler');
    this.zoomLabel = document.getElementById('zoom');
    this.themeBtn = document.getElementById('btn-theme');
    this.toolbar = document.getElementById('toolbar');
    this.hintPanel = document.getElementById('hint');
    this.gensCtl = document.getElementById('gens-ctl');
    this.narrow = window.matchMedia('(max-width: 760px)');
    this.tip = document.getElementById('tip');
    this.shownN = document.getElementById('shown-n');
    this.shownAll = document.getElementById('shown-all');
    this.tipName = document.getElementById('tip-name');
    this.tipMeta = document.getElementById('tip-meta');

    this.state = { nodes: [], links: [], bands: [], ticks: [], colX: [], width: 0, height: 0 };
    this.cam = { x: 120, y: 120, s: 1 };
    this.ROW_BASE = 21;
    this.ROW_MIN = 16;
    this.opts = {
      rowH: 21, gapX: 50, padX: 8, famGap: 1.35, captionH: 10,
      // Every face here is one a card is really drawn in, and the sizes and
      // weights match treestyle.css exactly. That is the whole point: a name
      // measured at 500 and drawn at 600 comes out wider than the column it
      // was measured into. `badgePad` is the flex gap before the badge plus
      // the badge's own padding — everything it costs except its digits.
      badgePad: 14,
      font: '500 12px Helvetica, Arial, sans-serif',
      mainFont: '600 12px Helvetica, Arial, sans-serif',
      captionFont: '400 9px Helvetica, Arial, sans-serif',
      badgeFont: '500 10px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    };
    this.hi = [];
    this.shown = new Map();
    this.gens = 2;
    this.gensBtn = document.getElementById('gens');
    this.gensVal = document.getElementById('gens-val');
    this.gensList = document.getElementById('gens-list');
    this.gensWrap = document.querySelector('.gens-wrap');
    this.gensWord = document.getElementById('gens-word');
    this.themeName = 'light';
  }

  async start() {
    this.root = await eng.loadTree('tree.json');
    this.root.open = true;
    this.root.kids.forEach((k) => eng.expandDepth(k, 4));
    // The main dynastic line stays lit at all times: Рюрик → … → Иван IV Грозный.
    const ivan = eng.findByName(this.root, 'Иван IV Грозный');
    this.mainLine = new Set(ivan ? eng.lineage(ivan) : []);
    // The layout has to know who is on it too, to measure them at their weight.
    this.opts.main = this.mainLine;

    // The badge is drawn in the downloaded mono and its width decides how wide
    // the column has to be, so that one face must be here before the first
    // layout. That one, asked for by name — not `fonts.ready`, which is every
    // face on the page. index.html preloads it, so it is usually here already.
    if (document.fonts && document.fonts.load) {
      try { await document.fonts.load('500 10px "JetBrains Mono"'); } catch (e) {}
    }

    let saved = null;
    try { saved = localStorage.getItem('rurik-theme'); } catch (e) {}
    if (saved === 'light' || saved === 'dark') this.themeName = saved;
    let savedGens = null;
    try { savedGens = parseInt(localStorage.getItem('rurik-gens'), 10); } catch (e) {}
    this.buildGens(savedGens);
    this.applyTheme();
    this.placeGens();
    this.bind();
    this.relayout(null, () => this.fit());
  }

  // ---- layout ----------------------------------------------------------

  // Rows stay at their comfortable step while the tree fits the window at 1:1.
  // Once it doesn't, the step tightens — down to a floor where a 12px name
  // still clears its neighbour — so moderate openings need no zooming out.
  measured() {
    this.opts.rowH = this.ROW_BASE;
    let L = eng.layout(this.root, this.opts);
    const avail = this.viewport().h - 96;
    if (L.height > avail) {
      const want = Math.floor(this.ROW_BASE * (avail / L.height));
      const rowH = Math.max(this.ROW_MIN, Math.min(this.ROW_BASE, want));
      if (rowH !== this.opts.rowH) {
        this.opts.rowH = rowH;
        L = eng.layout(this.root, this.opts);
      }
    }
    return L;
  }

  relayout(anchorId, then) {
    // Cards are rebuilt below, so anything mid-flash is about to be detached.
    this.clearFlash();
    const prev = anchorId ? this.state.nodes.find((n) => n.id === anchorId) : null;
    const L = this.measured();
    this.shown = new Map(L.nodes.map((n) => [n.id, n]));
    const main = this.mainLine || new Set();

    // The layout hands back fresh objects every time and nobody else holds
    // them, so the two things the painting still needs are written straight
    // onto them rather than into a thousand copies. Everything else a card
    // used to carry was a colour, and colours are the stylesheet's business.
    for (const n of L.nodes) {
      n.ty = n.y - 8;              // a card is 16px tall; hang it on its row
      n.royal = main.has(n.id);
    }
    for (const l of L.links) l.royal = main.has(l.id);
    // Ordinary branches first, the main line painted last so it sits on top.
    L.links.sort((a, b) => (a.royal === b.royal ? 0 : a.royal ? 1 : -1));

    // Only every other column is washed; the ones in between are the page's
    // own ground and need no rect at all.
    const g = this.opts.gapX;
    const bands = [];
    (L.colX || []).forEach((x, i) => {
      if (i % 2) bands.push({ x: x - g / 2, w: (L.colW[i] || 0) + g, h: L.height + 56 });
    });
    const ticks = (L.colX || []).map((x, i) => ({
      x: x + (L.colW[i] || 0) / 2, label: ROMAN[i + 1] || String(i + 1),
    }));

    this.state = {
      nodes: L.nodes, links: L.links, bands, ticks,
      colX: L.colX || [], width: L.width, height: L.height,
    };
    this.render();

    if (prev) {
      const now = this.shown.get(anchorId);
      if (now) {
        this.cam.x += (prev.x - now.x) * this.cam.s;
        this.cam.y += (prev.y - now.y) * this.cam.s;
      }
    }
    this.tickEls = [...this.ruler.querySelectorAll('.tick')];
    this.tickKey = null;
    if (then) then(); else this.applyCam();
    // Only once the camera has settled, because it decides who is under the
    // pointer now.
    this.resettleHover();
  }

  // The cards the pointer was over have just been thrown away and built again,
  // and a detached element never gets its pointerout — so nothing would ever
  // put the tooltip out. Work the hover out again from where the pointer
  // actually is. A click that opens a branch usually slides the clicked person
  // out from under the cursor; when it does, their card of dates goes with
  // them instead of trailing the cursor for the rest of the visit.
  resettleHover() {
    const p = this.tipPos;
    const under = p ? document.elementFromPoint(p.x, p.y) : null;
    const card = under && under.closest ? under.closest('[data-id]') : null;
    const staying = card && this.tipId === +card.dataset.id && this.tip.style.opacity === '1';

    clearTimeout(this.tipT);
    this.clearHi();
    this.hoverEl = card;

    if (!card) { this.hideTip(); return; }
    this.setHi(+card.dataset.id);
    // Still the same person under the pointer: they keep the card they already
    // earned. Anyone else has to be asked for it, the same as on a first hover.
    if (staying) this.showTip(card);
    else {
      this.hideTip();
      this.tipT = setTimeout(() => this.showTip(card), TIP_DELAY);
    }
  }

  render() {
    const s = this.state;

    this.bandsSvg.setAttribute('width', s.width);
    this.bandsSvg.setAttribute('height', s.height);
    this.grad.setAttribute('y2', s.height);
    this.bandRects.innerHTML = s.bands.map((b) =>
      `<rect x="${b.x}" y="-44" width="${b.w}" height="${b.h}"></rect>`).join('');

    this.wires.setAttribute('width', s.width);
    this.wires.setAttribute('height', s.height);
    this.wires.innerHTML = s.links.map((l) =>
      `<path d="${l.d}" data-link="${l.id}"${l.royal ? ' class="royal"' : ''}></path>`).join('');

    // What a card carries is what is its own: where it sits, and the four
    // things about it the stylesheet needs to know. On a fully open tree that
    // is a third of the markup the inline colours used to cost.
    this.cards.innerHTML = s.nodes.map((n) =>
      `<div class="node${n.royal ? ' royal' : ''}${(n.depth - 1) % 2 ? ' band-b' : ''}` +
        `${n.badge ? ' badged' : ''}${n.partial ? ' partial' : ''}" data-id="${n.id}"` +
        ` style="transform:translate(${n.x}px,${n.ty}px)">` +
        `<span class="dot"></span>` +
        `<span class="name">${esc(n.name)}</span>` +
        (n.badge ? `<span class="badge">${n.count}</span>` : '') +
        (n.partial ? `<span class="caption">${esc(n.caption)}</span>` : '') +
      `</div>`).join('');

    this.ruler.innerHTML = s.ticks.map((t) =>
      `<span class="tick" style="left:${t.x}px">${t.label}</span>`).join('');

    this.shownN.textContent = s.nodes.length;
    // root.total counts everyone below the synthetic root, which is everyone.
    this.shownAll.textContent = this.root.total;
  }

  // ---- camera ----------------------------------------------------------

  applyCam() {
    const c = this.cam;
    this.camEl.style.transform = 'translate(' + c.x + 'px,' + c.y + 'px) scale(' + c.s + ')';
    this.ruler.style.transform = 'translateX(' + c.x + 'px) scale(' + c.s + ',1)';
    // Each numeral sits over the middle of its column. It is inverse-scaled to
    // stay legible, so the half-width it must back off by is a screen measure
    // divided by the zoom to land in tree coordinates.
    if (this.tickEls) {
      for (const t of this.tickEls) {
        t.style.transform = 'translateX(' + (-(t.offsetWidth / 2) / c.s) + 'px) scaleX(' + (1 / c.s) + ')';
      }
    }
    this.zoomLabel.textContent = Math.round(c.s * 100) + '%';
    this.thinTicks();
  }

  // Roman numerals stop being labels once they touch, so drop them by stride.
  thinTicks() {
    if (!this.tickEls || !this.tickEls.length) return;
    const xs = this.state.ticks, s = this.cam.s;
    let last = -1e9;
    const show = xs.map((t) => {
      const px = t.x * s;
      if (px - last < 46) return false;
      last = px; return true;
    });
    const key = show.join('');
    if (key === this.tickKey) return;
    this.tickKey = key;
    this.tickEls.forEach((t, i) => { t.style.display = show[i] ? '' : 'none'; });
  }

  // The stage is only measurable once the stylesheet has been applied; until
  // then fall back to the window, which a `position:fixed; inset:0` stage
  // matches exactly. Waiting for a frame instead would hang the whole page in
  // a background tab, where rAF never fires.
  viewport() {
    return {
      w: this.stage.clientWidth || window.innerWidth,
      h: this.stage.clientHeight || window.innerHeight,
    };
  }

  fit() {
    const r = this.viewport();
    const w = this.state.width || 1, h = this.state.height || 1;
    // The margin the fit leaves around the tree is a fixed frame on a desktop
    // window and a share of the window on a phone, where 200px of padding
    // would leave almost nothing to fit into.
    const padW = Math.min(200, r.w * 0.18), padH = Math.min(210, r.h * 0.25);
    const s = Math.max(0.03, Math.min(1.15, Math.min((r.w - padW) / w, (r.h - padH) / h)));
    this.cam.s = s;
    this.cam.x = Math.max(30, (r.w - w * s) / 2);
    this.cam.y = 40 + Math.max(0, (r.h - 80 - h * s) / 2);
    this.applyCam();
  }

  // Slides the camera sideways — never zooms, the scale is the reader's to
  // set — so that what a click just opened is on screen. When the new
  // generations are too wide for that, the clicked one goes to the left edge
  // and the rest runs off to the right, which is the way the tree reads.
  reveal(anchorId, fresh) {
    const anchor = this.shown.get(anchorId);
    if (!anchor) return;
    const s = this.cam.s, pad = EDGE, view = this.viewport().w;
    const left = anchor.x;
    let right = left;
    for (const v of fresh) right = Math.max(right, v.x + v.w);
    if ((right - left) * s > view - pad * 2) {
      this.cam.x = pad - left * s;
    } else {
      // It fits, so move as little as possible to bring the whole of it on.
      let x = this.cam.x;
      if (left * s + x < pad) x = pad - left * s;
      if (right * s + x > view - pad) x = view - pad - right * s;
      this.cam.x = x;
    }
  }

  // A generation is the only landmark this tree has across, so a finger that
  // pans sideways comes to rest on one: a column's left edge against the left
  // of the screen. Free while the finger is down, a short glide to the nearest
  // landmark when it lifts. At either end the tree's own edge outranks any
  // column, so a swipe cannot strand one column beside a screen of nothing.
  snapX() {
    const cols = this.state.colX;
    if (!cols || cols.length < 2) return null;
    const s = this.cam.s;
    const hi = EDGE;                                       // first column, flush left
    const lo = this.viewport().w - EDGE - this.state.width * s;  // last of the tree, flush right
    if (lo >= hi) return null;                             // it all fits; nothing to page through
    let best = null, gap = Infinity;
    for (const x of cols) {
      const at = Math.min(hi, Math.max(lo, EDGE - x * s));
      const d = Math.abs(at - this.cam.x);
      if (d < gap) { gap = d; best = at; }
    }
    return best;
  }

  glideX(to) {
    this.stopGlide();
    const from = this.cam.x, span = to - from;
    if (Math.abs(span) < 0.5 || REDUCED.matches) {
      this.cam.x = to; this.applyCam(); return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / SNAP_MS);
      // Off the finger at speed, settling gently: the tail of a cubic.
      this.cam.x = from + span * (1 - Math.pow(1 - k, 3));
      this.applyCam();
      this.glide = k < 1 ? requestAnimationFrame(step) : null;
    };
    this.glide = requestAnimationFrame(step);
  }

  stopGlide() {
    if (this.glide) { cancelAnimationFrame(this.glide); this.glide = null; }
  }

  zoomBy(f, cx, cy) {
    const r = this.stage.getBoundingClientRect();
    const px = cx == null ? r.width / 2 : cx - r.left;
    const py = cy == null ? r.height / 2 : cy - r.top;
    const c = this.cam;
    const ns = Math.max(0.03, Math.min(4, c.s * f));
    c.x = px - (px - c.x) * (ns / c.s);
    c.y = py - (py - c.y) * (ns / c.s);
    c.s = ns;
    this.applyCam();
  }

  // ---- theme -----------------------------------------------------------

  // One attribute, and the stylesheet repaints the lot: marks, names, wires,
  // the wash behind the columns, the word on the button. Nothing is measured
  // and nothing is rebuilt — a colour cannot move anybody.
  setTheme(name) {
    this.themeName = name;
    try { localStorage.setItem('rurik-theme', name); } catch (e) {}
    this.applyTheme();
  }

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.themeName);
  }

  // ---- how many generations a click opens ------------------------------

  buildGens(saved) {
    let html = '';
    for (let i = 1; i <= MAX_GENS; i++) {
      html += '<li role="option" data-v="' + i + '" aria-selected="false">' +
        '<svg class="gens-tick" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 4.3 3 6.3 7 1.7"/></svg>' +
        '<span>' + i + '</span></li>';
    }
    this.gensList.innerHTML = html;
    this.gensItems = [...this.gensList.children];
    this.setGens(saved >= 1 && saved <= MAX_GENS ? saved : this.gens, true);
  }

  setGens(n, quiet) {
    this.gens = Math.max(1, Math.min(MAX_GENS, n | 0));
    this.gensVal.textContent = String(this.gens);
    this.gensWord.textContent = generations(this.gens);
    for (const li of this.gensItems) {
      li.setAttribute('aria-selected', String(+li.dataset.v === this.gens));
    }
    if (quiet) return;
    try { localStorage.setItem('rurik-gens', String(this.gens)); } catch (e) {}
  }

  // On a phone the picker belongs in the one bar across the top; on a wider
  // screen it belongs in the legend, reading as one phrase with it.
  placeGens() {
    const wantBar = this.narrow.matches;
    if (wantBar === (this.gensCtl.parentElement === this.toolbar)) return;
    if (wantBar) this.toolbar.insertBefore(this.gensCtl, this.toolbar.firstElementChild);
    else this.hintPanel.prepend(this.gensCtl);
  }

  get gensOpen() { return !this.gensList.hidden; }

  openGens() {
    const list = this.gensList;
    list.hidden = false;
    this.gensBtn.setAttribute('aria-expanded', 'true');
    // The legend sits at the foot of the window on a narrow screen, so the
    // list has to know which way it has room to fall.
    const r = this.gensBtn.getBoundingClientRect();
    const want = Math.min(list.scrollHeight + 12, 238);
    list.dataset.drop = (window.innerHeight - r.bottom < want && r.top > want) ? 'up' : 'down';
    this.markGens(this.gens);
    this.gensItems[this.gens - 1].scrollIntoView({ block: 'nearest' });
  }

  closeGens() {
    this.gensList.hidden = true;
    this.gensBtn.setAttribute('aria-expanded', 'false');
    this.markGens(0);
  }

  markGens(v) {
    for (const li of this.gensItems) li.classList.toggle('active', +li.dataset.v === v);
    this.gensActive = v;
  }

  gensKey(e) {
    const STEP = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 };
    if (e.key === 'Escape' && this.gensOpen) {
      e.preventDefault(); this.closeGens(); this.gensBtn.focus(); return;
    }
    if (!this.gensOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); this.openGens();
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.setGens(this.gensActive || this.gens);
      this.closeGens(); this.gensBtn.focus(); return;
    }
    let v = null;
    if (STEP[e.key] != null) v = (this.gensActive || this.gens) + STEP[e.key];
    else if (e.key === 'Home') v = 1;
    else if (e.key === 'End') v = MAX_GENS;
    if (v == null) return;
    e.preventDefault();
    v = Math.max(1, Math.min(MAX_GENS, v));
    this.markGens(v);
    this.gensItems[v - 1].scrollIntoView({ block: 'nearest' });
  }

  // ---- input -----------------------------------------------------------

  bind() {
    const st = this.stage;

    document.getElementById('btn-collapse').addEventListener('click', () => {
      eng.collapseAll(this.root); this.root.open = true; this.relayout(null, () => this.fit());
    });
    document.getElementById('btn-expand').addEventListener('click', () => {
      eng.expandAll(this.root); this.relayout(null, () => this.fit());
    });
    document.getElementById('btn-fit').addEventListener('click', () => this.fit());
    this.themeBtn.addEventListener('click', () => {
      this.setTheme(this.themeName === 'dark' ? 'light' : 'dark');
    });
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.zoomBy(1.3));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.zoomBy(1 / 1.3));

    this.gensBtn.addEventListener('click', () => {
      if (this.gensOpen) this.closeGens(); else this.openGens();
    });
    this.gensList.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      this.setGens(+li.dataset.v);
      this.closeGens();
      this.gensBtn.focus();
    });
    this.gensList.addEventListener('pointerover', (e) => {
      const li = e.target.closest('li');
      if (li) this.markGens(+li.dataset.v);
    });
    // The open list scrolls itself; the tree behind it must not zoom.
    this.gensList.addEventListener('wheel', (e) => e.stopPropagation());
    // Spinning the wheel over the closed picker steps through the numbers
    // without opening it. The steps are accumulated so that one flick of a
    // trackpad moves one number rather than the whole range.
    this.gensWrap.addEventListener('wheel', (e) => {
      if (this.gensOpen) return;
      e.preventDefault();
      e.stopPropagation();
      this.gensAcc = (this.gensAcc || 0) + e.deltaY * (e.deltaMode === 1 ? 18 : 1);
      if (Math.abs(this.gensAcc) < 24) return;
      const step = this.gensAcc > 0 ? 1 : -1;
      this.gensAcc = 0;
      this.setGens(this.gens + step);
    }, { passive: false });
    this.gensWrap.addEventListener('keydown', (e) => this.gensKey(e));
    document.addEventListener('pointerdown', (e) => {
      if (this.gensOpen && !e.target.closest('.gens-wrap')) this.closeGens();
    }, true);

    st.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(Math.pow(0.9988, e.deltaY * (e.deltaMode === 1 ? 18 : 1)), e.clientX, e.clientY);
    }, { passive: false });

    let drag = null, moved = 0;
    const pts = new Map();
    st.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.panel')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.button === 2) return;
      this.stopGlide();
      if (pts.size === 2) { drag = null; this.pinch = this.pinchState(pts); return; }
      drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, dx: 0, dy: 0 };
      moved = 0;
      st.classList.add('grabbing');
      const card = e.target.closest && e.target.closest('[data-id]');
      if (card && e.pointerType === 'touch') this.startLongPress(card);
    });
    st.addEventListener('pointermove', (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (hovers(e)) { this.tipPos = { x: e.clientX, y: e.clientY }; this.moveTip(); }
      if (pts.size === 2 && this.pinch) { this.doPinch(pts); return; }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.dx = dx; drag.dy = dy;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (moved > 4) { this.cancelLongPress(); this.hideTip(); }
      this.cam.x = drag.cx + dx; this.cam.y = drag.cy + dy;
      this.applyCam();
    });
    const up = (e) => {
      // A finger, on the last of its own gesture, having gone more across than
      // down. A mouse can be put anywhere exactly and is left where it is put;
      // a pinch has already said what it wanted; a scroll down the page is not
      // a request to move sideways at all.
      const settle = drag && e.pointerType === 'touch' && pts.size === 1 &&
        Math.abs(drag.dx) > Math.abs(drag.dy) && Math.abs(drag.dx) > 8;
      pts.delete(e.pointerId);
      if (pts.size < 2) this.pinch = null;
      drag = null; st.classList.remove('grabbing');
      this.cancelLongPress();
      if (settle) { const to = this.snapX(); if (to != null) this.glideX(to); }
    };
    st.addEventListener('pointerup', up);
    st.addEventListener('pointercancel', up);
    st.addEventListener('pointerleave', up);

    this.camEl.addEventListener('click', (e) => {
      if (moved > 4 || this.suppress) return;
      const card = e.target.closest('[data-id]');
      if (!card) return;
      const n = this.find(+card.dataset.id);
      if (!n) return;
      const before = new Set(this.state.nodes.map((v) => v.id));
      eng.toggle(n, e.altKey || e.shiftKey ? MAX_GENS : this.gens);
      this.relayout(n.id, () => {
        // A fold leaves nothing new to look at; only an opening moves the
        // camera and lights anything up.
        const fresh = this.state.nodes.filter((v) => !before.has(v.id));
        if (fresh.length) this.reveal(n.id, fresh);
        this.applyCam();
        // Only the generation that answers the click is lit, not everything
        // under it. A twenty-generation opening puts a thousand glowing nodes
        // on screen, none of which the compositor can help with, and the row
        // of children already says where the new growth hangs from. The camera
        // still takes the whole opening into account.
        const kids = fresh.filter((v) => v.node && v.node.parent === n);
        if (kids.length) this.flash(kids.map((v) => v.id), true);
      });
    });
    st.addEventListener('contextmenu', (e) => {
      const card = e.target.closest && e.target.closest('[data-id]');
      e.preventDefault();
      if (!card) return;
      const n = this.find(+card.dataset.id);
      if (n) this.hideAnimated(n, card);
    });
    this.camEl.addEventListener('pointerover', (e) => {
      if (!hovers(e)) return;
      const card = e.target.closest('[data-id]');
      if (!card || card === this.hoverEl) return;
      this.hoverEl = card;
      this.setHi(+card.dataset.id);
      // The line back to Рюрик lights at once — that is the answer to moving
      // the pointer. The card of dates is a second question, and waits to be
      // asked properly.
      clearTimeout(this.tipT);
      this.tipT = setTimeout(() => this.showTip(card), TIP_DELAY);
    });
    this.camEl.addEventListener('pointerout', (e) => {
      const card = e.target.closest('[data-id]');
      if (!card) return;
      if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-id]') === card) return;
      this.hoverEl = null; this.hideTip(); this.clearHi();
    });
    // Both, deliberately: the media query is the right signal, but it does not
    // always deliver on a programmatic resize, and placeGens costs one
    // comparison when there is nothing to move.
    this.narrow.addEventListener('change', () => { this.closeGens(); this.placeGens(); });
    window.addEventListener('resize', () => { this.placeGens(); this.applyCam(); });
  }

  pinchState(pts) {
    const a = [...pts.values()];
    return { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), s: this.cam.s };
  }
  doPinch(pts) {
    const a = [...pts.values()];
    const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    if (!this.pinch.d) return;
    this.zoomBy((this.pinch.s * (d / this.pinch.d)) / this.cam.s, (a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2);
  }

  startLongPress(card) {
    this.cancelLongPress();
    this.lp = setTimeout(() => {
      this.lp = null; this.suppress = true;
      const n = this.find(+card.dataset.id);
      if (n) this.hideAnimated(n, card);
      setTimeout(() => { this.suppress = false; }, 700);
    }, 550);
  }
  cancelLongPress() { if (this.lp) { clearTimeout(this.lp); this.lp = null; } }

  // On a wide-open tree a node just vanishing reads as a glitch, so the card
  // itself flies into the parent it folded into, and that parent lights up.
  hideAnimated(node, card) {
    const parentId = node.parent && node.parent.id;
    const stage = this.stage.getBoundingClientRect();
    const from = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    if (!eng.hide(node)) return;
    this.clearHi();
    this.hideTip();
    this.relayout(parentId, () => {
      this.applyCam();
      const target = this.camEl.querySelector('[data-id="' + parentId + '"]');
      if (target) {
        const to = target.getBoundingClientRect();
        const s = this.cam.s;
        ghost.style.cssText += ';position:absolute;margin:0;pointer-events:none;z-index:40;' +
          'left:' + (from.left - stage.left) + 'px;top:' + (from.top - stage.top) + 'px;' +
          'transform-origin:0 0;';
        this.stage.appendChild(ghost);
        const a = ghost.animate([
          { transform: 'translate(0,0) scale(' + s + ')', opacity: 1 },
          { transform: 'translate(' + (to.left - from.left) + 'px,' + (to.top - from.top) + 'px) scale(' + (s * 0.2) + ')', opacity: 0 },
        ], { duration: 430, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
        a.onfinish = () => ghost.remove();
        a.oncancel = () => ghost.remove();
      }
      this.flash(parentId);
    });
  }

  // Lights a node, or a whole crop of them, in the flash colour: after a fold,
  // the parent that swallowed the branch; after an opening, everything that
  // just appeared. Classes rather than inline styles, so opening a
  // thousand-node branch costs two class writes per node, not a stylesheet.
  flash(ids, withWires) {
    this.clearFlash();
    const els = [];
    for (const id of (Array.isArray(ids) ? ids : [ids])) {
      const card = this.camEl.querySelector('[data-id="' + id + '"]');
      if (card) els.push(card);
      // A wire is named after the node it carries, so it is new exactly when
      // that node is. After a fold nothing new arrived, and the parent's own
      // wire has no business lighting up.
      if (!withWires) continue;
      const wire = this.wires.querySelector('[data-link="' + id + '"]');
      if (wire) els.push(wire);
    }
    if (!els.length) return;
    for (const el of els) el.classList.add('flashing', 'flash');
    this.flashEls = els;
    this.flashTimers = [setTimeout(() => {
      for (const el of els) el.classList.remove('flash');
      this.flashTimers.push(setTimeout(() => this.clearFlash(), 880));
    }, 520)];
  }

  // A second flash must not cancel the first one mid-way and strand it lit.
  clearFlash() {
    (this.flashTimers || []).forEach(clearTimeout);
    this.flashTimers = [];
    for (const el of this.flashEls || []) el.classList.remove('flash', 'flashing');
    this.flashEls = null;
  }

  // Everyone in the dynasty, whether they are on screen or not — as against
  // `shown`, which is only what the last layout put there. The engine builds
  // this once at load; walking the tree for it on every hover was the old way.
  find(id) { return this.root.byId.get(id); }

  // ---- hover -----------------------------------------------------------

  setHi(id) {
    const n = this.find(id);
    if (!n) return;
    // Clearing first rather than dropping the list: a trace that is never put
    // out stays lit for the life of the card.
    this.clearHi();
    for (const i of eng.lineage(n)) {
      const card = this.camEl.querySelector('[data-id="' + i + '"]');
      if (card) { card.classList.add('lit'); this.hi.push(card); }
      const path = this.camEl.querySelector('[data-link="' + i + '"]');
      if (path) { path.classList.add('lit'); this.hi.push(path); }
    }
  }
  clearHi() { for (const el of this.hi) el.classList.remove('lit'); this.hi = []; }

  showTip(card) {
    const n = this.shown.get(+card.dataset.id);
    // Nothing to say without dates — the name is already on screen.
    if (!n || !n.years) { this.hideTip(); return; }
    this.tipId = n.id;
    this.tipName.textContent = n.name;
    const src = this.find(n.id);
    const bits = [n.years, 'колено ' + n.depth];
    if (src && src.total) bits.push('потомков ' + src.total);
    this.tipMeta.textContent = bits.join('  ·  ');
    this.tip.style.opacity = '1';
    this.moveTip();
  }
  moveTip() {
    if (this.tip.style.opacity !== '1' || !this.tipPos) return;
    const r = this.stage.getBoundingClientRect();
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    let x = this.tipPos.x - r.left + 14, y = this.tipPos.y - r.top - h - 12;
    if (x + w > r.width - 8) x = this.tipPos.x - r.left - w - 14;
    if (y < 36) y = this.tipPos.y - r.top + 18;
    this.tip.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }
  hideTip() {
    clearTimeout(this.tipT);
    this.tipId = null;
    this.tip.style.opacity = '0';
    this.tip.style.transform = 'translate(-9999px,-9999px)';
  }
}

new Observatory().start();
