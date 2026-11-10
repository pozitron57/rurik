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

// The margin the tree keeps from the left of the screen, both when a click
// brings an opening into view and when the page first opens on a phone.
const EDGE = 24;

// On a phone, keep this much already-painted tree beyond every screen edge.
// The camera can travel through the reserve without touching the DOM; only
// crossing it asks for a new crop. Measured in screen pixels so it feels the
// same at every zoom.
const CULL_PAD = 120;

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ENT[c]);

const span = (cls, text) => {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
};

class Observatory {
  constructor() {
    this.stage = document.getElementById('stage');
    this.camEl = document.getElementById('cam');
    this.svgWorld = document.getElementById('svg-world');
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

    this.state = { nodes: [], links: [], bands: [], ticks: [], width: 0, height: 0 };
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
    // id -> the card element standing for that person right now. Cards survive
    // a relayout, so this is the truth about what is on screen, and it is what
    // everything that needs an element by id reads instead of searching for it.
    this.painted = new Map();
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
    this.relayout(null, () => this.openingView());
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
      nodes: L.nodes, links: L.links, bands, ticks, width: L.width, height: L.height,
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
    this.tickScale = null;
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

    this.grad.setAttribute('y2', s.height);
    // Build the logical scene once per layout. Mobile viewport culling only
    // changes display afterwards, so cards keep their identity for flashes,
    // long presses and incremental relayouts.
    this.paintBands(s.bands);
    this.paintWires(s.links);
    this.paintCards(s.nodes);
    this.sceneMode = null;
    this.cullBounds = null;
    this.cullScale = null;

    this.ruler.innerHTML = s.ticks.map((t) =>
      `<span class="tick" style="left:${t.x}px">${t.label}</span>`).join('');

    this.shownN.textContent = s.nodes.length;
    // root.total counts everyone below the synthetic root, which is everyone.
    this.shownAll.textContent = this.root.total;
  }

  // A fully-open tree is more than five thousand tree-pixels wide. At fit it
  // rasterises into a tiny picture and is cheap; at a readable phone zoom the
  // same promoted layer becomes a large tiled surface. The fixed SVG root
  // clips vectors at the screen, just like the old implementation did. At
  // every larger phone zoom, cull the HTML cards to the viewport plus
  // CULL_PAD as well. The crop moves only after the screen consumes its
  // reserve, so ordinary pointer frames still do transform writes and no
  // scene rebuild.
  paintViewport() {
    const s = this.state;
    if (!s.nodes.length) return;

    const r = this.cullViewport || (this.cullViewport = this.viewport());
    const phone = this.narrow.matches;
    const wholeIsSmall = phone &&
      s.width * this.cam.s <= r.w + CULL_PAD * 2 &&
      s.height * this.cam.s <= r.h + CULL_PAD * 2;

    if (!phone || wholeIsSmall) {
      if (this.sceneMode === 'all') return;
      for (const n of s.nodes) this.setCulled(this.painted.get(n.id), false);
      this.sceneMode = 'all';
      this.cullBounds = null;
      this.cullScale = this.cam.s;
      return;
    }

    const scale = this.cam.s || 1;
    const view = {
      left: -this.cam.x / scale,
      top: -this.cam.y / scale,
      right: (r.w - this.cam.x) / scale,
      bottom: (r.h - this.cam.y) / scale,
    };
    // Zooming in keeps the old crop safe, but makes its layer larger on screen;
    // prune after one ordinary zoom step. Zooming out is already covered by
    // the containment test as the viewport expands.
    const scaleMoved = !this.cullScale || scale / this.cullScale > 1.25;
    const inside = this.cullBounds &&
      view.left >= this.cullBounds.left && view.top >= this.cullBounds.top &&
      view.right <= this.cullBounds.right && view.bottom <= this.cullBounds.bottom;
    if (this.sceneMode === 'crop' && !scaleMoved && inside) return;

    const pad = CULL_PAD / scale;
    const bounds = {
      left: Math.floor(view.left - pad),
      top: Math.floor(view.top - pad),
      right: Math.ceil(view.right + pad),
      bottom: Math.ceil(view.bottom + pad),
    };
    for (const n of s.nodes) {
      const visible = n.x + n.w + 20 >= bounds.left && n.x - 20 <= bounds.right &&
        n.ty + (n.partial ? 46 : 38) >= bounds.top && n.ty - 20 <= bounds.bottom;
      this.setCulled(this.painted.get(n.id), !visible);
    }

    this.sceneMode = 'crop';
    this.cullBounds = bounds;
    this.cullScale = scale;
  }

  setCulled(el, off) {
    if (!el || el._culled === off) return;
    el._culled = off;
    el.style.display = off ? 'none' : '';
  }

  paintBands(bands) {
    this.bandRects.innerHTML = bands.map((b) =>
      `<rect x="${b.x}" y="-44" width="${b.w}" height="${b.h}"></rect>`).join('');
  }

