// Layout engine for the Rurikid tree.
// Guarantees: within a column, cards are separated by at least rowH (mean-of-extremes
// tidy layout over disjoint leaf ranges), and column width equals the widest label in
// that column, so labels can never collide vertically or horizontally.

let _ctx = null;
function measurer(font) {
  if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
  _ctx.font = font;
  return _ctx;
}

export function measure(text, font) {
  return measurer(font).measureText(text).width;
}

let _uid = 0;

export async function loadTree(url) {
  const raw = await (await fetch(url)).json();
  const root = adopt(raw, null, 0);
  index(root);
  return root;
}

// Drop the source file's invisible spacer rows; splice up children of any that had some.
function adopt(src, parent, depth) {
  const n = {
    id: ++_uid,
    name: src.name || '',
    birth: src.birth || '',
    death: src.death || '',
    depth, parent,
    kids: [],
    open: false,
    hidden: false,
  };
  const raws = src.children || [];
  const real = [];
  for (const c of raws) {
    if (!c.name && !(c.children && c.children.length)) continue;
    real.push(c);
  }
  n.kids = real.map(c => adopt(c, n, depth + 1));
  return n;
}

// One bottom-up pass: everybody below a node is that node's children plus
// everybody below them. Counting each subtree separately, from the top, costs
// a visit per ancestor per node — fifteen times the work on a tree this deep.
//
// The same pass files every node under its id. Ids are minted once, in adopt,
// and nothing ever renumbers, so the index is built here and never goes stale.
function index(root) {
  const byId = new Map();
  const count = (n) => {
    byId.set(n.id, n);
    return (n.total = n.kids.reduce((s, k) => s + 1 + count(k), 0));
  };
  count(root);
  root.byId = byId;
}

export function findByName(root, name) {
  let f = null;
  walk(root, (n) => { if (!f && n.name === name) f = n; });
  return f;
}

export function walk(n, fn) {
  fn(n);
  for (const k of n.kids) walk(k, fn);
}

export function shownKids(n) {
  return n.open ? n.kids.filter(k => !k.hidden) : [];
}

export function hiddenCount(n) {
  let c = 0;
  const rec = (m) => {
    for (const k of m.kids) {
      if (k.hidden || !m.open) { c += 1 + k.total; }
      else { c++; rec(k); }
    }
  };
  // count descendants not currently on screen
  c = 0;
  const stack = [n];
  while (stack.length) {
    const m = stack.pop();
    for (const k of m.kids) {
      if (!m.open || k.hidden) c += 1 + k.total;
      else stack.push(k);
    }
  }
  return c;
}

// Partial means *some* children are on screen and some are not. Hiding the
// last visible child is a fold, not a partial view, so it reads as one.
export function isPartial(n) {
  if (!n.kids.length || !n.open) return false;
  return n.kids.some(k => k.hidden) && n.kids.some(k => !k.hidden);
}

export function expandAll(n) { walk(n, m => { m.open = m.kids.length > 0; m.hidden = false; }); }
export function collapseAll(n) { walk(n, m => { m.open = false; m.hidden = false; }); }

export function expandDepth(n, gens) {
  const rec = (m, left) => {
    if (!m.kids.length || left <= 0) return;
    m.open = true;
    m.kids.forEach(k => { k.hidden = false; rec(k, left - 1); });
  };
  rec(n, gens);
}

export function toggle(n, gens) {
  if (!n.kids.length) return;
  if (n.open && !n.kids.some(k => k.hidden)) n.open = false;
  else expandDepth(n, gens || 1);
}

export function hide(n) {
  if (!n.parent || !n.parent.parent) return false; // keep top-level anchors
  n.hidden = true;
  return true;
}

export function lineage(n) {
  const out = [];
  let m = n;
  while (m && m.parent) { out.push(m.id); m = m.parent; }
  return out;
}

