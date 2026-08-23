// Рюриковичи — the observatory view.
//
// treeengine.js decides where every visible person goes; this file paints
// them, drives the camera, and owns the two palettes. Names and wires are
// plain DOM/SVG rebuilt on every layout change — a fully open tree is about a
// thousand rows, which is well inside what one rebuild can afford.

import * as eng from './treeengine.js';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
  'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII', 'XXIV'];

// Two complete palettes. Every colour the tree is painted with has a
// counterpart here, so nothing falls back to a dark-theme literal when the
// light theme is on. The chrome's colours live in treestyle.css.
const THEMES = {
  dark: {
    bandA: '#0B0C10', bandB: '#101319',
    grad: ['#151A24', '#131822', '#11151E', '#10141C'],
    ink: '#D7DAE0', dim: '#3B434E', mark: '#C9D1DA', caption: '#666E79',
    gold: '#E9A93A', royalInk: '#F6DFA8', glow: 'rgba(233,169,58,0.5)',
    link: '#4E5661', hover: '#FFFFFF', hoverGlow: 'rgba(255,255,255,0.5)',
    badgeBg: 'rgba(255,255,255,0.08)', royalBadgeBg: 'rgba(233,169,58,0.16)',
    flash: '#4FE3C1', flashRgb: '79,227,193',
    label: 'СВЕТЛАЯ ТЕМА',
  },
  light: {
    bandA: '#F7F6F3', bandB: '#EDEBE3',
    grad: ['#E2DFD4', '#E7E4DA', '#EEECE5', '#EEECE5'],
    ink: '#1E1D18', dim: '#BCB7A9', mark: '#4A473E', caption: '#9A958A',
    gold: '#A9660C', royalInk: '#6F4207', glow: 'rgba(169,102,12,0.32)',
    // Light ink is already near-black, so a black highlight would be invisible
    // as a highlight — the light theme signals the lineage with saturation.
    link: '#9A9484', hover: '#1240B4', hoverGlow: 'rgba(18,64,180,0.45)',
    badgeBg: 'rgba(28,26,20,0.07)', royalBadgeBg: 'rgba(169,102,12,0.13)',
    flash: '#0C8F79', flashRgb: '12,143,121',
    label: 'ТЁМНАЯ ТЕМА',
  },
};

// Twenty is both the longest run the picker offers and what shift-click opens,
// and no branch of the dynasty is deeper than that.
const MAX_GENS = 20;

const generations = (n) => {
  const ten = n % 10, hundred = n % 100;
  if (ten === 1 && hundred !== 11) return 'КОЛЕНО';
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'КОЛЕНА';
  return 'КОЛЕН';
};

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ENT[c]);

class Observatory {
  constructor() {
    this.stage = document.getElementById('stage');
    this.camEl = document.getElementById('cam');
    this.bandsSvg = document.getElementById('bands');
    this.bandRects = document.getElementById('band-rects');
    this.grad = document.getElementById('bandFade');
    this.stops = [...this.grad.querySelectorAll('stop')];
    this.wires = document.getElementById('wires');
    this.cards = document.getElementById('cards');
    this.ruler = document.getElementById('ruler');
    this.zoomLabel = document.getElementById('zoom');
    this.themeBtn = document.getElementById('btn-theme');
    this.tip = document.getElementById('tip');
    this.tipName = document.getElementById('tip-name');
    this.tipMeta = document.getElementById('tip-meta');

    this.state = { nodes: [], links: [], bands: [], ticks: [], width: 0, height: 0 };
    this.cam = { x: 120, y: 120, s: 1 };
    this.ROW_BASE = 21;
    this.ROW_MIN = 16;
    this.opts = {
      rowH: 21, gapX: 50, padX: 8, badgeW: 28, famGap: 1.35, captionH: 10,
      font: '500 12px Helvetica, Arial, sans-serif',
      captionFont: '400 9px Helvetica, Arial, sans-serif',
    };
    this.hi = [];
    this.byId = new Map();
    this.gens = 1;
    this.gensSel = document.getElementById('gens');
    this.gensWord = document.getElementById('gens-word');
    this.themeName = 'dark';
    this.pal = THEMES.dark;
  }

