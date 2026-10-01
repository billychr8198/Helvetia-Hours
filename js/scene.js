/* =========================================================
   Helvetia Hours — 3D Swiss valley (three.js r158, classic script)
   Mountains, a river and lake, a growing village, a red train on a
   stone viaduct, a cable car, cows, clouds, an eagle, a waterfall,
   a waving flag and a Matterhorn-like peak at the end of the valley.
   The time of day follows the timer mode.
   ========================================================= */
(function () {
  'use strict';
  var T = window.THREE;
  var API = {
    available: false, init: init, setMode: setMode, setQuality: setQuality,
    setVillageSize: setVillageSize, setExplore: setExplore, celebrate: celebrate,
    pause: function () { paused = true; }, resume: function () { if (paused) { paused = false; lastFrame = 0; } },
    onPick: null
  };
  window.SwissScene = API;
  if (!T) return;

  /* ---------------- noise helpers ---------------- */
  function hash(ix, iy) {
    var h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    var a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function fbm(x, y, oct) {
    var s = 0, a = 0.5, f = 1, n = oct || 5, norm = 0;
    for (var i = 0; i < n; i++) { s += a * vnoise(x * f, y * f); norm += a; f *= 2.03; a *= 0.5; }
    return s / norm;
  }
  function ridged(x, y) {
    var s = 0, a = 0.5, f = 1, norm = 0;
    for (var i = 0; i < 4; i++) { var n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1); s += a * n * n; norm += a; f *= 2.1; a *= 0.5; }
    return s / norm;
  }
  function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) | 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------------- landscape shape ---------------- */
  function riverX(z) { return 8 * Math.sin(z * 0.035) + 4 * Math.sin(z * 0.011 + 1.3); }
  function heightAt(x, z) {
    var rx = riverX(z), ad = Math.abs(x - rx);
    var h = 0.75 + (fbm(x * 0.09, z * 0.09, 3) - 0.5) * 0.7;
    var ch = Math.max(0, 1 - ad / 5);
    h -= ch * ch * 2.5;                                                    // river channel
    var s = smooth(12, 82, ad + (fbm(x * 0.03 + 5, z * 0.03, 3) - 0.5) * 16);
    h += s * (30 + 30 * fbm(x * 0.018, z * 0.018, 4)) + s * ridged(x * 0.035, z * 0.035) * 22;
    var back = smooth(-70, -178, z);                                       // valley head
    h += back * (26 + 30 * fbm(x * 0.02 + 9, z * 0.02, 4)) * (0.35 + 0.65 * smooth(4, 40, ad));
    var lake = smooth(8, 24, z) * (1 - smooth(70, 92, z)) * (1 - smooth(16, 38, ad));
    h -= lake * 3.6;                                                       // lake basin
    return h;
  }
  function slopeAt(x, z) {
    var e = 0.8, dx = heightAt(x + e, z) - heightAt(x - e, z), dz = heightAt(x, z + e) - heightAt(x, z - e);
    return 2 * e / Math.sqrt(dx * dx + dz * dz + 4 * e * e); // normal.y
  }

  /* ---------------- palettes (time of day per timer mode) ---------------- */
  var PALETTES = {
    focus: { top: '#2C7AD3', horizon: '#CFE6F5', bottom: '#A9C8D8', fog: '#CBE1EE', fogNear: 110, fogFar: 470,
      sun: '#FFF2D8', sunI: 0.62, sunPos: [80, 120, 60], hemiSky: '#E4F0FF', hemiGround: '#6B7F55', hemiI: 0.52,
      water: '#15858C', glow: 0, stars: 0, sunAmt: 0, cloud: '#FFFFFF' },
    short: { top: '#4A5DA4', horizon: '#FFB27F', bottom: '#C98E6C', fog: '#EAB492', fogNear: 95, fogFar: 430,
      sun: '#FF9A62', sunI: 0.75, sunPos: [-160, 34, -120], hemiSky: '#FFC9AE', hemiGround: '#5A4B3F', hemiI: 0.42,
      water: '#2F7486', glow: 0.45, stars: 0.12, sunAmt: 1, cloud: '#FFD7C2' },
    long: { top: '#07112A', horizon: '#273B6C', bottom: '#121A31', fog: '#1B294A', fogNear: 70, fogFar: 380,
      sun: '#B9CBFF', sunI: 0.32, sunPos: [-110, 120, -300], hemiSky: '#3E5590', hemiGround: '#0E141F', hemiI: 0.36,
      water: '#0F3152', glow: 1, stars: 1, sunAmt: 0.9, cloud: '#46557A' }
  };
  var QUALITY = {
    high: { dpr: 2, aa: true, shadows: true, fps: 60, seg: 210, trees: 1200, clouds: 9 },
    balanced: { dpr: 1.5, aa: true, shadows: false, fps: 45, seg: 170, trees: 850, clouds: 8 },
    light: { dpr: 1, aa: false, shadows: false, fps: 30, seg: 110, trees: 420, clouds: 5 }
  };

  /* ---------------- state ---------------- */
  var canvas, renderer, scene, camera, clock, world = null;
  var quality = 'balanced', modeName = 'focus', paused = false, lastFrame = 0, rafId = 0;
  var pal = {}, target = {};
  var pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  var explore = { on: false, theta: 0, phi: 1.2, radius: 120, target: new T.Vector3(4, 8, -40), blend: 0, drag: null, pinch: null };
  var villageWanted = 6, villageShown = 0, growAnims = [];
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  T.ColorManagement.enabled = false;

  function col(hex) { return new T.Color(hex); }
  function setPaletteTargets(name) {
    var p = PALETTES[name];
    target = {
      top: col(p.top), horizon: col(p.horizon), bottom: col(p.bottom), fog: col(p.fog), sun: col(p.sun),
      hemiSky: col(p.hemiSky), hemiGround: col(p.hemiGround), water: col(p.water), cloud: col(p.cloud),
      sunPos: new T.Vector3().fromArray(p.sunPos), sunI: p.sunI, hemiI: p.hemiI, glow: p.glow, stars: p.stars,
      sunAmt: p.sunAmt, fogNear: p.fogNear, fogFar: p.fogFar
    };
  }
  function snapPalette() {
    pal = {};
    for (var k in target) pal[k] = (target[k] && target[k].clone) ? target[k].clone() : target[k];
  }

  /* ---------------- geometry helpers ---------------- */
  function mergeParts(parts) { // parts: [{geo, color}]
    var pos = [], nor = [], colr = [];
    parts.forEach(function (pt) {
      var g = pt.geo.index ? pt.geo.toNonIndexed() : pt.geo;
      g.computeVertexNormals();
      var p = g.attributes.position.array, n = g.attributes.normal.array, c = new T.Color(pt.color);
      for (var i = 0; i < p.length; i += 3) {
        pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]); colr.push(c.r, c.g, c.b);
      }
    });
    var out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new T.Float32BufferAttribute(colr, 3));
    return out;
  }
  function box(w, h, d, x, y, z) { var g = new T.BoxGeometry(w, h, d); g.translate(x || 0, y || 0, z || 0); return g; }
  function prism(w, h, d, y) { // roof: ridge along z
    var hw = w / 2, hd = d / 2, v = [
      -hw, 0, -hd, hw, 0, -hd, 0, h, -hd,           // back gable
      hw, 0, hd, -hw, 0, hd, 0, h, hd,              // front gable
      -hw, 0, hd, 0, h, hd, 0, h, -hd, -hw, 0, hd, 0, h, -hd, -hw, 0, -hd,   // left slope
      hw, 0, -hd, 0, h, -hd, 0, h, hd, hw, 0, -hd, 0, h, hd, hw, 0, hd      // right slope
    ];
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
    g.translate(0, y || 0, 0); g.computeVertexNormals();
    return g;
  }

  /* ---------------- build world ---------------- */
  function buildWorld() {
    var Q = QUALITY[quality] || QUALITY.balanced;
    var R = rng(1291);
    world = { anim: [], pickables: [], disposables: [] };
    scene = new T.Scene();
    scene.fog = new T.Fog(pal.fog.clone(), pal.fogNear, pal.fogFar);

    // Sky dome
    var skyMat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: pal.top.clone() }, horizon: { value: pal.horizon.clone() }, bottom: { value: pal.bottom.clone() },
        sunDir: { value: pal.sunPos.clone().normalize() }, sunColor: { value: pal.sun.clone() }, sunAmt: { value: pal.sunAmt } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunAmt; varying vec3 vDir;' +
        'void main(){ vec3 d = normalize(vDir); float h = d.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 1.5, 1.0), 0.65)) : mix(horizon, bottom, min(-h * 5.0, 1.0));' +
        'float s = max(dot(d, normalize(sunDir)), 0.0); c += sunColor * (smoothstep(0.9993, 0.9996, s) * 0.9 + pow(s, 14.0) * 0.28) * sunAmt; gl_FragColor = vec4(c, 1.0); }'
    });
    world.sky = new T.Mesh(new T.SphereGeometry(1100, 32, 16), skyMat);
    world.sky.renderOrder = -1;
    scene.add(world.sky);

    // Stars
    var sp = [], sr = rng(7);
    for (var i = 0; i < 1100; i++) {
      var th = sr() * Math.PI * 2, ph = Math.acos(1 - sr() * 0.92);
      sp.push(Math.sin(ph) * Math.cos(th) * 1000, Math.cos(ph) * 1000, Math.sin(ph) * Math.sin(th) * 1000);
    }
    var sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
    world.stars = new T.Points(sg, new T.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: pal.stars, fog: false, depthWrite: false }));
    scene.add(world.stars);

    // Lights
    world.hemi = new T.HemisphereLight(pal.hemiSky.clone(), pal.hemiGround.clone(), pal.hemiI * Math.PI);
    scene.add(world.hemi);
    world.sun = new T.DirectionalLight(pal.sun.clone(), pal.sunI * Math.PI);
    world.sun.position.copy(pal.sunPos);
    world.sun.target.position.set(0, 0, -40);
    scene.add(world.sun); scene.add(world.sun.target);
    if (Q.shadows) {
      world.sun.castShadow = true;
      world.sun.shadow.mapSize.set(2048, 2048);
      var sc = world.sun.shadow.camera; sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; sc.near = 1; sc.far = 700;
      world.sun.shadow.bias = -0.0008; world.sun.shadow.normalBias = 0.6;
    }

    buildTerrain(Q);
    buildWater();
    buildMatterhorn();
    var village = buildVillage(R);
    buildTrees(Q, R, village.occupied);
    buildViaduct();
    buildCableCar();
    buildWaterfall();
    buildCows(R);
    buildFlag();
    buildClouds(Q, R);
    buildEagle();
    buildFireworks();
    setVillageSize(villageWanted, true);
  }

  function buildTerrain(Q) {
    var W = 360, D = 350, cx = 0, cz = -80, n = Q.seg;
    var H = new Float32Array((n + 1) * (n + 1));
    for (var j = 0; j <= n; j++) for (var i = 0; i <= n; i++) H[j * (n + 1) + i] = heightAt(cx - W / 2 + i * W / n, cz - D / 2 + j * D / n);
    var pos = new Float32Array(n * n * 18), colr = new Float32Array(n * n * 18), c = new T.Color(), p = 0;
    function X(i) { return cx - W / 2 + i * W / n; }
    function Z(j) { return cz - D / 2 + j * D / n; }
    function tri(ax, ay, az, bx, by, bz, qx, qy, qz) {
      var ux = bx - ax, uy = by - ay, uz = bz - az, vx = qx - ax, vy = qy - ay, vz = qz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      terrainColor((ay + by + qy) / 3, Math.abs(ny / l), (ax + bx + qx) / 3, (az + bz + qz) / 3, c);
      pos[p] = ax; pos[p + 1] = ay; pos[p + 2] = az; pos[p + 3] = bx; pos[p + 4] = by; pos[p + 5] = bz; pos[p + 6] = qx; pos[p + 7] = qy; pos[p + 8] = qz;
      for (var k = 0; k < 9; k += 3) { colr[p + k] = c.r; colr[p + k + 1] = c.g; colr[p + k + 2] = c.b; }
      p += 9;
    }
    for (j = 0; j < n; j++) for (i = 0; i < n; i++) {
      var x0 = X(i), x1 = X(i + 1), z0 = Z(j), z1 = Z(j + 1);
      var ha = H[j * (n + 1) + i], hb = H[j * (n + 1) + i + 1], hc = H[(j + 1) * (n + 1) + i], hd = H[(j + 1) * (n + 1) + i + 1];
      if ((i + j) % 2 === 0) { tri(x0, ha, z0, x0, hc, z1, x1, hb, z0); tri(x1, hb, z0, x0, hc, z1, x1, hd, z1); }
      else { tri(x0, ha, z0, x0, hc, z1, x1, hd, z1); tri(x0, ha, z0, x1, hd, z1, x1, hb, z0); }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('color', new T.BufferAttribute(colr, 3));
    g.computeVertexNormals();
    var m = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true; m.castShadow = !!Q.shadows;
    scene.add(m);
    world.terrain = m;
  }
  function terrainColor(h, ny, x, z, out) {
    var n = vnoise(x * 0.21, z * 0.21), n2 = vnoise(x * 0.05 + 3, z * 0.05);
    var snowLine = 33 + n2 * 12 - smooth(-60, -170, z) * 9;
    if (h < -0.35) { out.setRGB(0.33, 0.43, 0.39); return; }
    if (h < 0.32) { out.setRGB(0.80 + n * 0.05, 0.76 + n * 0.04, 0.62); return; }
    if (h > snowLine && ny > 0.5) { var s = 0.92 + n * 0.07; out.setRGB(s, s + 0.02, Math.min(1, s + 0.05)); return; }
    if (ny < 0.6 || h > snowLine - 5 + n * 4) { var g = 0.40 + n * 0.14; out.setRGB(g + n2 * 0.03, g * 0.99, g * 0.98); return; }
    if (h > 17 + n * 6) { out.setRGB(0.50 + n * 0.08, 0.58 + n * 0.06, 0.30); return; }
    if (h > 3.4 + n * 2.2) { out.setRGB(0.26 + n * 0.07, 0.45 + n * 0.08, 0.23); return; }
    out.setRGB(0.42 + n * 0.09, 0.62 + n * 0.08, 0.27 + n * 0.05);
  }

  function buildWater() {
    var size = 256, cv = document.createElement('canvas'); cv.width = cv.height = size;
    var ctx = cv.getContext('2d'), img = ctx.createImageData(size, size), hgt = new Float32Array(size * size);
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      // tileable noise by sampling on a torus-like wrap
      var u = x / size, v = y / size;
      hgt[y * size + x] = fbm(Math.cos(u * Math.PI * 2) * 3 + 10, Math.sin(u * Math.PI * 2) * 3 + v * 9, 3) + 0.5 * vnoise(u * 32, v * 32 + Math.sin(u * 6.28) * 2);
    }
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
      var hl = hgt[y * size + ((x - 1 + size) % size)], hr = hgt[y * size + ((x + 1) % size)];
      var hu = hgt[((y - 1 + size) % size) * size + x], hd = hgt[((y + 1) % size) * size + x];
      var nx = (hl - hr) * 3, ny = (hu - hd) * 3, nz = 1, l = Math.sqrt(nx * nx + ny * ny + nz * nz), k = (y * size + x) * 4;
      img.data[k] = (nx / l * 0.5 + 0.5) * 255; img.data[k + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[k + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    var tex = new T.CanvasTexture(cv); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(22, 22);
    var mat = new T.MeshPhongMaterial({ color: pal.water.clone(), specular: 0x9fd9ef, shininess: 60, normalMap: tex, normalScale: new T.Vector2(0.45, 0.45), transparent: true, opacity: 0.9 });
    var m = new T.Mesh(new T.PlaneGeometry(360, 360), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(0, 0, -80); m.receiveShadow = true;
    scene.add(m);
    world.water = m; world.waterTex = tex;
  }

  function buildMatterhorn() {
    var g = new T.ConeGeometry(30, 78, 6, 7);
    var p = g.attributes.position, r = rng(4478);
    var seen = {};
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i), key = x.toFixed(2) + ',' + y.toFixed(2) + ',' + z.toFixed(2);
      var t = (y + 39) / 78;
      if (!seen[key]) seen[key] = [(r() - 0.5) * 7 * (1 - t), (r() - 0.5) * 4 * (1 - t * 0.6), (r() - 0.5) * 7 * (1 - t)];
      var d = seen[key];
      p.setXYZ(i, x * (1 - 0.12 * Math.sin(t * 3)) + d[0] + t * t * 9, y + d[1], z + d[2] - t * t * 3);
    }
    g = g.toNonIndexed(); g.computeVertexNormals();
    var pos = g.attributes.position, nor = g.attributes.normal, colr = [];
    for (i = 0; i < pos.count; i += 3) {
      var ny = (nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2)) / 3, yy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      var snow = ny > 0.42 + 0.25 * hash(i, 3) || yy < -24;
      var c = snow ? [0.95, 0.97, 1] : [0.46 + hash(i, 9) * 0.1, 0.44, 0.43];
      for (var k = 0; k < 3; k++) colr.push(c[0], c[1], c[2]);
    }
    g.setAttribute('color', new T.Float32BufferAttribute(colr, 3));
    var m = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true }));
    var mx = riverX(-212) + 6, mz = -212;
    m.position.set(mx, heightAt(mx, mz) + 26, mz);
    m.rotation.y = 0.5;
    m.castShadow = true;
    scene.add(m);
  }

  function buildVillage(R) {
    var slots = [], occupied = [];
    var cz = -16, cxv = riverX(cz) + 9;
    for (var tries = 0; tries < 6000 && slots.length < 64; tries++) {
      var z = -88 + R() * 104, side = R() < 0.62 ? 1 : -1, ad = 5 + R() * 13;
      var x = riverX(z) + side * ad, h = heightAt(x, z);
      if (h < 0.45 || h > 3.6 || slopeAt(x, z) < 0.86) continue;
      var ok = true;
      for (var s = 0; s < slots.length; s++) { var dx = slots[s].x - x, dz = slots[s].z - z; if (dx * dx + dz * dz < 13) { ok = false; break; } }
      if (Math.hypot(x - cxv, z - cz) < 5) ok = false; // church square
      if (Math.abs(z + 50) < 4) ok = false;            // under the viaduct
      if (!ok) continue;
      slots.push({ x: x, z: z, y: h, rot: Math.atan2(riverX(z) - x, 0) + (R() - 0.5) * 0.5 + (R() < 0.5 ? 0 : Math.PI / 2), d: Math.hypot(x - cxv, (z - cz) * 0.8) });
    }
    slots.sort(function (a, b) { return a.d - b.d; });
    world.slots = slots;
    slots.forEach(function (s) { occupied.push([s.x, s.z, 2.6]); });

    var walls = mergeParts([
      { geo: box(1.8, 0.75, 2.2, 0, 0.375, 0), color: '#ECE4D3' },
      { geo: box(1.8, 0.9, 2.2, 0, 1.2, 0), color: '#7B4A2B' },
      { geo: box(1.95, 0.1, 0.5, 0, 1.0, 1.3), color: '#5E3820' },
      { geo: box(0.5, 0.7, 0.5, 0.45, 2.3, -0.4), color: '#D8D2C6' }
    ]);
    var roofG = prism(2.5, 0.9, 2.8, 1.65);
    var winG = mergeParts([
      { geo: box(1.84, 0.28, 1.3, 0, 1.18, 0), color: '#FFFFFF' },
      { geo: box(0.9, 0.26, 2.24, 0, 1.18, 0), color: '#FFFFFF' },
      { geo: box(0.5, 0.3, 2.24, 0, 0.42, 0), color: '#FFFFFF' }
    ]);
    var N = slots.length;
    var wallMesh = new T.InstancedMesh(walls, new T.MeshLambertMaterial({ vertexColors: true }), N);
    var roofMesh = new T.InstancedMesh(roofG, new T.MeshLambertMaterial({ color: 0xffffff }), N);
    var winMat = new T.MeshLambertMaterial({ color: 0x3a2a1c, emissive: new T.Color('#FFC66B'), emissiveIntensity: 0 });
    var winMesh = new T.InstancedMesh(winG, winMat, N);
    var roofCols = ['#4B3328', '#5C646C', '#7E3626', '#3F3A36', '#6A4A36'];
    var c = new T.Color();
    for (var i = 0; i < N; i++) {
      c.set(roofCols[Math.floor(R() * roofCols.length)]); roofMesh.setColorAt(i, c);
    }
    [wallMesh, roofMesh, winMesh].forEach(function (m) { m.castShadow = true; m.receiveShadow = true; m.count = 0; scene.add(m); });
    world.village = { walls: wallMesh, roofs: roofMesh, wins: winMesh, winMat: winMat, scale: new Float32Array(N) };

    // church
    var churchY = heightAt(cxv, cz);
    var church = mergeParts([
      { geo: box(2.6, 2.2, 4.2, 0, 1.1, 0), color: '#F3EFE6' },
      { geo: box(1.4, 6.4, 1.4, 0, 3.2, 2.6), color: '#F3EFE6' },
      { geo: box(1.5, 0.5, 1.5, 0, 4.6, 2.6), color: '#3B3F44' },
      { geo: (function () { var g = new T.ConeGeometry(1.05, 2.6, 4); g.rotateY(Math.PI / 4); g.translate(0, 7.7, 2.6); return g; })(), color: '#6E2B22' },
      { geo: prism(3.0, 1.3, 4.5, 2.2), color: '#6E2B22' }
    ]);
    var cm = new T.Mesh(church, new T.MeshLambertMaterial({ vertexColors: true }));
    cm.position.set(cxv, churchY - 0.05, cz); cm.rotation.y = 0.3; cm.castShadow = true; cm.receiveShadow = true;
    scene.add(cm);
    occupied.push([cxv, cz, 4]);
    world.church = { x: cxv, z: cz, y: churchY };
    return { occupied: occupied };
  }

  function placeChalet(i, scale) {
    var s = world.slots[i], m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(0, s.rot, 0);
    q.setFromEuler(e);
    m.compose(new T.Vector3(s.x, s.y - 0.08, s.z), q, new T.Vector3(scale, scale, scale));
    world.village.walls.setMatrixAt(i, m); world.village.roofs.setMatrixAt(i, m); world.village.wins.setMatrixAt(i, m);
  }
  function setVillageSize(n, instant) {
    villageWanted = Math.max(0, n | 0);
    if (!world || !world.village) return;
    var N = world.slots.length, want = Math.min(villageWanted, N), v = world.village;
    for (var i = 0; i < N; i++) {
      if (i < want) {
        if (i >= villageShown && !instant) { v.scale[i] = 0.001; growAnims.push({ i: i, t: 0, delay: (i - villageShown) * 0.35 }); }
        else if (i >= villageShown || instant) v.scale[i] = 1;
        placeChalet(i, v.scale[i]);
      }
    }
    villageShown = want;
    v.walls.count = v.roofs.count = v.wins.count = want;
    v.walls.instanceMatrix.needsUpdate = v.roofs.instanceMatrix.needsUpdate = v.wins.instanceMatrix.needsUpdate = true;
  }

  function buildTrees(Q, R, occupied) {
    var g = mergeParts([
      { geo: box(0.28, 0.8, 0.28, 0, 0.4, 0), color: '#5A3B25' },
      { geo: (function () { var c = new T.ConeGeometry(1.15, 2.4, 7); c.translate(0, 1.7, 0); return c; })(), color: '#FFFFFF' },
      { geo: (function () { var c = new T.ConeGeometry(0.85, 2.0, 7); c.translate(0, 2.9, 0); return c; })(), color: '#FFFFFF' },
      { geo: (function () { var c = new T.ConeGeometry(0.5, 1.4, 7); c.translate(0, 3.9, 0); return c; })(), color: '#FFFFFF' }
    ]);
    var mesh = new T.InstancedMesh(g, new T.MeshLambertMaterial({ vertexColors: true }), Q.trees);
    var m = new T.Matrix4(), q = new T.Quaternion(), c = new T.Color(), placed = 0;
    for (var tries = 0; tries < Q.trees * 12 && placed < Q.trees; tries++) {
      var x = -150 + R() * 300, z = -175 + R() * 240, h = heightAt(x, z);
      if (h < 1.1 || h > 24 + vnoise(x * 0.1, z * 0.1) * 6) continue;
      var ny = slopeAt(x, z);
      if (ny < 0.66) continue;
      var dens = vnoise(x * 0.05 + 20, z * 0.05);
      if (h < 3.5 && dens < 0.62) continue;          // meadows stay open
      if (dens < 0.3) continue;
      var bad = false;
      for (var o = 0; o < occupied.length; o++) { var ox = occupied[o][0] - x, oz = occupied[o][1] - z; if (ox * ox + oz * oz < occupied[o][2] * occupied[o][2] * 1.6) { bad = true; break; } }
      if (bad || Math.abs(z + 50) < 3) continue;
      var s = 0.75 + R() * 0.7 + (h > 12 ? 0.15 : 0);
      q.setFromEuler(new T.Euler(0, R() * 6.28, 0));
      m.compose(new T.Vector3(x, h - 0.15, z), q, new T.Vector3(s, s * (0.9 + R() * 0.35), s));
      mesh.setMatrixAt(placed, m);
      var g1 = 0.24 + R() * 0.1;
      c.setRGB(g1 * 0.75, 0.36 + R() * 0.12, g1 * 0.8);
      mesh.setColorAt(placed, c);
      placed++;
    }
    mesh.count = placed; mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }

  function buildViaduct() {
    var z = -50, deck = 10.5, rx = riverX(z), L = rx - 6, Rr = rx + 6;
    while (heightAt(L, z) < deck + 1.2 && L > rx - 120) L -= 0.5;
    while (heightAt(Rr, z) < deck + 1.2 && Rr < rx + 120) Rr += 0.5;
    var stone = new T.MeshLambertMaterial({ color: 0xB9AE9C });
    var spans = Math.max(4, Math.round((Rr - L) / 6)), span = (Rr - L) / spans, grp = new T.Group();
    for (var i = 0; i < spans; i++) {
      var x0 = L + i * span, w = span, sh = new T.Shape();
      sh.moveTo(0, -6); sh.lineTo(w, -6); sh.lineTo(w, deck); sh.lineTo(0, deck); sh.lineTo(0, -6);
      var hole = new T.Path(), pw = 0.9, top = deck - 2.0, r = (w - pw * 2) / 2;
      hole.moveTo(pw, -5); hole.lineTo(w - pw, -5); hole.lineTo(w - pw, top - r);
      hole.absarc(w / 2, top - r, r, 0, Math.PI, false); hole.lineTo(pw, -5);
      sh.holes.push(hole);
      var g = new T.ExtrudeGeometry(sh, { depth: 1.8, bevelEnabled: false, curveSegments: 10 });
      g.translate(x0, 0, z - 0.9);
      var mesh = new T.Mesh(g, stone); mesh.castShadow = true; mesh.receiveShadow = true; grp.add(mesh);
    }
    var deckM = new T.Mesh(box(Rr - L + 2, 0.5, 2.4, (L + Rr) / 2, deck + 0.25, z), new T.MeshLambertMaterial({ color: 0x8C8274 }));
    grp.add(deckM);
    // tunnel portals
    [L, Rr].forEach(function (px, k) {
      var sh = new T.Shape(); sh.moveTo(-1.3, 0); sh.lineTo(1.3, 0); sh.lineTo(1.3, 1.6); sh.absarc(0, 1.6, 1.3, 0, Math.PI, false); sh.lineTo(-1.3, 0);
      var frame = new T.Shape(); frame.moveTo(-2.0, -0.3); frame.lineTo(2.0, -0.3); frame.lineTo(2.0, 1.7); frame.absarc(0, 1.7, 2.0, 0, Math.PI, false); frame.lineTo(-2.0, -0.3);
      var fm = new T.Mesh(new T.ShapeGeometry(frame), new T.MeshLambertMaterial({ color: 0x9A8F80, side: T.DoubleSide }));
      var hm = new T.Mesh(new T.ShapeGeometry(sh), new T.MeshBasicMaterial({ color: 0x0b0d10, side: T.DoubleSide }));
      [fm, hm].forEach(function (m, j) { m.position.set(px + (k ? -0.2 : 0.2) * (j + 1), deck + 0.5, z); m.rotation.y = k ? -Math.PI / 2 : Math.PI / 2; grp.add(m); });
    });
    scene.add(grp);

    // the red train
    var car = mergeParts([
      { geo: box(3.4, 1.15, 1.2, 0, 0.75, 0), color: '#C8102E' },
      { geo: box(3.42, 0.38, 1.22, 0, 0.95, 0), color: '#2B3640' },
      { geo: box(3.2, 0.14, 1.0, 0, 1.4, 0), color: '#9AA2AA' },
      { geo: box(3.0, 0.22, 0.9, 0, 0.12, 0), color: '#30353B' }
    ]);
    var trainMesh = new T.InstancedMesh(car, new T.MeshLambertMaterial({ vertexColors: true }), 5);
    trainMesh.castShadow = true;
    scene.add(trainMesh);
    world.pickables.push({ obj: trainMesh, type: 'train' });
    world.train = { mesh: trainMesh, L: L, R: Rr, deck: deck + 0.5, z: z, speed: 7 };
  }

  function buildCableCar() {
    var az = -6, ax = riverX(az) + 15, bx = 66, bz = -78;
    var A = new T.Vector3(ax, heightAt(ax, az) + 3.2, az);
    var B = new T.Vector3(bx, heightAt(bx, bz) + 3.2, bz);
    var st = new T.MeshLambertMaterial({ color: 0xE9E4DA });
    [A, B].forEach(function (p) { var m = new T.Mesh(box(2.4, 2.2, 2.4, 0, 1.1, 0), st); m.position.set(p.x, p.y - 3.4, p.z); m.castShadow = true; scene.add(m); });
    var lineMat = new T.LineBasicMaterial({ color: 0x2b2f35 });
    var off = new T.Vector3().subVectors(B, A).cross(new T.Vector3(0, 1, 0)).normalize().multiplyScalar(0.35);
    [off, off.clone().negate()].forEach(function (o) {
      var g = new T.BufferGeometry().setFromPoints([A.clone().add(o), B.clone().add(o)]); scene.add(new T.Line(g, lineMat));
    });
    var gondola = new T.Group();
    var cab = new T.Mesh(mergeParts([
      { geo: box(1.5, 1.2, 1.2, 0, -1.4, 0), color: '#D52B1E' },
      { geo: box(1.52, 0.42, 1.22, 0, -1.2, 0), color: '#2B3640' },
      { geo: box(0.08, 0.9, 0.08, 0, -0.45, 0), color: '#2B2F35' },
      { geo: box(0.7, 0.18, 0.3, 0, 0, 0), color: '#2B2F35' }
    ]), new T.MeshLambertMaterial({ vertexColors: true }));
    cab.castShadow = true; gondola.add(cab); scene.add(gondola);
    world.cable = { A: A, B: B, g: gondola };
  }

  function buildWaterfall() {
    var x = riverX(-100) - 26, pts = [];
    for (var z = -132; z <= -84; z += 1.2) pts.push(new T.Vector3(x + Math.sin(z * 0.2) * 0.8, heightAt(x + Math.sin(z * 0.2) * 0.8, z) + 0.35, z));
    var pos = [], uv = [], idx = [];
    for (var i = 0; i < pts.length; i++) {
      var w = 1.1 + i / pts.length * 0.8;
      pos.push(pts[i].x - w, pts[i].y, pts[i].z, pts[i].x + w, pts[i].y, pts[i].z);
      uv.push(0, i / (pts.length - 1), 1, i / (pts.length - 1));
      if (i > 0) { var a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    var mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, side: T.DoubleSide, fog: true,
      uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { time: { value: 0 }, tint: { value: new T.Color(1, 1, 1) } }]),
      vertexShader: '#include <fog_pars_vertex>\nvarying vec2 vUv; void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}',
      fragmentShader: '#include <fog_pars_fragment>\nuniform float time; uniform vec3 tint; varying vec2 vUv; void main(){ float edge = smoothstep(0.0,0.35,vUv.x)*smoothstep(1.0,0.65,vUv.x);' +
        'float s = 0.55 + 0.45*sin((vUv.y*40.0 + time*6.0) + sin(vUv.x*12.0)*1.5); float a = edge * (0.55 + 0.4*s); gl_FragColor = vec4(mix(vec3(0.75,0.9,0.95), vec3(1.0), s)*tint, a);\n#include <fog_fragment>\n}'
    });
    var m = new T.Mesh(g, mat); scene.add(m);
    world.fall = mat;
  }

  function buildCows(R) {
    var body = mergeParts([
      { geo: box(1.35, 0.7, 0.62, 0, 0.82, 0), color: '#8A5A33' },
      { geo: box(0.16, 0.5, 0.16, 0.48, 0.25, 0.2), color: '#5B3B22' }, { geo: box(0.16, 0.5, 0.16, 0.48, 0.25, -0.2), color: '#5B3B22' },
      { geo: box(0.16, 0.5, 0.16, -0.48, 0.25, 0.2), color: '#5B3B22' }, { geo: box(0.16, 0.5, 0.16, -0.48, 0.25, -0.2), color: '#5B3B22' },
      { geo: box(0.08, 0.5, 0.08, -0.72, 0.7, 0), color: '#5B3B22' },
      { geo: box(0.5, 0.18, 0.4, 0.05, 0.42, 0), color: '#E8D6B8' }
    ]);
    var head = mergeParts([
      { geo: box(0.46, 0.42, 0.42, 0.22, 0, 0), color: '#8A5A33' },
      { geo: box(0.2, 0.24, 0.36, 0.48, -0.08, 0), color: '#E8D6B8' },
      { geo: box(0.08, 0.1, 0.62, 0.16, 0.24, 0), color: '#F2EEE6' },
      { geo: box(0.14, 0.16, 0.12, 0.05, -0.3, 0), color: '#E2B23A' }
    ]);
    var bm = new T.MeshLambertMaterial({ vertexColors: true });
    world.cows = [];
    var spots = [[14, 4], [19, 8], [-12, 3], [12, -2], [-15, -6], [22, 2], [16, 13], [-19, 10]], k = 0;
    for (var i = 0; i < spots.length; i++) {
      var z = spots[i][1], x = riverX(z) + spots[i][0], h = heightAt(x, z);
      if (h < 0.5) { x += Math.sign(spots[i][0]) * 6; h = heightAt(x, z); }
      if (h < 0.5 || h > 4) continue;
      var cow = new T.Group(), b = new T.Mesh(body, bm), hd = new T.Mesh(head, bm);
      hd.position.set(0.62, 1.0, 0); cow.add(b); cow.add(hd);
      cow.position.set(x, h - 0.05, z); cow.rotation.y = R() * 6.28;
      cow.scale.setScalar(0.95);
      b.castShadow = hd.castShadow = true;
      scene.add(cow);
      world.cows.push({ g: cow, head: hd, phase: R() * 10, speed: 0.6 + R() * 0.5 });
      world.pickables.push({ obj: cow, type: 'cow' });
      k++;
    }
  }

  function buildFlag() {
    var z = 30, x = riverX(z) + 24, h = Math.max(heightAt(x, z), 0.4);
    var pole = new T.Mesh(new T.CylinderGeometry(0.09, 0.12, 7.5, 8), new T.MeshLambertMaterial({ color: 0xE9ECEF }));
    pole.position.set(x, h + 3.75, z); scene.add(pole);
    var cv = document.createElement('canvas'); cv.width = cv.height = 128;
    var ctx = cv.getContext('2d'); ctx.fillStyle = '#DA291C'; ctx.fillRect(0, 0, 128, 128); ctx.fillStyle = '#fff';
    ctx.fillRect(52, 24, 24, 80); ctx.fillRect(24, 52, 80, 24);
    var tex = new T.CanvasTexture(cv);
    var g = new T.PlaneGeometry(2.4, 2.4, 14, 6);
    g.translate(1.2, 0, 0);
    var m = new T.Mesh(g, new T.MeshLambertMaterial({ map: tex, side: T.DoubleSide }));
    m.position.set(x + 0.08, h + 6.2, z); m.rotation.y = -0.6;
    scene.add(m);
    world.flag = { mesh: m, base: g.attributes.position.array.slice() };
  }

  function buildClouds(Q, R) {
    world.clouds = [];
    var mat = new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0x334455, emissiveIntensity: 0.25, flatShading: true });
    world.cloudMat = mat;
    for (var i = 0; i < Q.clouds; i++) {
      var g = new T.Group(), n = 4 + Math.floor(R() * 4);
      for (var j = 0; j < n; j++) {
        var s = 3 + R() * 4.5, m = new T.Mesh(new T.IcosahedronGeometry(1, 1), mat);
        m.scale.set(s * 1.4, s * 0.75, s); m.position.set((j - n / 2) * 4.2 + R() * 2, R() * 2, (R() - 0.5) * 5); g.add(m);
      }
      g.position.set(-180 + R() * 360, 58 + R() * 26, -190 + R() * 170);
      scene.add(g);
      world.clouds.push({ g: g, v: 0.9 + R() * 1.4 });
    }
  }

  function buildEagle() {
    var mat = new T.MeshLambertMaterial({ color: 0x4a3626, side: T.DoubleSide });
    var eg = new T.Group();
    var bodyM = new T.Mesh(new T.ConeGeometry(0.28, 1.6, 5), mat); bodyM.rotation.x = Math.PI / 2; eg.add(bodyM);
    function wing(sign) {
      var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0.5, 0, 0, -0.4, sign * 2.6, 0, -0.1], 3)); g.computeVertexNormals();
      var w = new T.Mesh(g, mat); eg.add(w); return w;
    }
    world.eagle = { g: eg, l: wing(1), r: wing(-1) };
    eg.scale.setScalar(1.3);
    scene.add(eg);
  }

  function buildFireworks() {
    world.bursts = [];
    world.fwMat = function () { return new T.PointsMaterial({ size: 1.1, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: T.AdditiveBlending }); };
  }
  function spawnBurst(center, delay) {
    var n = 110, pos = new Float32Array(n * 3), vel = [], colr = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), sp = 7 + Math.random() * 5;
      vel.push(new T.Vector3(Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp));
      var white = Math.random() < 0.45; colr[i * 3] = 1; colr[i * 3 + 1] = white ? 1 : 0.16; colr[i * 3 + 2] = white ? 1 : 0.11;
      pos[i * 3] = center.x; pos[i * 3 + 1] = center.y; pos[i * 3 + 2] = center.z;
    }
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(colr, 3));
    var pts = new T.Points(g, world.fwMat()); pts.visible = false; scene.add(pts);
    world.bursts.push({ pts: pts, vel: vel, t: -delay, life: 2.6, center: center.clone(), rise: 0.9 });
  }
  function celebrate() {
    if (!world || !world.church) return;
    for (var i = 0; i < 7; i++) {
      spawnBurst(new T.Vector3(world.church.x + (Math.random() - 0.5) * 40, 26 + Math.random() * 14, world.church.z - 10 + (Math.random() - 0.5) * 30), i * 0.55);
    }
  }

  /* ---------------- render loop ---------------- */
  var tmpV = new T.Vector3(), tmpM = new T.Matrix4(), tmpQ = new T.Quaternion(), camTarget = new T.Vector3(), basePos = new T.Vector3();

  function lerpPalette(dt) {
    var k = 1 - Math.exp(-dt * 1.1);
    ['top', 'horizon', 'bottom', 'fog', 'sun', 'hemiSky', 'hemiGround', 'water', 'cloud'].forEach(function (n) { pal[n].lerp(target[n], k); });
    pal.sunPos.lerp(target.sunPos, k);
    ['sunI', 'hemiI', 'glow', 'stars', 'sunAmt', 'fogNear', 'fogFar'].forEach(function (n) { pal[n] += (target[n] - pal[n]) * k; });
    var u = world.sky.material.uniforms;
    u.top.value.copy(pal.top); u.horizon.value.copy(pal.horizon); u.bottom.value.copy(pal.bottom);
    u.sunDir.value.copy(pal.sunPos).normalize(); u.sunColor.value.copy(pal.sun); u.sunAmt.value = pal.sunAmt;
    scene.fog.color.copy(pal.fog); scene.fog.near = pal.fogNear; scene.fog.far = pal.fogFar;
    world.sun.color.copy(pal.sun); world.sun.intensity = pal.sunI * Math.PI; world.sun.position.copy(pal.sunPos);
    world.hemi.color.copy(pal.hemiSky); world.hemi.groundColor.copy(pal.hemiGround); world.hemi.intensity = pal.hemiI * Math.PI;
    world.water.material.color.copy(pal.water);
    world.village.winMat.emissiveIntensity = pal.glow * 1.2;
    world.stars.material.opacity = pal.stars;
    world.cloudMat.color.copy(pal.cloud);
    if (world.fall) world.fall.uniforms.tint.value.setScalar(0.45 + 0.55 * (1 - pal.glow * 0.6));
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (paused || !world) return;
    var Q = QUALITY[quality] || QUALITY.balanced;
    if (lastFrame && now - lastFrame < 1000 / Q.fps - 2) return;
    var dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0.016;
    lastFrame = now;
    var t = clock.getElapsedTime();
    lerpPalette(dt);

    // water & waterfall
    world.waterTex.offset.x = t * 0.004; world.waterTex.offset.y = -t * 0.011;
    if (world.fall) world.fall.uniforms.time.value = t;

    // train
    var tr = world.train, loop = (tr.R - tr.L) + 70, head = tr.L - 35 + ((t * tr.speed) % loop);
    for (var i = 0; i < 5; i++) {
      var x = head - i * 3.65, vis = x > tr.L + 0.8 && x < tr.R - 0.8;
      tmpM.compose(tmpV.set(x, tr.deck, tr.z), tmpQ.set(0, 0, 0, 1), vis ? new T.Vector3(1, 1, 1) : new T.Vector3(0.0001, 0.0001, 0.0001));
      tr.mesh.setMatrixAt(i, tmpM);
    }
    tr.mesh.instanceMatrix.needsUpdate = true;

    // cable car (ping-pong)
    var cc = world.cable, ph = (t / 26) % 2, f = ph < 1 ? ph : 2 - ph; f = f * f * (3 - 2 * f);
    cc.g.position.lerpVectors(cc.A, cc.B, f); cc.g.rotation.z = Math.sin(t * 1.3) * 0.03;

    // cows
    world.cows.forEach(function (c) { c.head.rotation.z = -0.35 - Math.max(0, Math.sin(t * c.speed + c.phase)) * 0.45; });

    // flag
    var fg = world.flag, fp = fg.mesh.geometry.attributes.position, b = fg.base;
    for (i = 0; i < fp.count; i++) { var bx = b[i * 3], by = b[i * 3 + 1]; fp.setZ(i, Math.sin(bx * 2.4 - t * 4.2 + by * 0.6) * 0.22 * (bx / 2.4)); fp.setY(i, by - Math.sin(bx * 1.3 - t * 3) * 0.05 * bx); }
    fp.needsUpdate = true; fg.mesh.geometry.computeVertexNormals();

    // clouds
    world.clouds.forEach(function (c) { c.g.position.x += c.v * dt; if (c.g.position.x > 200) c.g.position.x = -200; });

    // eagle
    var ea = world.eagle, ang = t * 0.16;
    ea.g.position.set(-24 + Math.cos(ang) * 30, 40 + Math.sin(t * 0.4) * 2, -52 + Math.sin(ang) * 22);
    ea.g.rotation.set(0, -ang, 0.35); ea.g.rotateY(Math.PI);
    var flap = Math.sin(t * 5) * 0.35 * (Math.sin(t * 0.7) > 0.3 ? 1 : 0.15);
    ea.l.rotation.z = flap; ea.r.rotation.z = -flap;

    // village growth
    if (growAnims.length) {
      growAnims = growAnims.filter(function (a) {
        a.t += dt; var u = a.t - a.delay; if (u < 0) return true;
        var k = Math.min(1, u / 0.9), s = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.25 * (1 - k) - (1 - k) * (1 - k) : 1;
        world.village.scale[a.i] = Math.max(0.001, s); placeChalet(a.i, world.village.scale[a.i]);
        var v = world.village; v.walls.instanceMatrix.needsUpdate = v.roofs.instanceMatrix.needsUpdate = v.wins.instanceMatrix.needsUpdate = true;
        return k < 1;
      });
    }

    // fireworks
    if (world.bursts.length) {
      world.bursts = world.bursts.filter(function (bu) {
        bu.t += dt;
        if (bu.t < 0) return true;
        var pa = bu.pts.geometry.attributes.position;
        bu.pts.visible = true;
        if (bu.t < bu.rise) { // rocket going up
          var k = bu.t / bu.rise;
          for (var j = 0; j < pa.count; j++) pa.setXYZ(j, bu.center.x, bu.center.y - 22 * (1 - k), bu.center.z);
          bu.pts.material.size = 0.8;
        } else {
          var tt = bu.t - bu.rise;
          for (j = 0; j < pa.count; j++) { var v = bu.vel[j]; pa.setXYZ(j, bu.center.x + v.x * tt, bu.center.y + v.y * tt - 4.5 * tt * tt, bu.center.z + v.z * tt); }
          bu.pts.material.size = 1.4; bu.pts.material.opacity = Math.max(0, 1 - tt / bu.life);
        }
        pa.needsUpdate = true;
        if (bu.t > bu.rise + bu.life) { scene.remove(bu.pts); bu.pts.geometry.dispose(); bu.pts.material.dispose(); return false; }
        return true;
      });
    }

    updateCamera(t, dt);
    world.sky.position.copy(camera.position); world.stars.position.copy(camera.position);
    renderer.render(scene, camera);
  }

  function updateCamera(t, dt) {
    var portrait = camera.aspect < 1;
    var drift = reduceMotion ? 0 : 1;
    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 2);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 2);
    basePos.set(Math.sin(t * 0.045) * 7 * drift + pointer.sx * 3, (portrait ? 20 : 17) + Math.sin(t * 0.06) * 1.2 * drift - pointer.sy * 1.5, portrait ? 82 : 66);
    camTarget.set(4 + Math.sin(t * 0.03) * 4 * drift, 9, -60);
    var k = 1 - Math.exp(-dt * 2.2);
    explore.blend += ((explore.on ? 1 : 0) - explore.blend) * k;
    if (explore.blend > 0.001) {
      var sp = Math.sin(explore.phi), ex = explore.target.x + explore.radius * sp * Math.sin(explore.theta),
        ey = explore.target.y + explore.radius * Math.cos(explore.phi), ez = explore.target.z + explore.radius * sp * Math.cos(explore.theta);
      ey = Math.max(ey, heightAt(ex, ez) + 4);
      tmpV.set(ex, ey, ez);
      camera.position.lerpVectors(basePos, tmpV, explore.blend);
      var tg = new T.Vector3().lerpVectors(camTarget, explore.target, explore.blend);
      camera.lookAt(tg);
    } else {
      camera.position.copy(basePos); camera.lookAt(camTarget);
    }
  }

  /* ---------------- interaction (explore mode) ---------------- */
  function startExploreFromCamera() {
    var d = new T.Vector3().subVectors(camera.position, explore.target);
    explore.radius = Math.min(170, Math.max(30, d.length()));
    explore.theta = Math.atan2(d.x, d.z);
    explore.phi = Math.acos(Math.max(-1, Math.min(1, d.y / d.length())));
  }
  function setExplore(on) { explore.on = !!on; if (on) startExploreFromCamera(); }

  function bindInput() {
    window.addEventListener('pointermove', function (e) {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1; pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
    var pts = {};
    canvas.addEventListener('pointerdown', function (e) {
      if (!explore.on) return;
      canvas.setPointerCapture(e.pointerId);
      pts[e.pointerId] = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
      if (Object.keys(pts).length === 2) { var a = Object.values(pts); explore.pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), r: explore.radius }; }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!explore.on || !pts[e.pointerId]) return;
      var p = pts[e.pointerId], dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      var ids = Object.keys(pts);
      if (ids.length === 2 && explore.pinch) {
        var a = Object.values(pts), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        explore.radius = Math.min(220, Math.max(18, explore.pinch.r * explore.pinch.d / Math.max(1, d)));
        return;
      }
      explore.theta -= dx * 0.005; explore.phi = Math.min(1.5, Math.max(0.25, explore.phi - dy * 0.004));
    });
    function up(e) {
      if (!pts[e.pointerId]) return;
      var p = pts[e.pointerId], moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      delete pts[e.pointerId];
      if (Object.keys(pts).length < 2) explore.pinch = null;
      if (moved < 6 && explore.on) pick(e.clientX, e.clientY);
    }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', function (e) {
      if (!explore.on) return; e.preventDefault();
      explore.radius = Math.min(220, Math.max(18, explore.radius * (1 + Math.sign(e.deltaY) * 0.08)));
    }, { passive: false });
    canvas.addEventListener('dblclick', function () { if (explore.on) { explore.radius = 120; explore.theta = 0; explore.phi = 1.2; } });
    window.addEventListener('resize', resize);
  }
  var ray = new T.Raycaster();
  function pick(cx, cy) {
    if (!world) return;
    var ndc = new T.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    var best = null;
    world.pickables.forEach(function (pk) {
      var hits = ray.intersectObject(pk.obj, true);
      if (hits.length && (!best || hits[0].distance < best.d)) best = { d: hits[0].distance, type: pk.type };
    });
    if (best && API.onPick) API.onPick({ type: best.type, x: cx, y: cy });
  }

  function resize() {
    if (!renderer) return;
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.8 ? 64 : camera.aspect < 1.2 ? 56 : 48;
    camera.updateProjectionMatrix();
  }

  /* ---------------- lifecycle ---------------- */
  function makeRenderer() {
    var Q = QUALITY[quality] || QUALITY.balanced;
    var r = new T.WebGLRenderer({ canvas: canvas, antialias: Q.aa, powerPreference: 'high-performance', alpha: false });
    r.outputColorSpace = T.LinearSRGBColorSpace;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr));
    r.shadowMap.enabled = !!Q.shadows; r.shadowMap.type = T.PCFSoftShadowMap;
    return r;
  }
  function disposeWorld() {
    if (!scene) return;
    scene.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { if (m.map) m.map.dispose(); if (m.normalMap) m.normalMap.dispose(); m.dispose(); }); }
    });
    world = null; villageShown = 0; growAnims = [];
  }

  function init(opts) {
    opts = opts || {};
    canvas = opts.canvas || document.getElementById('scene');
    quality = QUALITY[opts.quality] ? opts.quality : 'balanced';
    modeName = opts.mode || 'focus';
    villageWanted = opts.village != null ? opts.village : 6;
    try {
      renderer = makeRenderer();
    } catch (err) {
      console.warn('WebGL is not available, using the flat picture.', err);
      API.available = false; return false;
    }
    API.available = true;
    camera = new T.PerspectiveCamera(48, 1, 0.5, 2600);
    clock = new T.Clock();
    setPaletteTargets(modeName); snapPalette();
    buildWorld();
    resize();
    bindInput();
    cancelAnimationFrame(rafId); rafId = requestAnimationFrame(frame);
    return true;
  }

  function setMode(name) {
    if (!PALETTES[name]) return;
    modeName = name; setPaletteTargets(name);
  }

  function setQuality(q) {
    if (!API.available || !QUALITY[q] || q === quality) { quality = QUALITY[q] ? q : quality; return; }
    var needNewContext = QUALITY[q].aa !== QUALITY[quality].aa;
    quality = q;
    disposeWorld();
    if (needNewContext) {
      renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss();
      var fresh = canvas.cloneNode(false); canvas.parentNode.replaceChild(fresh, canvas); canvas = fresh;
      renderer = makeRenderer();
      bindInputOnce = false; bindCanvasOnly();
    } else {
      var Q = QUALITY[q]; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr)); renderer.shadowMap.enabled = !!Q.shadows;
    }
    buildWorld(); resize(); lastFrame = 0;
  }
  var bindInputOnce = true;
  function bindCanvasOnly() {
    // canvas was replaced: re-attach the canvas listeners (window listeners already exist)
    var oldBind = bindInput;
    var winAdd = window.addEventListener;
    window.addEventListener = function () {}; // skip duplicate window listeners
    try { oldBind(); } finally { window.addEventListener = winAdd; }
  }
})();