// Reingold–Tilford / Buchheim linear-time tidy layout over the *visible* subtree.
// Adjacent nodes on the same level end up at least `unit` apart (`unit * famGap`
// when they belong to different families), which is what makes label collisions
// impossible while still packing branches tightly.
function tidy(root, unit, famGap) {
  const W = new Map();
  const wrap = (n, parent, number) => {
    const w = { n, parent, number, kids: [], prelim: 0, mod: 0, shift: 0, change: 0, thread: null, anc: null };
    w.anc = w;
    W.set(n, w);
    shownKids(n).forEach((k, i) => w.kids.push(wrap(k, w, i)));
    return w;
  };
  const r = wrap(root, null, 0);

  const sep = (a, b) => (a.parent === b.parent ? unit : unit * famGap);
  const left = (v) => (v.kids.length ? v.kids[0] : v.thread);
  const right = (v) => (v.kids.length ? v.kids[v.kids.length - 1] : v.thread);
  const prev = (v) => (v.parent && v.number > 0 ? v.parent.kids[v.number - 1] : null);
  const ancestorOf = (vim, v, def) => (vim.anc.parent === v.parent ? vim.anc : def);

  function moveSubtree(wm, wp, shift) {
    const subtrees = wp.number - wm.number;
    wp.change -= shift / subtrees;
    wp.shift += shift;
    wm.change += shift / subtrees;
    wp.prelim += shift;
    wp.mod += shift;
  }
  function executeShifts(v) {
    let shift = 0, change = 0;
    for (let i = v.kids.length - 1; i >= 0; i--) {
      const w = v.kids[i];
      w.prelim += shift;
      w.mod += shift;
      change += w.change;
      shift += w.shift + change;
    }
  }
  function apportion(v, def) {
    const w = prev(v);
    if (!w) return def;
    let vip = v, vim = w, vop = v, vom = v.parent.kids[0];
    let sip = vip.mod, sim = vim.mod, sop = vop.mod, som = vom.mod;
    while (right(vim) && left(vip)) {
      vim = right(vim); vip = left(vip);
      vom = left(vom); vop = right(vop);
      vop.anc = v;
      const shift = (vim.prelim + sim) - (vip.prelim + sip) + sep(vim, vip);
      if (shift > 0) {
        moveSubtree(ancestorOf(vim, v, def), v, shift);
        sip += shift; sop += shift;
      }
      sim += vim.mod; sip += vip.mod;
      som += vom.mod; sop += vop.mod;
    }
    if (right(vim) && !right(vop)) { vop.thread = right(vim); vop.mod += sim - sop; }
    else if (left(vip) && !left(vom)) { vom.thread = left(vip); vom.mod += sip - som; return v; }
    return def;
  }
  function firstWalk(v) {
    if (!v.kids.length) {
      const w = prev(v);
      v.prelim = w ? w.prelim + sep(w, v) : 0;
      return;
    }
    let def = v.kids[0];
    for (const k of v.kids) { firstWalk(k); def = apportion(k, def); }
    executeShifts(v);
    const mid = (v.kids[0].prelim + v.kids[v.kids.length - 1].prelim) / 2;
    const w = prev(v);
    if (w) { v.prelim = w.prelim + sep(w, v); v.mod = v.prelim - mid; }
    else v.prelim = mid;
  }
  function secondWalk(v, m) {
    v.n.y = v.prelim + m;
    for (const k of v.kids) secondWalk(k, m + v.mod);
  }

  firstWalk(r);
  secondWalk(r, 0);

  let min = Infinity;
  W.forEach((w) => { if (w.parent) min = Math.min(min, w.n.y); });
  if (min === Infinity) min = 0;
  W.forEach((w) => { w.n.y -= min - unit / 2; });
}

// ---- layout -------------------------------------------------------------