  async start() {
    this.root = await eng.loadTree('tree.json');
    this.root.open = true;
    this.root.kids.forEach((k) => eng.expandDepth(k, 4));
    // The main dynastic line stays lit at all times: Рюрик → … → Иван IV Грозный.
    const ivan = eng.findByName(this.root, 'Иван IV Грозный');
    this.mainLine = new Set(ivan ? eng.lineage(ivan) : []);
    // Column widths are measured from the real faces, so wait for them.
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }

    let saved = null;
    try { saved = localStorage.getItem('rurik-theme'); } catch (e) {}
    if (saved && THEMES[saved]) { this.themeName = saved; this.pal = THEMES[saved]; }
    let savedGens = null;
    try { savedGens = parseInt(localStorage.getItem('rurik-gens'), 10); } catch (e) {}
    this.buildGens(savedGens);
    this.applyTheme();
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
    const prev = anchorId ? this.state.nodes.find((n) => n.id === anchorId) : null;
    const L = this.measured();
    this.byId = new Map(L.nodes.map((n) => [n.id, n]));
    const P = this.pal;
    const main = this.mainLine || new Set();

    const nodes = L.nodes.map((n) => {
      const royal = main.has(n.id);
      const tone = royal ? P.gold : P.mark;
      // The unfilled part of a mark must read as empty, not as a hole the
      // incoming line shows through — so it is painted in its own band colour.
      const band = (n.depth - 1) % 2 ? P.bandB : P.bandA;
      const solid = (c) => 'linear-gradient(' + c + ', ' + c + ')';
      const fill = n.partial
        ? 'linear-gradient(90deg, ' + tone + ' 0 50%, ' + band + ' 50% 100%)'
        : solid(n.badge ? tone : band);
      return Object.assign({}, n, {
        ty: n.y - 8,
        weight: royal ? 600 : 500,
        color: royal ? P.royalInk : P.ink,
        capColor: P.caption,
        dotFill: fill,
        dotStroke: royal || n.badge || n.partial ? tone : P.dim,
        ring: band,
        glow: royal ? P.glow : 'transparent',
        badgeFg: royal ? P.royalInk : P.mark,
        badgeBg: royal ? P.royalBadgeBg : P.badgeBg,
      });
    });

    // Ordinary branches first, the main line painted last so it sits on top.
    const links = L.links.map((l) => {
      const royal = main.has(l.id);
      return Object.assign({}, l, {
        royal, w: royal ? 1.7 : 1, stroke: royal ? P.gold : P.link,
      });
    }).sort((a, b) => (a.royal === b.royal ? 0 : a.royal ? 1 : -1));

    const g = this.opts.gapX;
    const bands = (L.colX || []).map((x, i) => ({
      x: x - g / 2, w: (L.colW[i] || 0) + g, h: L.height + 56,
      // Zebra, but every band shares one gradient measured in tree coordinates:
      // strongest under the generation numbers, dissolving toward the foot of
      // the tree. Same ramp in every column, so the set reads as one system.
      fill: i % 2 ? 'url(#bandFade)' : 'transparent',
    }));
    const ticks = (L.colX || []).map((x, i) => ({
      x: x + (L.colW[i] || 0) / 2, label: ROMAN[i + 1] || String(i + 1),
    }));

    this.state = { nodes, links, bands, ticks, width: L.width, height: L.height };
    this.render();