  paintWires(links) {
    this.wires.innerHTML = links.map((l) =>
      `<path d="${l.d}" data-link="${l.id}"${l.royal ? ' class="royal"' : ''}></path>`).join('');
  }

  // ---- cards -----------------------------------------------------------

  // Opening a branch usually changes a handful of people and moves everybody
  // below them. Rebuilding all thousand cards to show three costs the same as
  // building the tree from nothing, which is what it used to do. So whoever
  // stays, stays: they are moved, and told only what actually changed about
  // them. Only genuinely new people are parsed — all of them in one string,
  // because for building many elements at once nothing beats the parser.
  //
  // Nobody overlaps, so the order the cards sit in the document says nothing
  // and new ones can simply go on the end.
  paintCards(nodes) {
    const live = this.painted;
    const fresh = [];
    for (const n of nodes) {
      const el = live.get(n.id);
      if (el) this.recard(el, n);
      else fresh.push(n);
    }

    if (fresh.length) {
      const tpl = document.createElement('template');
      tpl.innerHTML = fresh.map((n) => this.cardHTML(n)).join('');
      let i = 0;
      for (const el of tpl.content.children) {
        const n = fresh[i++];
        el._was = n;
        // A card carries at most one of the two, and the layout guarantees
        // never both, so whichever it has is its last child.
        el._badge = n.badge ? el.lastElementChild : null;
        el._caption = n.partial ? el.lastElementChild : null;
        live.set(n.id, el);
      }
      this.cards.appendChild(tpl.content);
    }

    if (live.size > nodes.length) {
      const on = new Set(nodes.map((n) => n.id));
      for (const [id, el] of live) {
        if (!on.has(id)) { el.remove(); live.delete(id); }
      }
    }
  }

  // What a card carries is what is its own: where it sits, and the four things
  // about it the stylesheet needs to know. Everything else is colour, and
  // colour is treestyle.css's business.
  cardHTML(n) {
    return `<div class="node${n.royal ? ' royal' : ''}${(n.depth - 1) % 2 ? ' band-b' : ''}` +
      `${n.badge ? ' badged' : ''}${n.partial ? ' partial' : ''}" data-id="${n.id}"` +
      ` style="left:${n.x}px;top:${n.ty}px">` +
      `<span class="dot"></span>` +
      `<span class="name">${esc(n.name)}</span>` +
      (n.badge ? `<span class="badge">${n.count}</span>` : '') +
      (n.partial ? `<span class="caption">${esc(n.caption)}</span>` : '') +
    `</div>`;
  }

  // Somebody who was already on screen. A name never changes and neither does
  // the column or the main line, so the only things that can have moved are
  // the position and what the mark has to say.
  recard(el, n) {
    const was = el._was;
    if (was.x !== n.x || was.ty !== n.ty) {
      el.style.left = n.x + 'px';
      el.style.top = n.ty + 'px';
    }
    if (was.badge !== n.badge) {
      el.classList.toggle('badged', n.badge);
      if (n.badge) el._badge = el.appendChild(span('badge', n.count));
      else if (el._badge) { el._badge.remove(); el._badge = null; }
    } else if (n.badge && was.count !== n.count) {
      el._badge.textContent = n.count;
    }
    if (was.partial !== n.partial) {
      el.classList.toggle('partial', n.partial);
      if (n.partial) el._caption = el.appendChild(span('caption', n.caption));
      else if (el._caption) { el._caption.remove(); el._caption = null; }
    } else if (n.partial && was.caption !== n.caption) {
      el._caption.textContent = n.caption;
    }
    el._was = n;
  }

  // ---- camera ----------------------------------------------------------

  applyCam() {
    if (this.camFrame) {
      cancelAnimationFrame(this.camFrame);
      this.camFrame = 0;
    }
    const c = this.cam;
    this.paintViewport();
    this.svgWorld.setAttribute('transform',
      'translate(' + c.x + ' ' + c.y + ') scale(' + c.s + ')');
    this.camEl.style.transform = 'translate3d(' + c.x + 'px,' + c.y + 'px,0) scale(' + c.s + ')';
    if (!this.narrow.matches) {
      this.ruler.style.transform = 'translateX(' + c.x + 'px) scale(' + c.s + ',1)';
    }
    // Panning changes only x/y. Measuring and inverse-scaling every generation
    // label on every pointer event forced work whose answer could not have
    // changed — and the whole ruler is hidden on a phone anyway.
    if (this.tickScale === c.s) return;
    this.tickScale = c.s;
    this.zoomLabel.textContent = Math.round(c.s * 100) + '%';
    if (this.narrow.matches) return;
    // Each numeral sits over the middle of its column. It is inverse-scaled to
    // stay legible, so the half-width it must back off by is a screen measure
    // divided by the zoom to land in tree coordinates.
    if (this.tickEls) {
      for (const t of this.tickEls) {
        t.style.transform = 'translateX(' + (-(t.offsetWidth / 2) / c.s) + 'px) scaleX(' + (1 / c.s) + ')';
      }
    }
    this.thinTicks();
  }

