// Демо: прогноз нагрузки на отопление и охлаждение моделью градиентного бустинга прямо в браузере
(async function () {
  const model = await fetch("model.json?v=3").then((r) => r.json());
  const $ = (id) => document.getElementById(id);
  const FEAT = ["compactness", "surface", "wall", "roof", "height", "orientation", "glazing", "glazing_dist"];
  const NAMES = Object.fromEntries(model.features.map((f) => [f.key, f.name]));
  const DIR = { 2: "север", 3: "восток", 4: "юг", 5: "запад" };

  // ---------- инференс деревьев ----------
  function predict(key, x) {
    const t = model.targets[key];
    let sum = 0;
    for (const tr of t.trees) {
      let n = 0;
      while (tr.l[n] !== -1) n = x[tr.f[n]] <= tr.t[n] ? tr.l[n] : tr.r[n];
      sum += tr.v[n];
    }
    return t.init + t.lr * sum;
  }

  // ---------- состояние ----------
  const state = { shape: 0, orientation: 4, glazing: 0.25, dist: 1, free: false, geo: model.shapes[0].slice() };

  function currentGeo() { return state.free ? state.geo : model.shapes[state.shape]; }
  function vector() {
    const g = currentGeo();
    return [g[0], g[1], g[2], g[3], g[4], state.orientation, state.glazing, state.dist];
  }

  // ---------- элементы управления ----------
  const shapeInput = $("shape");
  function shapeLabel() {
    const g = model.shapes[state.shape];
    $("shapeVal").textContent = `№ ${state.shape + 1} из 12`;
    $("shapeInfo").textContent = `Компактность ${g[0].toFixed(2)} · высота ${g[4]} м (${g[4] > 4 ? "2 этажа" : "1 этаж"}) · кровля ${g[3]} м² · стены ${g[2]} м²`;
  }
  shapeInput.addEventListener("input", () => {
    state.shape = +shapeInput.value - 1;
    state.geo = model.shapes[state.shape].slice();
    syncFree();
    shapeLabel();
    update();
  });

  function seg(id, key, parse = Number) {
    const el = $(id);
    const sync = () => el.querySelectorAll("button").forEach((b) => {
      const on = parse(b.dataset.v) === state[key];
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on);
    });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state[key] = parse(b.dataset.v);
      if (key === "glazing") {
        if (state.glazing === 0) state.dist = 0;
        else if (state.dist === 0) state.dist = 1;
        $("dist").value = state.dist;
      }
      sync();
      update();
    });
    sync();
  }
  seg("orientation", "orientation");
  seg("glazing", "glazing");
  $("dist").value = state.dist;
  $("dist").addEventListener("change", (e) => {
    state.dist = +e.target.value;
    if (state.dist === 0) state.glazing = 0;
    else if (state.glazing === 0) state.glazing = 0.1;
    document.querySelectorAll("#glazing button").forEach((b) => {
      const on = +b.dataset.v === state.glazing;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on);
    });
    update();
  });

  // свободный режим
  const FREE = [
    { i: 0, key: "compactness", step: 0.01 },
    { i: 1, key: "surface", step: 1 },
    { i: 2, key: "wall", step: 1 },
    { i: 3, key: "roof", step: 1 },
    { i: 4, key: "height", step: 0.5 },
  ];
  const freeBox = $("freeSliders");
  FREE.forEach((f) => {
    const [lo, hi] = model.ranges[f.key];
    const span = hi - lo;
    const min = +(lo - span * 0.6).toFixed(2), max = +(hi + span * 0.6).toFixed(2);
    const d = document.createElement("div");
    d.className = "field";
    d.innerHTML = `<label for="free_${f.key}">${NAMES[f.key]} <span class="val" id="fv_${f.key}"></span></label>
      <input type="range" id="free_${f.key}" min="${Math.max(0.01, min)}" max="${max}" step="${f.step}">
      <div class="hint">в данных: ${lo} – ${hi}</div>`;
    freeBox.appendChild(d);
    d.querySelector("input").addEventListener("input", (e) => {
      state.geo[f.i] = +e.target.value;
      $("fv_" + f.key).textContent = state.geo[f.i];
      update();
    });
  });
  function syncFree() {
    FREE.forEach((f) => {
      $("free_" + f.key).value = state.geo[f.i];
      $("fv_" + f.key).textContent = state.geo[f.i];
    });
  }
  syncFree();
  $("expert").addEventListener("toggle", (e) => {
    state.free = e.target.open;
    if (!state.free) state.geo = model.shapes[state.shape].slice();
    syncFree();
    update();
  });

  function oodCheck() {
    const warn = $("ood");
    if (!state.free) { warn.hidden = true; return; }
    const g = state.geo;
    const scale = FREE.map((f) => model.ranges[f.key][1] - model.ranges[f.key][0]);
    let best = Infinity;
    for (const s of model.shapes) {
      let d = 0;
      FREE.forEach((f, k) => { d += ((g[f.i] - s[f.i]) / scale[k]) ** 2; });
      best = Math.min(best, Math.sqrt(d));
    }
    const outside = FREE.some((f) => g[f.i] < model.ranges[f.key][0] || g[f.i] > model.ranges[f.key][1]);
    if (outside || best > 0.15) {
      warn.hidden = false;
      warn.textContent = outside
        ? "⚠ Параметры вне диапазона обучающих данных: модель экстраполирует, прогнозу доверять нельзя."
        : "⚠ Такой формы нет среди 12 обучающих: прогноз приблизительный, его нужно проверить расчётом.";
    } else warn.hidden = true;
  }

  // ---------- результаты ----------
  function setKpi(key, val) {
    const [lo, hi] = model.targets[key].range;
    const k = Math.max(0, Math.min(1, (val - lo) / (hi - lo)));
    $(key === "heating" ? "heat" : "cool").textContent = val.toFixed(1).replace(".", ",");
    $(key === "heating" ? "heatBar" : "coolBar").style.width = (k * 100).toFixed(1) + "%";
    const note = k < 0.33 ? "ниже большинства вариантов" : k < 0.66 ? "средний уровень" : "выше большинства вариантов";
    $(key === "heating" ? "heatNote" : "coolNote").textContent = note;
    return k;
  }

  let heatK = 0.5;
  function update() {
    const x = vector();
    const t0 = performance.now();
    const h = predict("heating", x), c = predict("cooling", x);
    const dt = performance.now() - t0;
    heatK = setKpi("heating", h);
    setKpi("cooling", c);
    $("ms").textContent = dt < 1 ? "< 1 мс" : dt.toFixed(1) + " мс";
    oodCheck();
    if (scene) rebuild();
  }

  // ---------- важность признаков ----------
  function renderImportance(key) {
    const imp = model.targets[key].importance;
    const rows = Object.entries(imp).sort((a, b) => b[1] - a[1]);
    const max = rows[0][1];
    $("importance").innerHTML = rows.map(([k, v]) =>
      `<div class="row"><span>${NAMES[k]}</span><span class="track"><i style="width:${(v / max) * 100}%"></i></span><span class="pct">${Math.round(v * 100)}%</span></div>`).join("");
  }
  function tabs(id, fn) {
    const el = $(id);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      el.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      fn(b.dataset.t);
    });
    fn("heating");
  }
  tabs("impTabs", renderImportance);

  // ---------- проверка: прогноз против расчёта ----------
  function renderCheck(key) {
    const t = model.targets[key];
    const [lo, hi] = t.range;
    const W = 320, H = 240, L = 40, B = 34, T = 10, R = 10;
    const sx = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R);
    const sy = (v) => H - B - ((v - lo) / (hi - lo)) * (H - B - T);
    let s = `<line x1="${sx(lo)}" y1="${sy(lo)}" x2="${sx(hi)}" y2="${sy(hi)}" stroke="#c9737f" stroke-dasharray="4 3"/>`;
    s += `<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#6b6f73"/><line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="#6b6f73"/>`;
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const v = lo + ((hi - lo) * i) / ticks;
      s += `<text x="${sx(v)}" y="${H - B + 14}" font-size="10" text-anchor="middle" fill="#6b6f73">${Math.round(v)}</text>`;
      s += `<text x="${L - 6}" y="${sy(v) + 3}" font-size="10" text-anchor="end" fill="#6b6f73">${Math.round(v)}</text>`;
    }
    t.test.true.forEach((v, i) => { s += `<circle cx="${sx(v).toFixed(1)}" cy="${sy(t.test.pred[i]).toFixed(1)}" r="2.6" fill="#9e2a3a" fill-opacity=".55"/>`; });
    s += `<text x="${(L + W - R) / 2}" y="${H - 4}" font-size="11" text-anchor="middle" fill="#2b2326">Расчёт (Ecotect), кВт·ч/м²</text>`;
    s += `<text x="12" y="${(T + H - B) / 2}" font-size="11" text-anchor="middle" fill="#2b2326" transform="rotate(-90 12 ${(T + H - B) / 2})">Прогноз модели</text>`;
    $("scatter").innerHTML = s;
    const m = t.metrics;
    const f = (v) => String(v).replace(".", ",");
    $("metrics").innerHTML = `<tr><th>Модель</th><th>Средняя ошибка (MAE)</th><th>R²</th></tr>
      <tr class="best"><td>Градиентный бустинг</td><td>${f(m.boosting.mae)} кВт·ч/м²</td><td>${f(m.boosting.r2)}</td></tr>
      <tr><td>k ближайших соседей</td><td>${f(m.knn.mae)} кВт·ч/м²</td><td>${f(m.knn.r2)}</td></tr>
      <tr><td>Линейная регрессия</td><td>${f(m.linear.mae)} кВт·ч/м²</td><td>${f(m.linear.r2)}</td></tr>`;
  }
  tabs("chkTabs", renderCheck);

  // ---------- 3D ----------
  let scene = null, camera, renderer, controls, group;
  const treeObjs = [];
  const box = $("scene");
  const ramp = [[0xe8, 0xd6, 0xb4], [0xd6, 0x78, 0x64], [0x78, 0x14, 0x2a]];
  function heatColor(k) {
    const [a, b, t] = k < 0.5 ? [ramp[0], ramp[1], k / 0.5] : [ramp[1], ramp[2], (k - 0.5) / 0.5];
    return new THREE.Color(...a.map((v, i) => (v + (b[i] - v) * t) / 255));
  }
  function initScene() {
    if (!window.THREE) return;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf6f5f4);
    camera = new THREE.PerspectiveCamera(35, 1, 0.5, 2000);
    camera.position.set(34, 24, 38);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    box.appendChild(renderer.domElement);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 25; controls.maxDistance = 160;
    controls.target.set(0, 3, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2d0, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75);
    sun.position.set(30, 50, 40); // солнце с юга (+Z — юг)
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60 });
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(70, 64), new THREE.MeshLambertMaterial({ color: 0xebe7e4 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const grid = new THREE.GridHelper(120, 24, 0xd8cfcf, 0xe3dddc); grid.position.y = 0.01; scene.add(grid);
    // стрелка «север»
    const n = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.5, 3), new THREE.MeshLambertMaterial({ color: 0x9e2a3a }));
    n.rotation.x = -Math.PI / 2; n.position.set(0, 0.2, -42); scene.add(n);
    group = new THREE.Group(); scene.add(group);
    // окружение: низкополигональные деревья
    const leaf = new THREE.MeshLambertMaterial({ color: 0x9db08a, flatShading: true });
    const leaf2 = new THREE.MeshLambertMaterial({ color: 0x7f9a70, flatShading: true });
    const trunk = new THREE.MeshLambertMaterial({ color: 0x7a6455, flatShading: true });
    const trees = [[-24, 14, 1], [-28, -6, 1.2], [-20, -24, 0.9], [22, -22, 1.1], [27, 4, 0.9], [24, 20, 1.2], [-6, -30, 1], [10, 28, 0.8], [-14, 27, 1.1], [31, -9, 0.8]];
    trees.forEach(([x, z, s], i) => {
      const t = new THREE.Group();
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 2, 5), trunk); tr.position.y = 1; t.add(tr);
      const crown = i % 2
        ? new THREE.Mesh(new THREE.ConeGeometry(1.8, 4.6, 6), leaf2)
        : new THREE.Mesh(new THREE.IcosahedronGeometry(2, 0), leaf);
      crown.position.y = i % 2 ? 4 : 3.6; t.add(crown);
      t.children.forEach((c) => { c.castShadow = true; });
      t.position.set(x, 0, z); t.scale.setScalar(s); t.rotation.y = i; scene.add(t); treeObjs.push(t);
    });
    const resize = () => {
      const w = box.clientWidth, h = box.clientHeight;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(box); resize();
    (function loop() {
      controls.update();
      const az = controls.getAzimuthalAngle();
      $("compass").style.transform = `rotate(${(-az * 180) / Math.PI}deg)`;
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    })();
  }

  function footprint(g) {
    const [, , wall, roof, h] = g;
    const halfP = wall / h / 2, area = roof;
    const disc = halfP * halfP - 4 * area;
    if (disc >= 0) { const a = (halfP + Math.sqrt(disc)) / 2; return [a, area / a]; }
    const s = Math.sqrt(area); return [s, s];
  }

  // материалы создаются один раз; цвет стен меняется по прогнозу
  const M3 = {};
  function mats() {
    if (M3.wall) return M3;
    const L = (color, o = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...o });
    M3.wall = L(0xffffff);
    M3.slab = L(0xf3eee8);
    M3.trim = L(0xe2d8cf);
    M3.plinth = L(0x8c8079);
    M3.roof = L(0xcfc7c0);
    M3.tech = L(0xb3aaa4);
    M3.dark = L(0x4a4140);
    M3.pv = new THREE.MeshPhongMaterial({ color: 0x24324a, shininess: 90, specular: 0x8899aa, flatShading: true });
    M3.glass = new THREE.MeshPhongMaterial({ color: 0x3e6074, shininess: 100, specular: 0xbfd6e4, flatShading: true });
    M3.frame = L(0x5d5452);
    M3.path = new THREE.MeshLambertMaterial({ color: 0xd9cfc7 });
    return M3;
  }
  function addBox(parent, w, h, d, x, y, z, mat, shadow = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function rebuild() {
    group.traverse((c) => c.geometry && c.geometry.dispose());
    group.clear();
    const mt = mats();
    const g = currentGeo();
    const [a, b] = footprint(g);
    const h = Math.max(1, g[4]);
    const FH = 3.5, floors = Math.max(1, Math.round(h / FH));
    const P = 0.5; // высота цоколя
    mt.wall.color.copy(heatColor(heatK));

    // цоколь, этажи с выступающими плитами перекрытий, парапет
    addBox(group, a + 0.5, P, b + 0.5, 0, P / 2, 0, mt.plinth);
    for (let k = 0; k < floors; k++) {
      const y0 = P + k * FH;
      addBox(group, a, FH - 0.3, b, 0, y0 + (FH - 0.3) / 2, 0, mt.wall);
      addBox(group, a + 0.36, 0.3, b + 0.36, 0, y0 + FH - 0.15, 0, mt.slab);
    }
    const top = P + floors * FH;
    const pw = 0.25, ph = 0.7;
    addBox(group, a + 0.36, ph, pw, 0, top + ph / 2, b / 2 + 0.18 - pw / 2, mt.slab);
    addBox(group, a + 0.36, ph, pw, 0, top + ph / 2, -b / 2 - 0.18 + pw / 2, mt.slab);
    addBox(group, pw, ph, b + 0.36, a / 2 + 0.18 - pw / 2, top + ph / 2, 0, mt.slab);
    addBox(group, pw, ph, b + 0.36, -a / 2 - 0.18 + pw / 2, top + ph / 2, 0, mt.slab);
    addBox(group, a - 0.1, 0.06, b - 0.1, 0, top + 0.03, 0, mt.roof, false);

    // кровля: лестнично-лифтовой выход, вентагрегаты, солнечные панели
    const cw = Math.min(4, a * 0.3), cd = Math.min(3.2, b * 0.3);
    addBox(group, cw, 2.6, cd, -a / 2 + cw / 2 + 1.2, top + 1.3, -b / 2 + cd / 2 + 1.2, mt.tech);
    addBox(group, cw + 0.3, 0.15, cd + 0.3, -a / 2 + cw / 2 + 1.2, top + 2.67, -b / 2 + cd / 2 + 1.2, mt.slab);
    const ux = a / 2 - 2.2, uz = -b / 2 + 2;
    addBox(group, 2.2, 1.2, 1.6, ux, top + 0.6, uz, mt.tech);
    for (let i = 0; i < 2; i++) {
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 8), mt.dark);
      fan.position.set(ux - 0.5 + i, top + 1.26, uz); group.add(fan);
    }
    const rows = Math.max(0, Math.floor((b - 6) / 2.2));
    const pvW = Math.max(0, a - 4);
    for (let r = 0; r < rows && pvW > 2; r++) {
      const pv = addBox(group, pvW, 0.08, 1.4, 0.6, top + 0.55, -b / 2 + 4.6 + r * 2.2, mt.pv);
      pv.rotation.x = -0.35;
    }

    // ориентация: главный фасад (+Z локально) смотрит на выбранную сторону света
    const ang = { 4: 0, 3: Math.PI / 2, 2: Math.PI, 5: -Math.PI / 2 }[state.orientation];
    group.rotation.y = ang;
    // деревья, попавшие в пятно здания или на дорожку, скрываем
    treeObjs.forEach((t) => {
      const x = t.position.x * Math.cos(ang) - t.position.z * Math.sin(ang);
      const z = t.position.x * Math.sin(ang) + t.position.z * Math.cos(ang);
      const inside = Math.abs(x) < a / 2 + 3.5 && Math.abs(z) < b / 2 + 3.5;
      const onPath = Math.abs(x) < 4 && z > 0 && z < b / 2 + 19;
      t.visible = !inside && !onPath;
    });
    const worldDir = (nx, nz) => {
      const x = nx * Math.cos(ang) + nz * Math.sin(ang), z = -nx * Math.sin(ang) + nz * Math.cos(ang);
      return Math.abs(z) > Math.abs(x) ? (z > 0 ? 4 : 2) : (x > 0 ? 3 : 5);
    };

    // остекление: площадь окон = доля × площадь пола, распределение по сторонам света;
    // каждый фасад делится на простенки-пилястры и отдельные окна с рамой и подоконником
    const floorArea = a * b * floors;
    const glassArea = state.glazing * floorArea;
    const faces = [
      { n: [0, 1], w: a, d: b / 2, rot: 0, main: true },
      { n: [0, -1], w: a, d: b / 2, rot: Math.PI },
      { n: [1, 0], w: b, d: a / 2, rot: Math.PI / 2 },
      { n: [-1, 0], w: b, d: a / 2, rot: -Math.PI / 2 },
    ];
    faces.forEach((f) => {
      const fg = new THREE.Group(); fg.rotation.y = f.rot; group.add(fg);
      const nb = Math.max(2, Math.round(f.w / 3.2)), bay = f.w / nb;
      for (let i = 1; i < nb; i++) {
        addBox(fg, 0.28, floors * FH - 0.3, 0.16, -f.w / 2 + i * bay, P + (floors * FH - 0.3) / 2, f.d + 0.08, mt.trim);
      }
      const dir = worldDir(f.n[0], f.n[1]);
      const share = state.dist === 0 ? 0 : state.dist === 1 ? 0.25 : (dir === state.dist ? 0.55 : 0.15);
      const perFloor = (glassArea * share) / floors;
      if (perFloor <= 0.05) return;
      let ww = bay * 0.62, wh = perFloor / (nb * ww);
      if (wh > 2.5) { wh = 2.5; ww = Math.min(bay * 0.9, perFloor / (nb * wh)); }
      for (let k = 0; k < floors; k++) {
        const yc = P + k * FH + 0.9 + wh / 2 + (k === 0 && f.main ? 0.25 : 0);
        for (let i = 0; i < nb; i++) {
          if (k === 0 && f.main && i === Math.floor(nb / 2)) continue; // место входа
          const xc = -f.w / 2 + (i + 0.5) * bay;
          addBox(fg, ww + 0.16, wh + 0.16, 0.06, xc, yc, f.d + 0.03, mt.frame, false);
          addBox(fg, ww, wh, 0.06, xc, yc, f.d + 0.05, mt.glass, false);
          addBox(fg, ww, 0.04, 0.08, xc, yc, f.d + 0.08, mt.frame, false); // импост
          addBox(fg, ww + 0.3, 0.08, 0.3, xc, yc - wh / 2 - 0.12, f.d + 0.15, mt.slab, false);
        }
      }
      if (f.main) {
        // вход: остеклённые двери, козырёк, ступени
        const dw = Math.min(2.4, bay * 0.8), xc = -f.w / 2 + (Math.floor(nb / 2) + 0.5) * bay;
        addBox(fg, dw + 0.2, 2.6, 0.08, xc, P + 1.3, f.d + 0.04, mt.frame, false);
        addBox(fg, dw, 2.4, 0.06, xc, P + 1.25, f.d + 0.07, mt.glass, false);
        addBox(fg, dw + 1.6, 0.2, 1.8, xc, P + 3.0, f.d + 0.9, mt.slab);
        addBox(fg, dw + 1.0, 0.25, 0.9, xc, 0.125, f.d + 0.7, mt.plinth);
        const path = new THREE.Mesh(new THREE.PlaneGeometry(dw + 0.6, 16), mt.path);
        path.rotation.x = -Math.PI / 2; path.position.set(xc, 0.02, f.d + 9.2); path.receiveShadow = true; fg.add(path);
      }
    });
  }

  shapeLabel();
  initScene();
  update();
})();