    if (prev) {
      const now = this.byId.get(anchorId);
      if (now) {
        this.cam.x += (prev.x - now.x) * this.cam.s;
        this.cam.y += (prev.y - now.y) * this.cam.s;
      }
    }
    this.tickEls = [...this.ruler.querySelectorAll('.tick')];
    this.tickKey = null;
    if (then) then(); else this.applyCam();
  }

  render() {
    const s = this.state;

    this.bandsSvg.setAttribute('width', s.width);
    this.bandsSvg.setAttribute('height', s.height);
    this.grad.setAttribute('y2', s.height);
    this.bandRects.innerHTML = s.bands.map((b) =>
      `<rect x="${b.x}" y="-44" width="${b.w}" height="${b.h}" fill="${b.fill}"></rect>`).join('');

    this.wires.setAttribute('width', s.width);
    this.wires.setAttribute('height', s.height);
    this.wires.innerHTML = s.links.map((l) =>
      `<path d="${l.d}" data-link="${l.id}" fill="none" stroke="${l.stroke}" stroke-width="${l.w}"` +
      ` shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke"></path>`).join('');

    this.cards.innerHTML = s.nodes.map((n) =>
      `<div class="node" data-id="${n.id}" style="transform:translate(${n.x}px,${n.ty}px)">` +
        `<span class="dot" style="border-color:${n.dotStroke};background-image:${n.dotFill};` +
          `box-shadow:0 0 0 2px ${n.ring}, 0 0 8px ${n.glow}"></span>` +
        `<span class="name" style="font-weight:${n.weight};color:${n.color}">${esc(n.name)}</span>` +
        (n.badge ? `<span class="badge" style="color:${n.badgeFg};background:${n.badgeBg}">${esc(n.count)}</span>` : '') +
        (n.partial ? `<span class="caption" style="color:${n.capColor}">${esc(n.caption)}</span>` : '') +
      `</div>`).join('');

    this.ruler.innerHTML = s.ticks.map((t) =>
      `<span class="tick" style="left:${t.x}px">${t.label}</span>`).join('');
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

  setTheme(name) {
    this.themeName = name;
    this.pal = THEMES[name];
    try { localStorage.setItem('rurik-theme', name); } catch (e) {}
    this.applyTheme();
    this.relayout();
  }

  applyTheme() {
    const P = this.pal;
    document.documentElement.setAttribute('data-theme', this.themeName);
    this.stops.forEach((s, i) => s.setAttribute('stop-color', P.grad[i] || P.grad[0]));
    this.themeBtn.textContent = P.label;
  }

  // ---- how many generations a click opens ------------------------------

  buildGens(saved) {
    const sel = this.gensSel;
    let html = '';
    for (let i = 1; i <= MAX_GENS; i++) html += '<option value="' + i + '">' + i + '</option>';
    sel.innerHTML = html;
    this.setGens(saved >= 1 && saved <= MAX_GENS ? saved : this.gens, true);
  }

  setGens(n, quiet) {
    this.gens = Math.max(1, Math.min(MAX_GENS, n | 0));
    this.gensSel.value = String(this.gens);
    this.gensWord.textContent = generations(this.gens);
    if (quiet) return;
    try { localStorage.setItem('rurik-gens', String(this.gens)); } catch (e) {}
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

    this.gensSel.addEventListener('change', () => this.setGens(+this.gensSel.value));
    // Spinning the wheel over the picker steps through the numbers without
    // opening it. The steps are accumulated so that one flick of a trackpad
    // moves one number rather than the whole list.
    this.gensSel.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.gensAcc = (this.gensAcc || 0) + e.deltaY * (e.deltaMode === 1 ? 18 : 1);
      if (Math.abs(this.gensAcc) < 24) return;
      const step = this.gensAcc > 0 ? 1 : -1;
      this.gensAcc = 0;
      this.setGens(this.gens + step);
    }, { passive: false });

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
      if (pts.size === 2) { drag = null; this.pinch = this.pinchState(pts); return; }
      drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y };
      moved = 0;
      st.classList.add('grabbing');
      const card = e.target.closest && e.target.closest('[data-id]');
      if (card && e.pointerType === 'touch') this.startLongPress(card);
    });
    st.addEventListener('pointermove', (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.tipPos = { x: e.clientX, y: e.clientY }; this.moveTip();
      if (pts.size === 2 && this.pinch) { this.doPinch(pts); return; }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (moved > 4) this.cancelLongPress();
      this.cam.x = drag.cx + dx; this.cam.y = drag.cy + dy;
      this.applyCam();
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) this.pinch = null;
      drag = null; st.classList.remove('grabbing');
      this.cancelLongPress();
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
      eng.toggle(n, e.altKey || e.shiftKey ? MAX_GENS : this.gens);
      this.relayout(n.id);
    });
    st.addEventListener('contextmenu', (e) => {
      const card = e.target.closest && e.target.closest('[data-id]');
      e.preventDefault();
      if (!card) return;
      const n = this.find(+card.dataset.id);
      if (n) this.hideAnimated(n, card);
    });
    this.camEl.addEventListener('pointerover', (e) => {
      const card = e.target.closest('[data-id]');
      if (!card || card === this.hoverEl) return;
      this.hoverEl = card;
      this.showTip(card);
      this.setHi(+card.dataset.id);
    });
    this.camEl.addEventListener('pointerout', (e) => {
      const card = e.target.closest('[data-id]');
      if (!card) return;
      if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-id]') === card) return;
      this.hoverEl = null; this.hideTip(); this.clearHi();
    });
    window.addEventListener('resize', () => this.applyCam());
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

  restoreFlash() {
    (this.flashTimers || []).forEach(clearTimeout);
    this.flashTimers = [];
    (this.flashSaved || []).forEach(([el, css]) => { el.style.cssText = css; });
    this.flashSaved = null;
  }

  flash(id) {
    const card = this.camEl.querySelector('[data-id="' + id + '"]');
    if (!card) return;
    // A second hide must not cancel the first flash mid-way and leave it lit:
    // cancelling the pending restore without running it strands those styles
    // forever. Every flash ends in a restore, interrupted or not.
    this.restoreFlash();
    // The flash colour is used nowhere else in either palette — not the resting
    // ink, not the gold of the main line, not the white of hover — so it can
    // only mean "the child you just hid went in here".
    const name = card.querySelector('.name');
    const cap = card.querySelector('.caption');
    const dot = card.querySelector('.dot');
    // Snapshot whole declarations, not single properties: the dot's fill is a
    // gradient plus background-clip, and restoring those piecemeal loses the
    // clip and blanks the mark.
    const saved = [card, name, cap, dot].filter(Boolean).map((el) => [el, el.style.cssText]);
    const put = (el, prop, val) => { if (el) el.style[prop] = val; };
    const ease = (ms) => ms + 'ms cubic-bezier(0.4, 0, 0.2, 1)';

    put(card, 'transition', 'background ' + ease(120) + ', box-shadow ' + ease(120));
    const F = this.pal.flash, rgb = this.pal.flashRgb;
    put(card, 'background', 'rgba(' + rgb + ',0.14)');
    put(card, 'boxShadow', '0 0 0 1px rgba(' + rgb + ',0.65), 0 0 16px rgba(' + rgb + ',0.28)');
    put(name, 'transition', 'color ' + ease(120) + ', font-weight ' + ease(120));
    put(name, 'color', F);
    put(name, 'fontWeight', '700');
    put(cap, 'transition', 'color ' + ease(120));
    put(cap, 'color', F);
    put(dot, 'transition', 'transform ' + ease(120) + ', box-shadow ' + ease(120) + ', background ' + ease(120) + ', border-color ' + ease(120));
    put(dot, 'transform', 'scale(1.9)');
    put(dot, 'borderColor', F);
    put(dot, 'boxShadow', '0 0 0 3px rgba(' + rgb + ',0.3), 0 0 16px 3px rgba(' + rgb + ',0.55)');

    this.flashSaved = saved;
    this.flashTimers = [
      setTimeout(() => {
        saved.forEach(([el, css]) => {
          const t = el.style.transition;
          el.style.cssText = css;
          el.style.transition = t.replace(/120ms/g, '760ms');
        });
        this.flashTimers.push(setTimeout(() => this.restoreFlash(), 880));
      }, 520),
    ];
  }

  find(id) {
    let found = null;
    eng.walk(this.root, (n) => { if (n.id === id) found = n; });
    return found;
  }

  // ---- hover -----------------------------------------------------------

  setHi(id) {
    const n = this.find(id);
    if (!n) return;
    this.hi = [];
    for (const i of eng.lineage(n)) {
      const card = this.camEl.querySelector('[data-id="' + i + '"]');
      if (card) {
        const t = card.querySelector('.name');
        if (t) { this.hi.push([t, 'color', t.style.color]); t.style.color = this.pal.hover; }
      }
      const path = this.camEl.querySelector('[data-link="' + i + '"]');
      if (path) {
        this.hi.push([path, 'stroke', path.style.stroke], [path, 'strokeWidth', path.style.strokeWidth], [path, 'filter', path.style.filter]);
        path.style.stroke = this.pal.hover;
        path.style.strokeWidth = '2';
        path.style.filter = 'drop-shadow(0 0 4px ' + this.pal.hoverGlow + ')';
      }
    }
  }
  clearHi() { for (const [el, p, v] of this.hi) el.style[p] = v; this.hi = []; }

  showTip(card) {
    const n = this.byId.get(+card.dataset.id);
    // Nothing to say without dates — the name is already on screen.
    if (!n || !n.years) { this.hideTip(); return; }
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
  hideTip() { this.tip.style.opacity = '0'; this.tip.style.transform = 'translate(-9999px,-9999px)'; }
}

new Observatory().start();
