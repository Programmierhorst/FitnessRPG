// kampf_live.js – Echtzeit-Kampf (Hades-Stil) für FitnessRPG, wird von kampf.html geladen.
// Ablauf, Belohnungen, Dungeon- und Arena-Logik bleiben in kampf.html unverändert.
// Auf false setzen: überall wieder das alte Autobattler-System. Pro Kampf umgehen: kampf.html?...&live=0
window.LIVE_DEFAULT = true;

const LIVE = (function () {
  let AW = 1700, AH = 1000, K = .6;   // Kartengröße (wird je nach Hoch- oder Querformat in start() gesetzt) und Neigung der Ansicht
  const R = 16, WAVE = 500, ARROW = 520, DASHD = 75, DASHCD = 2.5, JR = 48;   // DASHCD: Sekunden bis eine Ausweich-Ladung zurückkommt, JR: Radius des festen Steuerkreises in Pixeln
  // Typ-Werte. f = Schadensfaktor pro Treffer, damit der Schaden pro Sekunde zu den alten Formeln passt
  const LT = {
    schild: { melee: 1, spd: 180, cd: .7, reach: 70, arc: 1.7, lock: .45, block: 6, f: 1.4, col: '#e05c2a' },
    zwei:   { melee: 1, spd: 180, cd: .8, reach: 65, arc: 1.7, lock: .3, combo: .12, f: .98, col: '#e8793a' },
    bogen:  { ranged: 1, spd: 175, cd: 1, range: 300, root: .6, slow: .1, f: 1.6, col: '#3aad6e' },
    magier: { area: 1, spd: 165, cd: 1.4, range: 240, len: 240, w: 70, cast: .35, root: .5, slow: .3, f: 2.1, col: '#5b7fe8' }
  };
  let cv, g, W = 800, H = 600, S = .8, camX = 0, camY = 0, inited = false, loopOn = false, last = 0;
  let U = [], AR = [], FL = [], A = null, B = null, over = true, cdT = 0, T = 0, AUTO = false;
  let keys = {}, held = 0, wd = 0, joy = null, jv = { x: 0, y: 0 }, names = ['', ''];
  const rnd = (a, c) => a + Math.random() * (c - a), clamp = (v, a, c) => Math.max(a, Math.min(c, v)), clr = (x, y) => Math.min(x, AW - x, y, AH - y);
  const P = (x, y) => [W / 2 + (x - camX) * S, H / 2 + (y - camY) * K * S];

  function typeOf(cls, s) { if (cls === 'archer') return 'bogen'; if (cls === 'mage') return 'magier'; return s.weaponSet === 'zwei' ? 'zwei' : 'schild'; }
  function mk(side, cls, s, lv, hp, max, px, py) {
    const type = typeOf(cls, s), c = LT[type], a = side === 'A';
    return { side, cls, s, lv, type, c, x: px, y: py, hp, max, fx: 1, fy: 0, inv: 0, ch: 2, rt: 0, dt: 0, dx: 0, dy: 0, at: a ? 0 : rnd(.3, 1), ro: 0, bk: 1, bt: 0, wt: 0, ax: 1, ay: 0, cq: 0, hand: 0, sw: 0, wave: null, sdt: 1, sd: Math.random() < .5 ? 1 : -1, run: 0, cbT: 0, dead: false, f: 0, isP: a && !AUTO };
  }
  const foe = u => (u === A ? B : A);
  function say(x, y, t, c) { FL.push({ x, y, t: .8, txt: t, c }); }

  // ── Schaden: die echten Formeln aus kampf.html (calcDmg / calcDef), Runde = Sekunde Kampfzeit ──
  function strike(a, t) {
    if (t.dead || t.inv > 0 || over) return;
    if (t.c.block && t.bk) { t.bk = 0; t.bt = 0; t.inv = .4; say(t.x, t.y - 30, 'Block', '#9fd0ff'); return; }
    const r = Math.floor(T) + 1, cd = calcDmg(a.cls, a.s, r, a.lv, t.cls), df = calcDef(a.cls, t.cls, t.s, a.s, r, t.lv);
    const net = Math.max(1, Math.round(cd.dmg * (1 - df) * a.c.f * 10) / 10);
    t.hp -= net; t.f = .1;
    say(t.x, t.y - 34, (net >= 10 ? Math.round(net) : net) + (cd.isCrit ? '!' : ''), cd.isCrit ? '#ffd36a' : (t === A ? '#ff9a9a' : '#fff'));
    if (t.hp <= 0) { t.hp = 0; t.dead = true; finish(t === B ? 'A' : 'B'); }
  }
  function finish(w) {
    if (over) return; over = true;
    window._winner = w; window._finalHpA = Math.max(0, A.hp);
    setTimeout(showResult, 1100);
  }

  // ── Angriffe ──
  function resolve(u, second) {
    const c = u.c, t = foe(u);
    if (c.melee) {
      u.sw = .16; let hit = false;
      if (!t.dead) { const dx = t.x - u.x, dy = t.y - u.y, d = Math.hypot(dx, dy); let da = Math.abs(Math.atan2(dy, dx) - Math.atan2(u.ay, u.ax)); if (da > Math.PI) da = 2 * Math.PI - da; if (d < c.reach && da < c.arc / 2) { strike(u, t); hit = true; } }
      if (!u.isP && hit) u.ro = c.lock;
      u.hand ^= 1; if (c.combo && !second) u.cq = c.combo;
    } else if (c.area) { u.wave = { x: u.x, y: u.y, dx: u.ax, dy: u.ay, f: 0, hit: false }; }
    else {
      if (!u.isP) aim(u);
      const a = Math.atan2(u.ay, u.ax) + (u.isP ? 0 : rnd(-.12, .12));
      AR.push({ x: u.x, y: u.y, dx: Math.cos(a), dy: Math.sin(a), l: 0, src: u });
    }
  }
  function aim(u) { const t = foe(u), dx = t.x - u.x, dy = t.y - u.y, d = Math.hypot(dx, dy) || 1; u.ax = dx / d; u.ay = dy / d; }
  function beginAttack(u) {
    const c = u.c, ai = !u.isP; aim(u); u.cbT = 0;
    if (c.melee) { u.at = ai ? c.cd * 1.25 + .35 : c.cd; u.wt = ai ? .35 : 0; u.ro = ai ? 0 : c.lock; u.f = ai ? .35 : 0; }
    else if (c.area) { u.at = ai ? c.cd * rnd(.7, 1.2) + c.cast : c.cd; u.wt = c.cast; u.ro = c.root; u.f = ai ? c.cast : 0; }
    else { u.at = ai ? c.cd * rnd(.7, 1.2) : c.cd; u.wt = ai ? .3 : 0; u.ro = c.root; u.f = ai ? .3 : 0; }
    if (u.wt <= 0) resolve(u);
  }
  function updWave(u, dt) {
    const w = u.wave, c = u.c, t = foe(u); w.f += WAVE * dt;
    if (!w.hit && !t.dead) { const rx = t.x - w.x, ry = t.y - w.y, al = rx * w.dx + ry * w.dy, pp = Math.abs(-rx * w.dy + ry * w.dx); if (al > 0 && al < c.len && pp < c.w / 2 && w.f >= al) { w.hit = true; strike(u, t); } }
    if (w.f >= c.len) u.wave = null;
  }

  // ── Steuerung ──
  function playerCtl(u) {
    const ix = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0) + jv.x, iy = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0) + jv.y;
    const m = Math.hypot(ix, iy), t = foe(u), c = u.c, ct = { mx: 0, my: 0, att: false, dash: null };
    if (m > .15) { ct.mx = ix; ct.my = iy; u.fx = ix / m; u.fy = iy / m; }
    if (wd) { wd = 0; ct.dash = m > .15 ? [ix / m, iy / m] : [u.fx, u.fy]; }
    if (held && !t.dead) {
      const d = Math.hypot(t.x - u.x, t.y - u.y);
      if (c.melee) { if (d < c.reach - 2) ct.att = true; else if (m <= .15 && u.ro <= 0 && u.dt <= 0) { ct.mx = (t.x - u.x) / d; ct.my = (t.y - u.y) / d; } }
      else ct.att = true;   // Fernkämpfer dürfen immer angreifen, auch wenn der Gegner noch außer Reichweite ist
    }
    return ct;
  }
  function fleeDir(u) {
    const t = foe(u), d0 = Math.hypot(t.x - u.x, t.y - u.y); let best = { x: 0, y: 0, sc: -1e9, gain: 0 };
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, vx = Math.cos(a), vy = Math.sin(a), ex = clamp(u.x + vx * 60, 30, AW - 30), ey = clamp(u.y + vy * 60, 30, AH - 30);
      const m = Math.hypot(t.x - ex, t.y - ey), sc = m + .5 * clr(ex, ey);
      if (sc > best.sc) best = { x: vx, y: vy, sc, gain: m - d0 };
    }
    return best;
  }
  function escapeDir(u) {
    const t = foe(u); let best = [1, 0], bs = -1e9;
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, vx = Math.cos(a), vy = Math.sin(a), ex = clamp(u.x + vx * DASHD, 30, AW - 30), ey = clamp(u.y + vy * DASHD, 30, AH - 30);
      const blk = Math.hypot(t.x - ex, t.y - ey) < 2 * R, sc = clr(ex, ey) + .3 * Math.hypot(t.x - ex, t.y - ey) - (blk ? 200 : 0);
      if (sc > bs) { bs = sc; best = [vx, vy]; }
    }
    return best;
  }
  function ai(u, dt) {
    const t = foe(u), c = u.c, ct = { mx: 0, my: 0, att: false, dash: null };
    if (t.dead) return ct;
    const dx = t.x - u.x, dy = t.y - u.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    u.sdt -= dt; if (u.sdt <= 0) { u.sd = -u.sd; u.sdt = rnd(1, 2.2); }
    if (c.melee) {
      ct.mx = ux; ct.my = uy;
      if (d > 100 && d < 300 && u.ch > 0 && u.dt <= 0 && Math.random() < dt * 5) { ct.dash = [ux, uy]; u.cbT = .6; }
      ct.att = (u.at <= 0 || u.cbT > 0) && d < c.reach + 20;
    } else {
      const lo = c.range * .57, hi = c.range * .87, fl = fleeDir(u), corner = Math.min(u.x, AW - u.x) < 110 && Math.min(u.y, AH - u.y) < 110, cornered = d < 140 && (fl.gain < 12 || (corner && d < 110));
      if (u.run > 0 || d < lo) { ct.mx = fl.x; ct.my = fl.y; } else if (d > hi) { ct.mx = ux; ct.my = uy; } else { ct.mx = -uy * u.sd; ct.my = ux * u.sd; }
      if (u.ch > 0 && u.dt <= 0 && (d < 100 || cornered)) { ct.dash = cornered ? escapeDir(u) : [fl.x, fl.y]; if (cornered) u.run = 1.2; }
      ct.att = u.at <= 0 && d < c.range && u.run <= 0 && Math.random() < dt * 3;
    }
    return ct;
  }

  // ── Ablauf eines Bildes ──
  function step(u, ct, dt) {
    const c = u.c;
    u.inv -= dt; u.at -= dt; u.ro -= dt; u.f -= dt; u.sw -= dt; u.cbT -= dt; u.run -= dt;
    if (c.block && !u.bk) { u.bt += dt; if (u.bt >= c.block) u.bk = 1; }
    if (u.ch < 2) { u.rt += dt; if (u.rt >= DASHCD) { u.ch++; u.rt = 0; } }
    if (ct.dash && u.ch > 0 && u.dt <= 0) { u.ch--; u.dt = .16; u.inv = .25; u.dx = ct.dash[0]; u.dy = ct.dash[1]; u.ro = 0; u.wt = 0; u.cq = 0; }
    if (u.wt > 0) { u.wt -= dt; if (u.wt <= 0) resolve(u); }
    if (u.cq > 0) { u.cq -= dt; if (u.cq <= 0) { if (u.isP) aim(u); resolve(u, true); } }
    if (u.wave) updWave(u, dt);
    if (u.dt > 0) { u.dt -= dt; u.x += u.dx * (DASHD / .16) * dt; u.y += u.dy * (DASHD / .16) * dt; }
    else {
      let mx = ct.mx, my = ct.my; const mm = Math.hypot(mx, my);
      if (mm > .01) { if (mm > 1) { mx /= mm; my /= mm; } const k = u.ro > 0 ? (c.slow || 0) : 1, sp = c.spd * (u.isP ? 1 : .9); u.x += mx * sp * k * dt; u.y += my * sp * k * dt; }
    }
    if (ct.att && (u.at <= 0 || u.cbT > 0) && u.dt <= 0 && u.wt <= 0 && u.cq <= 0 && !foe(u).dead) beginAttack(u);
  }
  function collide() {
    const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
    if (d < 2 * R) { const n = d || .01, px = (dx / n || 1) * (2 * R - d) / 2, py = (dy / n || 0) * (2 * R - d) / 2; A.x -= px; A.y -= py; B.x += px; B.y += py; }
    for (const u of U) { u.x = clamp(u.x, R, AW - R); u.y = clamp(u.y, R, AH - R); }
  }
  function update(dt) {
    if (over) { FL.forEach(f => { f.t -= dt; f.y -= 30 * dt; }); FL = FL.filter(f => f.t > 0); return; }
    if (cdT > 0) { cdT -= dt; wd = 0; return; }
    T += dt;
    for (const u of U) if (!u.dead) step(u, u.isP ? playerCtl(u) : ai(u, dt), dt);
    collide();
    for (const a of AR) {
      a.x += a.dx * ARROW * dt; a.y += a.dy * ARROW * dt; a.l += ARROW * dt;
      const t = foe(a.src);
      if (!t.dead && Math.hypot(t.x - a.x, t.y - a.y) < 20) { a.dead = 1; strike(a.src, t); }
      if (a.l > a.src.c.range) a.dead = 1;
    }
    AR = AR.filter(a => !a.dead);
    FL.forEach(f => { f.t -= dt; f.y -= 30 * dt; }); FL = FL.filter(f => f.t > 0);
    if (T > 150 && !over) finish(A.hp / A.max >= B.hp / B.max ? 'A' : 'B');
  }

  // ── Zeichnen ──
  function fit() {
    const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    cv.width = r.width * d; cv.height = r.height * d; g.setTransform(d, 0, 0, d, 0, 0);
    W = r.width; H = r.height;
    const portrait = H > W; K = portrait ? .8 : .6;
    S = Math.min(W / (portrait ? 480 : 900), H / (K * (portrait ? 700 : 520)));   // sichtbarer Kartenausschnitt, wie bei Handy-Mobas
  }
  function updCam(dt, snap) {
    if (!A) return;
    // Kamera folgt der Spielfigur und blickt leicht zum Gegner
    let vx = B.x - A.x, vy = B.y - A.y; const d = Math.hypot(vx, vy) || 1, m = Math.min(d * .25, 180);
    const tx = A.x + vx / d * m, ty = A.y + vy / d * m, k = snap ? 1 : Math.min(1, dt * 6);
    camX += (tx - camX) * k; camY += (ty - camY) * k;
    const hw = W / (2 * S), hh = H / (2 * K * S);
    camX = AW > 2 * hw ? clamp(camX, hw, AW - hw) : AW / 2;
    camY = AH > 2 * hh ? clamp(camY, hh, AH - hh) : AH / 2;
  }
  function ell(x, y, rx, ry, fill) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fillStyle = fill; g.fill(); }
  function fan(ox, oy, an, reach, arc, col) { const [sx, sy] = P(ox, oy); g.save(); g.translate(sx, sy); g.scale(1, K); g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, reach * S, an - arc / 2, an + arc / 2); g.closePath(); g.fillStyle = col; g.fill(); g.restore(); }
  function rect(ox, oy, an, w, col, from, to) { const [sx, sy] = P(ox, oy); g.save(); g.translate(sx, sy); g.scale(1, K); g.rotate(an); g.fillStyle = col; g.fillRect(from * S, -w / 2 * S, (to - from) * S, w * S); g.restore(); }
  function bar(sx, sy, w, frac, col) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 7); g.fillStyle = col; g.fillRect(sx - w / 2, sy, w * Math.max(0, frac), 5); }
  function draw() {
    g.fillStyle = '#080a0e'; g.fillRect(0, 0, W, H);
    const [a0, a1] = P(0, 0), [b0, b1] = P(AW, AH), wall = 46 * S * K / .6;
    g.fillStyle = 'rgba(17,21,32,.95)'; g.fillRect(a0 - 10, a1 - wall, b0 - a0 + 20, wall);
    const gr = g.createLinearGradient(0, a1, 0, b1); gr.addColorStop(0, '#171b25'); gr.addColorStop(1, '#0f1218'); g.fillStyle = gr; g.fillRect(a0, a1, b0 - a0, b1 - a1);
    g.strokeStyle = 'rgba(201,168,76,.07)'; g.lineWidth = 1;
    for (let x = 0; x <= AW; x += 100) { const [u, v] = P(x, 0), [w, z] = P(x, AH); g.beginPath(); g.moveTo(u, v); g.lineTo(w, z); g.stroke(); }
    for (let y = 0; y <= AH; y += 100) { const [u, v] = P(0, y), [w, z] = P(AW, y); g.beginPath(); g.moveTo(u, v); g.lineTo(w, z); g.stroke(); }
    g.strokeStyle = 'rgba(201,168,76,.5)'; g.lineWidth = 3; g.strokeRect(a0, a1, b0 - a0, b1 - a1);
    for (const u of U) {
      if (u.dead) continue;
      const c = u.c, e = u === B, warn = e ? 'rgba(224,82,108,.2)' : 'rgba(201,168,76,.16)', hot = e ? 'rgba(224,82,108,.5)' : 'rgba(201,168,76,.45)', an = Math.atan2(u.ay, u.ax);
      if (u.wt > 0) { if (c.melee) fan(u.x, u.y, an, c.reach, c.arc, warn); else if (c.area) rect(u.x, u.y, an, c.w, warn, 0, c.len); }
      if (u.sw > 0 && c.melee) fan(u.x, u.y, an, c.reach, c.arc, hot);
      if (u.wave) { const w = u.wave, wa = Math.atan2(w.dy, w.dx); rect(w.x, w.y, wa, c.w, warn, 0, c.len); rect(w.x, w.y, wa, c.w, hot, Math.max(0, w.f - 60), Math.min(w.f, c.len)); }
    }
    for (const u of U.filter(x => !x.dead).sort((p, q) => p.y - q.y)) {
      const [sx, sy] = P(u.x, u.y), c = u.c, fl = u.inv > 0 && Math.floor(u.inv * 20) % 2, body = sy - 22 * S;
      ell(sx, sy, R * S * 1.05, R * S * K * 1.05, 'rgba(0,0,0,.4)');
      if (c.ranged && u.wt > 0) { const k = 1 - u.wt / .3; ell(sx, body, (18 + 12 * k) * S, (22 + 12 * k) * S, 'rgba(255,215,100,' + (.2 + .4 * k) + ')'); }
      g.globalAlpha = fl ? .45 : 1; g.beginPath(); g.ellipse(sx, body, R * S, R * S * 1.1, 0, 0, 7); g.fillStyle = u.f > 0 ? '#f3d6dc' : c.col; g.fill();
      g.lineWidth = 3; g.strokeStyle = u === B ? '#e0526c' : '#c9a84c'; g.stroke(); g.globalAlpha = 1;
      if (c.block && u.bk) { g.strokeStyle = '#9fd0ff'; g.lineWidth = 2; g.beginPath(); g.ellipse(sx, body, (R + 7) * S, (R + 9) * S, 0, 0, 7); g.stroke(); }
      // Anzeigen über der Figur (wie bei Mobas): Name, Level, Leben, bei dir zusätzlich Dash und Block
      const bw = Math.max(54, 70 * S), by = body - R * S * 1.1 - 14, nm = names[u === B ? 1 : 0] + ' · Lv ' + u.lv;
      g.font = '600 ' + Math.max(10, 11 * S + 3) + 'px Cinzel, serif'; g.textAlign = 'center'; g.fillStyle = u === B ? '#e0826c' : '#e8c97a'; g.fillText(nm, sx, by - 6);
      bar(sx, by, bw, u.hp / u.max, u === B ? '#c0392b' : (u.hp / u.max < .25 ? '#c0392b' : '#27ae60'));
      g.font = '600 10px Cinzel, serif'; g.fillStyle = '#e8dcc8'; g.fillText(Math.ceil(u.hp) + ' / ' + u.max, sx, by + 17);
      if (u === A) {
        for (let i = 0; i < 2; i++) { g.fillStyle = i < u.ch ? '#e8993a' : '#4a3f5c'; g.fillRect(sx - 20 + i * 22, by + 21, 18, 5); }
        if (c.block) { g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(sx - 20, by + 28, 40, 4); g.fillStyle = u.bk ? '#9fd0ff' : '#5d7a99'; g.fillRect(sx - 20, by + 28, 40 * (u.bk ? 1 : u.bt / c.block), 4); }
      }
    }
    for (const a of AR) { const [sx, sy] = P(a.x, a.y); ell(sx, sy, 5 * S, 3 * S * K, 'rgba(0,0,0,.4)'); g.strokeStyle = a.src === B ? '#e0526c' : '#e8c97a'; g.lineWidth = 3; g.beginPath(); g.moveTo(sx, sy - 22 * S); g.lineTo(sx - a.dx * 14 * S, sy - 22 * S - a.dy * 14 * S * K); g.stroke(); }
    for (const f of FL) { const [sx, sy] = P(f.x, f.y); g.globalAlpha = Math.min(1, f.t * 2); g.fillStyle = f.c; g.font = 'bold ' + Math.max(15, 14 * S + 6) + 'px Cinzel, serif'; g.textAlign = 'center'; g.fillText(f.txt, sx, sy); g.globalAlpha = 1; }
    // Pfeil am Bildschirmrand, wenn der Gegner außerhalb des Bildes ist
    if (!B.dead) {
      const [ex, ey] = P(B.x, B.y), m = 34;
      if (ex < m || ex > W - m || ey < m + 30 || ey > H - m) {
        const dx = ex - W / 2, dy = ey - H / 2, k = Math.min((W / 2 - m) / Math.abs(dx || 1e-6), (H / 2 - m - 20) / Math.abs(dy || 1e-6)), px = W / 2 + dx * k, py = H / 2 + dy * k + 10, an = Math.atan2(dy, dx);
        g.save(); g.translate(px, py); g.rotate(an); g.fillStyle = 'rgba(224,82,108,.9)'; g.beginPath(); g.moveTo(14, 0); g.lineTo(-8, -10); g.lineTo(-8, 10); g.closePath(); g.fill(); g.restore();
        g.font = '600 10px Cinzel, serif'; g.fillStyle = '#e8dcc8'; g.textAlign = 'center'; g.fillText(Math.round(Math.hypot(B.x - A.x, B.y - A.y) / 10) + ' m', px, py + 24);
      }
    }
    // kleine Übersichtskarte oben rechts
    { const mw = Math.min(110, W * .3), mh = mw * AH / AW, mx = W - mw - 10, my = 40;
      g.fillStyle = 'rgba(8,10,14,.6)'; g.fillRect(mx, my, mw, mh); g.strokeStyle = 'rgba(201,168,76,.5)'; g.lineWidth = 1; g.strokeRect(mx, my, mw, mh);
      const hw = W / (2 * S) / AW * mw, hh = H / (2 * K * S) / AH * mh; g.strokeStyle = 'rgba(255,255,255,.25)'; g.strokeRect(mx + camX / AW * mw - hw, my + camY / AH * mh - hh, hw * 2, hh * 2);
      for (const u of U) { if (u.dead) continue; g.fillStyle = u === B ? '#e0526c' : '#e8c97a'; g.beginPath(); g.arc(mx + u.x / AW * mw, my + u.y / AH * mh, 3, 0, 7); g.fill(); } }
    g.textAlign = 'center';
    if (cdT > 0 && !over) { g.fillStyle = '#e8dcc8'; g.font = 'bold 24px Cinzel, serif'; g.fillText('Kampfbeginn in ' + Math.max(0, cdT).toFixed(1) + ' s', W / 2, H / 2 - 90); }
    { const [jx, jy] = jc(); g.strokeStyle = 'rgba(232,220,200,' + (joy ? .55 : .3) + ')'; g.lineWidth = 2; g.beginPath(); g.arc(jx, jy, JR, 0, 7); g.stroke(); g.fillStyle = 'rgba(232,220,200,' + (joy ? .12 : .05) + ')'; g.fill(); g.fillStyle = 'rgba(232,220,200,' + (joy ? .5 : .3) + ')'; g.beginPath(); g.arc(jx + jv.x * JR, jy + jv.y * JR, 24, 0, 7); g.fill(); }
  }
  function frame(dt) { update(dt); updCam(dt, false); draw(); }
  function loop(t) { const dt = Math.min(.05, (t - last) / 1000); last = t; frame(dt); requestAnimationFrame(loop); }

  // ── Eingabe (Tasten nach Position, nicht nach Zeichen) ──
  const KM = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', ArrowUp: 'arrowup', ArrowDown: 'arrowdown', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright', KeyJ: 'j', Space: ' ', KeyK: 'k', ShiftLeft: 'shift', ShiftRight: 'shift' };
  // Mittelpunkt des festen Steuerkreises (unten links) und Richtung aus der Fingerposition
  const jc = () => [JR + 25, H - JR - 25];   // 25 Pixel Abstand zum linken und zum unteren Bildschirmrand
  function setJoy(e) {
    const [cx, cy] = jc(), dx = e.clientX - cx, dy = e.clientY - cy, d = Math.hypot(dx, dy);
    if (d < 10) { jv = { x: 0, y: 0 }; return; }   // kleine tote Zone in der Mitte
    const k = Math.min(1, d / JR); jv = { x: dx / d * k, y: dy / d * k };
  }
  function init() {
    if (inited) return; inited = true;
    cv = document.getElementById('c'); g = cv.getContext('2d'); addEventListener('resize', fit);
    addEventListener('keydown', e => { const k = KM[e.code]; if (!k) return; e.preventDefault(); if (k === 'j' || k === ' ') held = 1; else if ((k === 'k' || k === 'shift') && !e.repeat) wd = 1; keys[k] = 1; });
    addEventListener('keyup', e => { const k = KM[e.code]; if (!k) return; if (k === 'j' || k === ' ') held = 0; keys[k] = 0; });
    addEventListener('blur', () => { keys = {}; held = 0; wd = 0; });
    // Fester Steuerkreis unten links. Berührt wird irgendwo auf der linken Bildschirmseite, die Richtung ergibt sich vom Mittelpunkt des Kreises zum Finger, auch wenn der Finger weit außerhalb liegt
    cv.addEventListener('pointerdown', e => { if (e.clientX < innerWidth * .6 && !joy) { joy = { id: e.pointerId }; setJoy(e); try { cv.setPointerCapture(e.pointerId); } catch (_) { } } });
    addEventListener('pointermove', e => { if (joy && joy.id === e.pointerId) setJoy(e); });
    const endJoy = e => { if (joy && joy.id === e.pointerId) { joy = null; jv = { x: 0, y: 0 }; } };
    addEventListener('pointerup', endJoy); addEventListener('pointercancel', endJoy);
    const ba = document.getElementById('ba'), bd = document.getElementById('bd');
    ba.addEventListener('pointerdown', () => held = 1); ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => ba.addEventListener(t, () => held = 0));
    bd.addEventListener('pointerdown', () => wd = 1);
  }

  // ── Kampfstart (wird für jeden Kampf aufgerufen, auch Dungeon-Folgekämpfe) ──
  function start(startHp) {
    init();
    const maxA = maxLP(sA.lebenskraft, lvA, (sA.lebenskraft_bonus || 0) * 8), maxB = maxLP(sB.lebenskraft, lvB, (sB.lebenskraft_bonus || 0) * 8);
    const hpA = (typeof startHp === 'number') ? Math.min(startHp, maxA) : maxA;
    const portrait = (innerHeight || 700) > (innerWidth || 400);
    if (portrait) { AW = 1000; AH = 1700; } else { AW = 1700; AH = 1000; }
    const gap = 450;   // Abstand der Startpositionen zum Kartenrand, die Gegner starten dadurch etwa 800 Einheiten auseinander
    const pa = portrait ? [AW / 2, AH - gap] : [gap, AH / 2], pb = portrait ? [AW / 2, gap] : [AW - gap, AH / 2];
    A = mk('A', clsA, sA, lvA, hpA, maxA, pa[0], pa[1]); B = mk('B', clsB, sB, lvB, maxB, maxB, pb[0], pb[1]);
    A.fx = B.x > A.x ? 1 : 0; A.fy = B.y > A.y ? 1 : (B.y < A.y ? -1 : 0); B.fx = -A.fx; B.fy = -A.fy;
    names = [MODE === 'arena' ? (arenaSession.playerName || sA.name) : sA.name, MODE === 'arena' ? (sB.displayName || sB.name) : sB.name];
    U = [A, B]; AR = []; FL = []; over = false; cdT = 1.5; T = 0; wd = 0; held = 0;
    window._maxA = maxA; window._maxB = maxB; window._winner = null;
    fit(); camX = A.x; camY = A.y; updCam(0, true);
    if (!loopOn) { loopOn = true; last = performance.now(); requestAnimationFrame(loop); }
  }
  // Für automatische Tests: Spielerfigur von der KI steuern lassen und ohne Zeichnen simulieren
  function auto(v) { AUTO = !!v; }
  function sim(maxSec) { let t = 0; cdT = 0; while (!over && t < (maxSec || 200)) { update(1 / 60); t += 1 / 60; } return { winner: window._winner, t, hpA: A.hp, hpB: B.hp }; }
  return { start, auto, sim, frame, lt: LT, get units() { return U; }, get cam() { return { x: camX, y: camY, w: AW, h: AH, S, K, W, H }; } };
})();

// Wird von kampf.html statt der alten Simulation aufgerufen
window.__liveInit = function () {
  const arena = document.querySelector('.arena'); if (arena) arena.style.display = 'none';
  const ui = document.getElementById('liveUI'); ui.style.display = 'block';
  let startHp;
  let label = 'Kampf';
  if (MODE === 'dungeon') {
    const total = dungeonSession.enemies.length, isBoss = dungeonFightIdx === total - 1;
    if (!isBoss && dungeonCarryHP !== null) startHp = dungeonCarryHP;
    label = isBoss ? `Endgegner – Dungeon ${dungeonSession.dungeonNum}` + (dungeonFightIdx > 0 ? ' (voll geheilt)' : '') : `Gegner ${dungeonFightIdx + 1}/${total - 1} – Dungeon ${dungeonSession.dungeonNum}`;
  } else if (MODE === 'arena') {
    label = `⚔️ Arena-Kampf gegen ${arenaSession.defenderRank}-Rang`;
  }
  document.getElementById('liveBadge').textContent = label;
  running = true;
  LIVE.start(startHp);
};