export function layout(root, o) {
  const rowH = o.rowH, gapX = o.gapX, padX = o.padX;
  const vis = [];
  const collect = (n) => {
    for (const k of shownKids(n)) {
      vis.push(k);
      collect(k);
    }
  };
  collect(root);

  const ctx = measurer(o.font);
  const colW = [];
  for (const n of vis) {
    const partial = isPartial(n);
    const hidden = n.kids.length ? hiddenCount(n) : 0;
    // A partly-shown node says so in words underneath; a fully folded one
    // carries the count of everything it hides. Never both.
    const showBadge = n.kids.length > 0 && (!n.open || !shownKids(n).length);
    n._partial = partial;
    n._count = hidden;
    n._badge = showBadge;
    n._caption = partial
      ? 'показано ' + shownKids(n).length + ' из ' + n.kids.length + ' детей'
      : '';
    let w = ctx.measureText(n.name).width + padX * 2 +
      (showBadge ? o.badgeW + ctx.measureText(String(hidden)).width : 0);
    if (partial && o.captionFont) {
      ctx.font = o.captionFont;
      w = Math.max(w, ctx.measureText(n._caption).width + padX * 2);
      ctx.font = o.font;
    }
    n.w = Math.round(w);
    const d = n.depth - 1;
    colW[d] = Math.max(colW[d] || 0, n.w);
  }
  const colX = [];
  let acc = 0;
  for (let d = 0; d < colW.length; d++) { colX[d] = acc; acc += (colW[d] || 0) + gapX; }
  const width = Math.max(acc - gapX, 1);

  tidy(root, rowH, o.famGap == null ? 1.6 : o.famGap);

  // Safety net: order-preserving separation inside each column.
  const cols = [];
  for (const n of vis) { const d = n.depth - 1; (cols[d] || (cols[d] = [])).push(n); }
  for (const col of cols) {
    if (!col) continue;
    col.sort((a, b) => a.y - b.y);
    for (let i = 1; i < col.length; i++) {
      // A caption hangs below its own row, so the row under it needs the extra.
      const need = rowH + (col[i - 1]._partial ? (o.captionH || 0) : 0);
      if (col[i].y - col[i - 1].y < need) col[i].y = col[i - 1].y + need;
    }
  }

  const nodes = vis.map(n => {
    const d = n.depth - 1;
    // Some records store a literal "?" instead of an empty field; both mean
    // unknown, and a record unknown on both ends has nothing to show.
    const b = (n.birth || '').trim(), dth = (n.death || '').trim();
    const known = (v) => v && v !== '?';
    return {
      id: n.id, node: n, name: n.name, depth: n.depth,
      x: colX[d], y: Math.round(n.y), w: n.w, colW: colW[d],
      open: n.open, leaf: n.kids.length === 0,
      badge: n._badge, count: n._count, partial: n._partial, caption: n._caption,
      years: (known(b) || known(dth)) ? (known(b) ? b : '?') + ' — ' + (known(dth) ? dth : '?') : '',
    };
  });
  const byId = new Map(nodes.map(n => [n.id, n]));

  const links = [];
  for (const n of vis) {
    if (!n.parent || !n.parent.parent) continue;
    const p = byId.get(n.parent.id), c = byId.get(n.id);
    if (!p || !c) continue;
    const sx = p.x + p.w, sy = p.y, ex = c.x, ey = c.y;
    const mx = sx + (ex - sx) * 0.5;
    let d;
    if (sy === ey) d = `M${sx},${sy}H${ex}`;
    else if (o.ortho) {
      const g = ey > sy ? 1 : -1;
      const r = Math.min(7, Math.abs(ey - sy) / 2, Math.max(1, (mx - sx)), Math.max(1, (ex - mx)));
      d = `M${sx},${sy}H${mx - r}Q${mx},${sy} ${mx},${sy + g * r}V${ey - g * r}Q${mx},${ey} ${mx + r},${ey}H${ex}`;
    } else d = `M${sx},${sy}C${mx},${sy} ${mx},${ey} ${ex},${ey}`;
    links.push({ id: n.id, from: p.id, d });
  }

  let maxY = 0;
  for (const n of nodes) maxY = Math.max(maxY, n.y);
  return { nodes, links, width, height: maxY + rowH, colX, colW, count: vis.length };
}