  // Touchmove can arrive more often than the display can paint. Keep the
  // newest camera coordinates, but write them only once for the next frame.
  queueCam() {
    if (this.camFrame) return;
    this.camFrame = requestAnimationFrame(() => {
      this.camFrame = 0;
      this.applyCam();
    });
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

  // What the page opens on. A desktop window can hold the whole tree at a size
  // the names still read at, so it gets the fit. A phone cannot: fitting six
  // generations into 375 points leaves the names as grey smudges. So the phone
  // opens at full size instead — Рюрик against the left edge, and as much of
  // what grows from him as the screen holds. Everything else is one swipe away,
  // and УМЕСТИТЬ is still there for the whole picture.
  openingView() {
    if (!this.narrow.matches) { this.fit(); return; }
    const r = this.viewport();
    const h = this.state.height || 1;
    this.cam.s = 1;
    this.cam.x = EDGE;
    // Centred while the opening generations fit; otherwise from the top down.
    const room = r.h - 80;
    this.cam.y = h < room ? 40 + (room - h) / 2 : 40;
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

  zoomBy(f, cx, cy, queued) {
    const r = this.stage.getBoundingClientRect();
    const px = cx == null ? r.width / 2 : cx - r.left;
    const py = cy == null ? r.height / 2 : cy - r.top;
    const c = this.cam;
    const ns = Math.max(0.03, Math.min(4, c.s * f));
    c.x = px - (px - c.x) * (ns / c.s);
    c.y = py - (py - c.y) * (ns / c.s);
    c.s = ns;
    if (queued) this.queueCam(); else this.applyCam();
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
      this.zoomBy(Math.pow(0.9988, e.deltaY * (e.deltaMode === 1 ? 18 : 1)), e.clientX, e.clientY, true);
    }, { passive: false });

    let drag = null, moved = 0;
    const pts = new Map();
    st.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.panel')) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.button === 2) return;
      if (pts.size === 2) {
        this.cancelLongPress();
        drag = null; this.pinch = this.pinchState(pts); return;
      }
      drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y };
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
      const wasMoved = moved > 4;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (!wasMoved && moved > 4) {
        this.cancelLongPress(); this.hideTip();
        // Once this is certainly a drag, keep its stream on the stage instead
        // of hit-testing hundreds of cards as they pass under the finger.
        if (st.setPointerCapture && (!st.hasPointerCapture || !st.hasPointerCapture(e.pointerId))) {
          try { st.setPointerCapture(e.pointerId); } catch (err) {}
        }
      }
      this.cam.x = drag.cx + dx; this.cam.y = drag.cy + dy;
      this.queueCam();
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) this.pinch = null;
      drag = null; st.classList.remove('grabbing');
      this.cancelLongPress();
      // Do not leave the very last movement waiting if the finger came up
      // before the next animation frame.
      if (this.camFrame) this.applyCam();
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
      if (!hovers(e)) return;
      const card = e.target.closest('[data-id]');
      if (!card) return;
      if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-id]') === card) return;
      this.hoverEl = null; this.hideTip(); this.clearHi();
    });
    // Both, deliberately: the media query is the right signal, but it does not
    // always deliver on a programmatic resize, and placeGens costs one
    // comparison when there is nothing to move.
    this.narrow.addEventListener('change', () => {
      this.closeGens(); this.placeGens();
      this.cullViewport = null; this.sceneMode = null; this.tickScale = null;
      this.applyCam();
    });
    window.addEventListener('resize', () => {
      this.placeGens();
      this.cullViewport = null; this.sceneMode = null; this.tickScale = null;
      this.applyCam();
    });
  }

  pinchState(pts) {
    const a = [...pts.values()];
    return { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), s: this.cam.s };
  }
  doPinch(pts) {
    const a = [...pts.values()];
    const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    if (!this.pinch.d) return;
    this.zoomBy((this.pinch.s * (d / this.pinch.d)) / this.cam.s, (a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2, true);
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
      // The parent may sit just beyond the mobile paint window. Its model
      // position is the authoritative destination and avoids forcing layout
      // (or reading a zero rectangle from a culled card).
      const target = this.shown.get(parentId);
      if (target) {
        const s = this.cam.s;
        const to = {
          left: stage.left + this.cam.x + target.x * s,
          top: stage.top + this.cam.y + target.ty * s,
        };
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
      const card = this.painted.get(id);
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
      const card = this.painted.get(i);
      if (card) { card.classList.add('lit'); this.hi.push(card); }
      const path = this.wires.querySelector('[data-link="' + i + '"]');
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
