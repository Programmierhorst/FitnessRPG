// kampf_3d.js – 3D-Darstellung der Kampf-Arena mit three.js (r128). Reine Optik: Kampflogik, Schaden und Steuerung bleiben in kampf_live.js.
// Koordinaten: Spielfeld x -> three.js X, Spielfeld y -> three.js Z, Höhe -> Y. Die Kamera hängt fest schräg über der Karte (wie bei Hades).
// Ausschalten: &3d=0 an die URL hängen oder in kampf_live.js window.LIVE3D = false setzen. Fehlt three.js oder WebGL, bleibt automatisch die 2D-Ansicht.
window.R3D = (function () {
  const FOV = 24, TAN = Math.tan(FOV * Math.PI / 360), R = 16;
  let ren = null, scene = null, cam = null, dirL = null, stat = null, key = '', W = 800, H = 600, vec = null;
  let objs = [], arrows = [], torchL = [], flames = [], lastNow = 0, perf = { n: 0, acc: 0, done: false };
  const G = {}, M = {};
  const hs = (i, j) => { const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return n - Math.floor(n); };   // fester Zufallswert pro Stein
  const keep = o => { o.userData.keep = true; return o; };

  function makeShared() {
    const T = THREE;
    G.body = keep(new T.CylinderGeometry(10, 13, 30, 10));
    G.head = keep(new T.SphereGeometry(8, 12, 10));
    G.hat = keep(new T.ConeGeometry(10, 18, 8));
    G.ring = keep(new T.RingGeometry(R * 1.1, R * 1.35, 28).rotateX(-Math.PI / 2));
    G.ring2 = keep(new T.RingGeometry(R * 1.5, R * 1.7, 28).rotateX(-Math.PI / 2));
    G.blob = keep(new T.CircleGeometry(R * 1.05, 20).rotateX(-Math.PI / 2));
    G.sword = keep(new T.BoxGeometry(32, 3, 5).translate(18, 0, 0));
    G.sword2 = keep(new T.BoxGeometry(46, 4, 7).translate(26, 0, 0));
    G.guard = keep(new T.BoxGeometry(4, 3, 14));
    G.shield = keep(new T.CylinderGeometry(12, 12, 3, 14).rotateZ(Math.PI / 2));
    G.bow = keep(new T.TorusGeometry(15, 1.4, 6, 14, Math.PI).rotateZ(-Math.PI / 2));
    G.staff = keep(new T.CylinderGeometry(1.6, 1.6, 58, 6));
    G.orb = keep(new T.SphereGeometry(5.5, 10, 8));
    G.arrow = keep(new T.CylinderGeometry(1.4, 1.4, 24, 5).rotateZ(-Math.PI / 2));
    G.rect = keep(new T.PlaneGeometry(1, 1).translate(.5, 0, 0).rotateX(-Math.PI / 2));   // liegt flach, Ursprung am Anfang der Fläche
    G.circ = {};
    G.flame = keep(new T.SphereGeometry(5, 8, 6));
    G.pil = keep(new T.CylinderGeometry(20, 22, 1, 10));   // Höhe wird über scale.y gesetzt
    G.box = keep(new T.BoxGeometry(1, 1, 1));              // Größe wird über scale gesetzt
    M.arrA = new T.MeshBasicMaterial({ color: 0xe8c97a });
    M.arrB = new T.MeshBasicMaterial({ color: 0xe0526c });
    M.flame = new T.MeshBasicMaterial({ color: 0xffb347 });
    M.stone = new T.MeshLambertMaterial({ color: 0x4a5166 });
    M.dark = new T.MeshLambertMaterial({ color: 0x2a2218 });
  }
  const circ = arc => G.circ[arc] || (G.circ[arc] = keep(new THREE.CircleGeometry(1, 24, -arc / 2, arc).rotateX(-Math.PI / 2)));

  function init(cv) {
    if (ren) { ren.domElement.style.display = ''; return true; }
    if (!window.THREE) return false;
    const T = THREE;
    try { ren = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch (e) { ren = null; return false; }
    try {
      ren.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      ren.setClearColor(0x080a0e, 1);
      ren.shadowMap.enabled = true; ren.shadowMap.type = T.PCFSoftShadowMap;
      ren.domElement.style.pointerEvents = 'none';
      cv.parentNode.insertBefore(ren.domElement, cv);   // liegt hinter dem 2D-Canvas, das nur noch die Anzeigen zeichnet
      scene = new T.Scene(); scene.fog = new T.Fog(0x080a0e, 1500, 5000);
      cam = new T.PerspectiveCamera(FOV, 1, 50, 9000); vec = new T.Vector3();
      scene.add(new T.HemisphereLight(0x8a98d0, 0x1c1812, 1));
      dirL = new T.DirectionalLight(0xb4c0f0, .9); dirL.castShadow = true; dirL.shadow.mapSize.set(2048, 2048); dirL.shadow.bias = -.0006;
      scene.add(dirL); scene.add(dirL.target);
      makeShared();
    } catch (e) { console.warn('3D-Start fehlgeschlagen, 2D-Ansicht wird benutzt', e); try { ren.domElement.remove(); } catch (_) { } ren = null; return false; }
    return true;
  }
  function hide() { if (ren) ren.domElement.style.display = 'none'; }

  function kill(obj) {
    obj.traverse(n => {
      if (n.geometry && !n.geometry.userData.keep) n.geometry.dispose();
      if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => { if (m.userData.keep) return; if (m.map) m.map.dispose(); m.dispose(); });
    });
    if (obj.parent) obj.parent.remove(obj);
  }

  // ── Texturen werden im Code gezeichnet (kein Bild nötig) ──
  function floorTex(AW, AH) {
    const N = 2048, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d'), sx = N / AW, sy = N / AH, TW = 100, TH = 50;
    x.fillStyle = '#0f121a'; x.fillRect(0, 0, N, N);
    for (let j = 0; j * TH < AH; j++) {
      const off = (j % 2) * TW / 2;
      for (let i = 0; i * TW - off < AW; i++) {
        const X = (i * TW - off) * sx, Y = j * TH * sy, w = TW * sx, h = TH * sy, l = 30 + Math.floor(hs(i, j) * 16);
        x.fillStyle = 'rgb(' + l + ',' + (l + 4) + ',' + (l + 13) + ')'; x.fillRect(X, Y, w, h);
        x.fillStyle = 'rgba(255,255,255,.05)'; x.fillRect(X, Y, w, 2 * sy);
        x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(X, Y + h - 2 * sy, w, 2 * sy); x.fillRect(X + w - 2 * sx, Y, 2 * sx, h);
        if (hs(i + 7, j + 3) > .93) { x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(X + w * .25, Y + h * .1); x.lineTo(X + w * .45, Y + h * .5); x.lineTo(X + w * .4, Y + h * .9); x.stroke(); }
      }
    }
    x.save(); x.translate(N / 2, N / 2); x.scale(sx, sy); x.strokeStyle = 'rgba(201,168,76,.22)'; x.lineWidth = 3;   // Rune in der Mitte
    for (const r of [150, 190]) { x.beginPath(); x.arc(0, 0, r, 0, 7); x.stroke(); }
    x.lineWidth = 2; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; x.beginPath(); x.moveTo(Math.cos(a) * 150, Math.sin(a) * 150); x.lineTo(Math.cos(a) * 190, Math.sin(a) * 190); x.stroke(); }
    x.restore();
    const t = new THREE.CanvasTexture(c); t.anisotropy = Math.min(8, ren.capabilities.getMaxAnisotropy()); return t;
  }
  function wallTex() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d');
    x.fillStyle = '#14171f'; x.fillRect(0, 0, 512, 256);
    for (let r = 0; r < 4; r++) {
      const off = (r % 2) * 64;
      for (let i = -1; i < 5; i++) {
        const X = i * 128 + off, l = 44 + Math.floor(hs(i + 9, r) * 18);
        x.fillStyle = 'rgb(' + l + ',' + (l + 4) + ',' + (l + 14) + ')'; x.fillRect(X + 2, r * 64 + 2, 124, 60);
        x.fillStyle = 'rgba(255,255,255,.06)'; x.fillRect(X + 2, r * 64 + 2, 124, 3);
      }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  // ── Arena: Boden, Wände, Säulen, Fackeln ──
  function buildStatic(AW, AH) {
    const T = THREE;
    if (stat) kill(stat);
    stat = new T.Group(); scene.add(stat); torchL = []; flames = [];
    const floor = new T.Mesh(new T.PlaneGeometry(AW, AH).rotateX(-Math.PI / 2), new T.MeshLambertMaterial({ map: floorTex(AW, AH) }));
    floor.position.set(AW / 2, 0, AH / 2); floor.receiveShadow = true; stat.add(floor);
    const bt = wallTex();
    const wm = (rx, ry) => { const t = bt.clone(); t.repeat.set(rx, ry); t.needsUpdate = true; return new T.MeshLambertMaterial({ map: t }); };
    const box = (w, h, d, x, y, z, mat, shadow) => { const m = new T.Mesh(G.box, mat); m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = !!shadow; m.receiveShadow = true; stat.add(m); return m; };
    box(AW + 60, 150, 30, AW / 2, 75, -15, wm((AW + 60) / 300, 1.15), true);          // Rückwand
    box(30, 70, AH + 60, -15, 35, AH / 2, wm((AH + 60) / 300, .54), true);             // linke Mauer
    box(30, 70, AH + 60, AW + 15, 35, AH / 2, wm((AH + 60) / 300, .54), true);         // rechte Mauer
    box(AW + 60, 8, 30, AW / 2, 4, AH + 15, wm((AW + 60) / 300, .06), false);          // flache Kante vorne, damit sie keine Figuren verdeckt
    const pillar = (x, z, h) => {
      const p = new T.Mesh(G.pil, M.stone); p.scale.set(1, h, 1); p.position.set(x, h / 2, z); p.castShadow = p.receiveShadow = true; stat.add(p);
      box(54, 12, 54, x, h + 6, z, M.stone, true); box(52, 12, 52, x, 6, z, M.stone, true);
    };
    for (let k = 0; k <= 4; k++) {
      const x = AW * k / 4; pillar(x, 8, 190);
      const br = box(6, 6, 16, x, 118, 33, M.dark, false);   // Fackelhalter
      const f = new T.Mesh(G.flame, M.flame); f.position.set(x, 128, 36); f.scale.set(1, 1.6, 1); stat.add(f); flames.push(f);
      if (k >= 1 && k <= 3) { const l = new T.PointLight(0xff9640, 1.3, 700, 1.5); l.position.set(x, 130, 60); stat.add(l); torchL.push({ l }); }
    }
    for (const z of [AH / 3, AH * 2 / 3]) { pillar(-4, z, 120); pillar(AW + 4, z, 120); }
    const ext = Math.max(AW, AH) / 2 + 120, sc = dirL.shadow.camera;   // Schattenbereich = Spielfeld
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 10; sc.far = 3500; sc.updateProjectionMatrix();
    dirL.position.set(AW / 2 - 500, 600, AH / 2 + 520); dirL.target.position.set(AW / 2, 0, AH / 2);
  }

  // ── Figuren und Angriffsflächen ──
  function mkUnit(u) {
    const T = THREE, c = u.c, grp = new T.Group(), fig = new T.Group(), piv = new T.Group();
    const lam = col => new T.MeshLambertMaterial({ color: col });
    const mB = lam(c.col), mH = lam(0xd9b38c), mW = lam(0xc4c8d4), mD = lam(0x5a4630);
    const add = (geo, mat, x, y, z, par) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; (par || fig).add(m); return m; };
    add(G.body, mB, 0, 17, 0); add(G.head, mH, 0, 39, 0);
    piv.position.set(6, 26, 11); fig.add(piv);   // Waffenarm, lokal zeigt +X nach vorn
    let orb = null;
    if (u.type === 'schild') { add(G.sword, mW, 0, 0, 0, piv); add(G.guard, mD, 2, 0, 0, piv); add(G.shield, mW, 9, 22, -13); }
    else if (u.type === 'zwei') { add(G.sword2, mW, 0, 0, 0, piv); add(G.guard, mD, 3, 0, 0, piv); }
    else if (u.type === 'bogen') { add(G.bow, mD, 6, 0, 0, piv); }
    else { add(G.staff, mD, 0, 3, 0, piv); orb = add(G.orb, new T.MeshBasicMaterial({ color: c.col }), 0, 34, 0, piv); add(G.hat, mB, 0, 55, 0); }
    const bm = (col, a) => new T.MeshBasicMaterial({ color: col, transparent: true, opacity: a, depthWrite: false });
    const ring = new T.Mesh(G.ring, bm(u.side === 'B' ? 0xe0526c : 0xc9a84c, .9)); ring.position.y = .6;
    const blob = new T.Mesh(G.blob, bm(0x000000, .4)); blob.position.y = .4;
    const blk = new T.Mesh(G.ring2, bm(0x9fd0ff, .8)); blk.position.y = .7; blk.visible = false;
    grp.add(blob, ring, blk, fig); scene.add(grp);
    const dm = (col, a) => new T.MeshBasicMaterial({ color: col, transparent: true, opacity: a, depthWrite: false, side: T.DoubleSide });
    const rd = u.side === 'B', warn = rd ? dm(0xe0526c, .3) : dm(0xc9a84c, .26), hot = rd ? dm(0xe0526c, .65) : dm(0xc9a84c, .6);
    const q = { u, grp, fig, piv, orb, blk, mats: [mB, mH], em: 0, face: 0, px: u.x, py: u.y, bob: 0, dec: [] };
    if (c.melee) { q.fanW = new T.Mesh(circ(c.arc), warn); q.fanH = new T.Mesh(circ(c.arc), hot); }
    if (c.area) { q.rcW = new T.Mesh(G.rect, warn); q.rcH = new T.Mesh(G.rect, hot); }
    for (const m of [q.fanW, q.fanH, q.rcW, q.rcH]) if (m) { m.visible = false; m.position.y = 1; scene.add(m); q.dec.push(m); }
    return q;
  }
  function build(AW, AH, U) {
    if (!ren) return;
    const k = AW + 'x' + AH; if (k !== key) { buildStatic(AW, AH); key = k; }
    for (const q of objs) { kill(q.grp); q.dec.forEach(kill); }
    objs = U.map(mkUnit);
    for (const q of objs) { const f = q.u === U[0] ? U[1] : U[0]; q.face = Math.atan2(f.y - q.u.y, f.x - q.u.x); }
  }
  function resize(w, h) { if (!ren) return; W = w; H = h; ren.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  function project(x, y, h) { if (!cam) return [0, 0]; vec.set(x, h, y).project(cam); return [(vec.x + 1) / 2 * W, (1 - vec.y) / 2 * H]; }
  function setRect(m, x, y, dx, dy, from, to, wid) { m.position.set(x + dx * from, 1.1, y + dy * from); m.rotation.y = -Math.atan2(dy, dx); m.scale.set(Math.max(.01, to - from), 1, wid); }
  function degrade() {   // Bei langsamen Geräten: Schatten und hohe Auflösung abschalten
    ren.shadowMap.enabled = false; dirL.castShadow = false; ren.setPixelRatio(1); ren.setSize(W, H, false);
    scene.traverse(n => { if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => { m.needsUpdate = true; }); });
  }

  function render(o) {
    if (!ren) return;
    const now = performance.now() / 1000, raw = Math.min(.2, now - lastNow || .016), dt = Math.min(.05, raw); lastNow = now;
    W = o.W; H = o.H;
    // Kamera: schräg von Süden, Neigung aus K (Seitenverhältnis der alten 2D-Ansicht), Abstand so, dass der Maßstab S passt
    const th = Math.asin(Math.min(.98, o.K)), d = H / (2 * o.S * TAN);
    cam.position.set(o.camX, d * Math.sin(th), o.camY + d * Math.cos(th)); cam.lookAt(o.camX, 0, o.camY);
    cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    scene.fog.near = d * 1.05; scene.fog.far = d * 2.6;
    const now2 = now, U = o.U;
    torchL.forEach((t, i) => { t.l.intensity = 1.25 + .35 * Math.sin(now2 * 9 + i * 2.3) * Math.sin(now2 * 5.3 + i); });
    flames.forEach((f, i) => { const s = 1 + .18 * Math.sin(now2 * 11 + i * 1.7); f.scale.set(s, 1.6 * s, s); });
    for (const q of objs) {
      const u = q.u, c = u.c, foe = u === U[0] ? U[1] : U[0];
      q.grp.visible = !u.dead;
      if (u.dead) { q.dec.forEach(m => { m.visible = false; }); continue; }
      q.grp.position.set(u.x, 0, u.y);
      // Blickrichtung zum Gegner, weich nachgeführt
      let df = Math.atan2(foe.y - u.y, foe.x - u.x) - q.face; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI;
      q.face += df * Math.min(1, dt * 16); q.grp.rotation.y = -q.face;
      // Laufwippen, Ausweichneigung, Waffenschwung
      const spd = Math.hypot(u.x - q.px, u.y - q.py) / Math.max(dt, .001); q.px = u.x; q.py = u.y; q.bob += dt * spd * .09;
      q.fig.position.y = Math.abs(Math.sin(q.bob)) * 2.2 * Math.min(1, spd / 80);
      q.fig.rotation.z = u.dt > 0 ? -.35 : 0;
      if (c.melee) q.piv.rotation.y = u.sw > 0 ? -1.1 + 2.2 * (1 - u.sw / .16) : -.25;
      if (q.orb) { const s = 1 + (u.wt > 0 ? .6 : 0) + .15 * Math.sin(now2 * 8); q.orb.scale.set(s, s, s); }
      // Farbe: Treffer/Anlauf hell, Ausweichen bläulich
      const em = u.f > 0 ? 0x99606e : (u.inv > 0 && Math.floor(u.inv * 20) % 2 ? 0x2a3a55 : 0);
      if (em !== q.em) { q.em = em; q.mats.forEach(m => m.emissive.setHex(em)); }
      q.blk.visible = !!(c.block && u.bk);
      // Angriffsflächen auf dem Boden
      const an = Math.atan2(u.ay, u.ax);
      if (q.fanW) { q.fanW.visible = u.wt > 0; q.fanH.visible = u.sw > 0; for (const m of [q.fanW, q.fanH]) { m.position.set(u.x, 1, u.y); m.rotation.y = -an; m.scale.set(c.reach, 1, c.reach); } }
      if (q.rcW) {
        let vw = false, vh = false;
        if (u.wave) { const w = u.wave; setRect(q.rcW, w.x, w.y, w.dx, w.dy, 0, c.len, c.w); setRect(q.rcH, w.x, w.y, w.dx, w.dy, Math.max(0, w.f - 60), Math.min(w.f, c.len), c.w); vw = vh = true; }
        else if (u.wt > 0) { setRect(q.rcW, u.x, u.y, u.ax, u.ay, 0, c.len, c.w); vw = true; }
        q.rcW.visible = vw; q.rcH.visible = vh;
      }
    }
    const AR = o.AR;
    while (arrows.length < AR.length) { const m = new THREE.Mesh(G.arrow, M.arrA); scene.add(m); arrows.push(m); }
    arrows.forEach((m, i) => { const a = AR[i]; m.visible = !!a; if (a) { m.position.set(a.x, 24, a.y); m.rotation.y = -Math.atan2(a.dy, a.dx); m.material = a.src.side === 'B' ? M.arrB : M.arrA; } });
    ren.render(scene, cam);
    if (!perf.done && ++perf.n > 40) { perf.acc += raw; if (perf.n >= 160) { perf.done = true; if (perf.acc / 120 > .034) degrade(); } }
  }

  return { init, hide, build, resize, render, project };
})();
