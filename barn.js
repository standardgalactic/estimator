// barn.js
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const ui = {
    len: $("len"),
    wid: $("wid"),
    hgt: $("hgt"),
    pit: $("pit"),
    windows: $("windows"),
    view: $("view"),
    lenVal: $("lenVal"),
    widVal: $("widVal"),
    hgtVal: $("hgtVal"),
    pitVal: $("pitVal"),
    reset: $("reset"),
    toggleSkin: $("toggleSkin"),
    costTable: $("costTable").querySelector("tbody"),
    grandTotal: $("grandTotal"),
    geomReadout: $("geomReadout"),
    costReadout: $("costReadout"),
    canvas: $("c"),
  };

  function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
  function round2(x){ return Math.round(x * 100) / 100; }
  function money(x){
    const v = (Number.isFinite(x) ? x : 0);
    return v.toLocaleString(undefined, { style:"currency", currency:"USD" });
  }

  const defaults = {
    length_ft: 16,
    width_ft: 12,
    wall_ft: 8,
    pitch_rise_per_12: 6,
    windows: 2,
    showSkin: true,
  };

  const state = {
    ...defaults,
    // camera / interaction
    yaw: -0.85,
    pitch: -0.25,
    drag: false,
    lastX: 0,
    lastY: 0,
    viewPreset: "iso",
  };

  // Unit costs are editable; quantities are computed.
  // These are deliberately “good enough” defaults, not regional truth.
  const costModel = [
    { key:"studs_2x4_8", label:"2×4 studs (8 ft)", unit:"ea", unitCost: 4.25, qty: 0 },
    { key:"plates_2x4", label:"2×4 plates (linear ft)", unit:"ft", unitCost: 0.85, qty: 0 },
    { key:"floor_sheath", label:"Floor sheathing (sq ft)", unit:"sqft", unitCost: 1.65, qty: 0 },
    { key:"wall_sheath", label:"Wall sheathing / siding area (sq ft)", unit:"sqft", unitCost: 2.10, qty: 0 },
    { key:"roofing", label:"Roofing (sq ft)", unit:"sqft", unitCost: 2.60, qty: 0 },
    { key:"rafters", label:"Rafters (linear ft)", unit:"ft", unitCost: 1.25, qty: 0 },
    { key:"windows", label:"Windows", unit:"ea", unitCost: 175.00, qty: 0 },
    { key:"fasteners", label:"Fasteners / misc", unit:"allowance", unitCost: 250.00, qty: 1 },
  ];

  const costByKey = new Map(costModel.map(r => [r.key, r]));

  function syncUIFromState(){
    ui.len.value = String(state.length_ft);
    ui.wid.value = String(state.width_ft);
    ui.hgt.value = String(state.wall_ft);
    ui.pit.value = String(state.pitch_rise_per_12);
    ui.windows.value = String(state.windows);
    ui.view.value = state.viewPreset;
    updateValuePills();
  }

  function updateValuePills(){
    ui.lenVal.textContent = `${Number(ui.len.value).toFixed(1)}`;
    ui.widVal.textContent = `${Number(ui.wid.value).toFixed(1)}`;
    ui.hgtVal.textContent = `${Number(ui.hgt.value).toFixed(1)}`;
    ui.pitVal.textContent = `${Number(ui.pit.value).toFixed(1)}/12`;
  }

  function readStateFromUI(){
    state.length_ft = Number(ui.len.value);
    state.width_ft  = Number(ui.wid.value);
    state.wall_ft   = Number(ui.hgt.value);
    state.pitch_rise_per_12 = Number(ui.pit.value);
    state.windows   = Number(ui.windows.value);
    state.viewPreset = ui.view.value;
    updateValuePills();
  }

  // Geometry -> derived quantities (simple, transparent assumptions)
  // Stud spacing: 16" OC. Add extra studs for corners and openings as a crude allowance.
  // Rafter spacing: 24" OC. Ridge runs along length.
  // Roof overhang: fixed small (0.5 ft each side) for now.
  function deriveBill(dim){
    const L = dim.length_ft;
    const W = dim.width_ft;
    const H = dim.wall_ft;
    const pitch = dim.pitch_rise_per_12 / 12;
    const overhang = 0.5;

    const floorArea = L * W;

    const wallPerimeter = 2 * (L + W);
    const wallAreaGross = wallPerimeter * H;

    const windowArea = dim.windows * (3 * 4); // crude 3x4 window opening
    const wallAreaNet = Math.max(0, wallAreaGross - windowArea);

    const run = (W / 2) + overhang;
    const rise = run * pitch;
    const rafterLen = Math.sqrt(run*run + rise*rise);

    const roofArea = 2 * (rafterLen * (L + 2*overhang)); // both sides

    const studsPerLongWall = Math.floor((L*12) / 16) + 1;
    const studsPerShortWall = Math.floor((W*12) / 16) + 1;
    const studsTotal = 2*studsPerLongWall + 2*studsPerShortWall;

    const cornerAllowance = 8; // extra studs for corners/bracing
    const openingAllowance = dim.windows * 2 + 2; // headers/jacks + door-ish allowance
    const studsWithAllowance = studsTotal + cornerAllowance + openingAllowance;

    const platesLF = wallPerimeter * 3; // bottom + double top plates (3 runs)

    const rafterPairs = Math.floor(((L + 2*overhang) * 12) / 24) + 1;
    const raftersLF = rafterPairs * 2 * rafterLen;

    return {
      L, W, H, pitch,
      overhang,
      floorArea,
      wallAreaNet,
      roofArea,
      studs_2x4_8: studsWithAllowance,
      plates_2x4_lf: platesLF,
      rafters_lf: raftersLF,
      windows: dim.windows,
      rafterLen,
      rafterPairs,
    };
  }

  function updateCostQuantities(bill){
    costByKey.get("studs_2x4_8").qty = bill.studs_2x4_8;

    costByKey.get("plates_2x4").qty = round2(bill.plates_2x4_lf);

    costByKey.get("floor_sheath").qty = round2(bill.floorArea);

    costByKey.get("wall_sheath").qty = round2(bill.wallAreaNet);

    costByKey.get("roofing").qty = round2(bill.roofArea);

    costByKey.get("rafters").qty = round2(bill.rafters_lf);

    costByKey.get("windows").qty = bill.windows;
  }

  function computeGrandTotal(){
    let total = 0;
    for (const row of costModel){
      const qty = Number(row.qty) || 0;
      const unitCost = Number(row.unitCost) || 0;
      total += qty * unitCost;
    }
    return total;
  }

  function renderCostTable(){
    ui.costTable.innerHTML = "";
    for (const row of costModel){
      const tr = document.createElement("tr");

      const tdItem = document.createElement("td");
      tdItem.textContent = row.label;

      const tdQty = document.createElement("td");
      tdQty.className = "num";
      tdQty.textContent = (Number(row.qty) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

      const tdUnit = document.createElement("td");
      tdUnit.innerHTML = `<small>${row.unit}</small>`;

      const tdUnitCost = document.createElement("td");
      tdUnitCost.className = "num";
      const inp = document.createElement("input");
      inp.type = "number";
      inp.step = "0.01";
      inp.value = String(row.unitCost);
      inp.style.textAlign = "right";
      inp.addEventListener("input", () => {
        row.unitCost = Number(inp.value);
        updateAll();
      });
      tdUnitCost.appendChild(inp);

      const tdSub = document.createElement("td");
      tdSub.className = "num money";
      const sub = (Number(row.qty)||0) * (Number(row.unitCost)||0);
      tdSub.textContent = money(sub);

      tr.appendChild(tdItem);
      tr.appendChild(tdQty);
      tr.appendChild(tdUnit);
      tr.appendChild(tdUnitCost);
      tr.appendChild(tdSub);

      ui.costTable.appendChild(tr);
    }

    const grand = computeGrandTotal();
    ui.grandTotal.textContent = money(grand);
  }

  // ---------- Wireframe renderer (canvas 2D with 3D transforms) ----------

  const ctx = ui.canvas.getContext("2d", { alpha: true });

  function resizeCanvas(){
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = ui.canvas.getBoundingClientRect();
    ui.canvas.width = Math.floor(rect.width * dpr);
    ui.canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rotY(v, a){
    const c = Math.cos(a), s = Math.sin(a);
    return { x: v.x*c + v.z*s, y: v.y, z: -v.x*s + v.z*c };
  }
  function rotX(v, a){
    const c = Math.cos(a), s = Math.sin(a);
    return { x: v.x, y: v.y*c - v.z*s, z: v.y*s + v.z*c };
  }

  function project(v, w, h){
    // simple perspective-ish projection
    const camDist = 5.2;
    const z = v.z + camDist;
    const f = 1.35 / z;
    return {
      x: w*0.5 + v.x * w * f,
      y: h*0.58 - v.y * w * f,
      z: z
    };
  }

  function drawLine(a, b, alpha=1){
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function buildBarnWire(dim){
    // We work in a normalized model space scaled from feet.
    const L = dim.length_ft;
    const W = dim.width_ft;
    const H = dim.wall_ft;
    const pitch = dim.pitch_rise_per_12 / 12;

    const overhang = 0.5;
    const halfL = (L/2);
    const halfW = (W/2);

    const ridgeRise = (halfW + overhang) * pitch;

    // base corners
    const A = { x:-halfL, y:0, z:-halfW };
    const B = { x: halfL, y:0, z:-halfW };
    const C = { x: halfL, y:0, z: halfW };
    const D = { x:-halfL, y:0, z: halfW };

    // wall top corners
    const A2 = { x:-halfL, y:H, z:-halfW };
    const B2 = { x: halfL, y:H, z:-halfW };
    const C2 = { x: halfL, y:H, z: halfW };
    const D2 = { x:-halfL, y:H, z: halfW };

    // ridge line (along length), centered in width
    const R1 = { x:-halfL, y:H + ridgeRise, z:0 };
    const R2 = { x: halfL, y:H + ridgeRise, z:0 };

    // roof eaves with overhang
    const eZ = halfW + overhang;
    const E1 = { x:-halfL - overhang, y:H, z:-eZ };
    const E2 = { x: halfL + overhang, y:H, z:-eZ };
    const E3 = { x: halfL + overhang, y:H, z: eZ };
    const E4 = { x:-halfL - overhang, y:H, z: eZ };

    const lines = [];

    // floor rectangle
    lines.push([A,B],[B,C],[C,D],[D,A]);

    // walls
    lines.push([A,A2],[B,B2],[C,C2],[D,D2]);
    lines.push([A2,B2],[B2,C2],[C2,D2],[D2,A2]);

    // ridge
    lines.push([R1,R2]);

    // roof edges from ridge to wall tops
    lines.push([R1,A2],[R1,D2],[R2,B2],[R2,C2]);

    // eaves rectangle (visual roof outline)
    lines.push([E1,E2],[E2,E3],[E3,E4],[E4,E1]);

    // roof planes outline
    lines.push([R1,E1],[R2,E2],[R2,E3],[R1,E4]);

    // optional “skin” diagonals to suggest planes
    const skins = [];
    skins.push([E1,R2],[E2,R1]);
    skins.push([E4,R2],[E3,R1]);

    return { lines, skins, H, ridgeY: H + ridgeRise, overhang };
  }

  function applyViewPreset(){
    const v = state.viewPreset;
    if (v === "front"){
      state.yaw = 0;
      state.pitch = -0.1;
    } else if (v === "side"){
      state.yaw = Math.PI/2;
      state.pitch = -0.1;
    } else if (v === "top"){
      state.yaw = 0.9;
      state.pitch = -1.25;
    } else {
      state.yaw = -0.85;
      state.pitch = -0.25;
    }
  }

  function renderBarn(dim, bill){
    const rect = ui.canvas.getBoundingClientRect();
    const Wpx = rect.width;
    const Hpx = rect.height;

    ctx.clearRect(0, 0, Wpx, Hpx);

    // paint subtle grid crosshair
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    ctx.strokeStyle = "rgba(105,255,138,.08)";
    ctx.beginPath();
    ctx.moveTo(Wpx*0.5, 0);
    ctx.lineTo(Wpx*0.5, Hpx);
    ctx.moveTo(0, Hpx*0.58);
    ctx.lineTo(Wpx, Hpx*0.58);
    ctx.stroke();

    const model = buildBarnWire(dim);

    // scale feet to normalized space
    const scale = 1 / Math.max(10, Math.max(dim.length_ft, dim.width_ft) * 1.05);

    function xform(p){
      let v = { x: p.x * scale, y: p.y * scale, z: p.z * scale };
      v = rotY(v, state.yaw);
      v = rotX(v, state.pitch);
      return v;
    }

    // sort lines by depth for nicer overlap
    const all = [];
    for (const seg of model.lines) all.push({ seg, alpha: 0.95, thick: 1.35 });
    if (state.showSkin){
      for (const seg of model.skins) all.push({ seg, alpha: 0.28, thick: 1.0 });
    }

    const withDepth = all.map(o => {
      const a = xform(o.seg[0]);
      const b = xform(o.seg[1]);
      const z = (a.z + b.z) / 2;
      return { ...o, a, b, z };
    }).sort((p,q) => q.z - p.z);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const it of withDepth){
      const pa = project(it.a, Wpx, Hpx);
      const pb = project(it.b, Wpx, Hpx);

      ctx.strokeStyle = "rgba(105,255,138,.85)";
      ctx.shadowColor = "rgba(105,255,138,.22)";
      ctx.shadowBlur = 10;
      ctx.lineWidth = it.thick;

      // depth fade
      const depthFade = clamp(1.15 - it.z*0.85, 0.25, 1.0);
      drawLine(pa, pb, it.alpha * depthFade);
    }

    // readout overlays
    ui.geomReadout.textContent =
      `Geometry — ${dim.length_ft.toFixed(0)}×${dim.width_ft.toFixed(0)} ft · walls ${dim.wall_ft.toFixed(1)} ft · pitch ${dim.pitch_rise_per_12.toFixed(1)}/12`;

    ui.costReadout.textContent =
      `Costs — floor ${bill.floorArea.toFixed(0)} sqft · walls ${bill.wallAreaNet.toFixed(0)} sqft · roof ${bill.roofArea.toFixed(0)} sqft · studs ~${bill.studs_2x4_8}`;
  }

  // ---------- Main update loop ----------

  function updateAll(){
    readStateFromUI();
    applyViewPreset();

    const bill = deriveBill({
      length_ft: state.length_ft,
      width_ft: state.width_ft,
      wall_ft: state.wall_ft,
      pitch_rise_per_12: state.pitch_rise_per_12,
      windows: state.windows,
    });

    updateCostQuantities(bill);
    renderCostTable();
    renderBarn({
      length_ft: state.length_ft,
      width_ft: state.width_ft,
      wall_ft: state.wall_ft,
      pitch_rise_per_12: state.pitch_rise_per_12,
      windows: state.windows,
    }, bill);
  }

  // ---------- Input wiring ----------

  ["len","wid","hgt","pit","windows","view"].forEach(id => {
    $(id).addEventListener("input", updateAll);
    $(id).addEventListener("change", updateAll);
  });

  ui.reset.addEventListener("click", () => {
    Object.assign(state, defaults);
    state.viewPreset = "iso";
    // keep user unit costs as-is, but you can uncomment next lines if you want reset too
    // costModel.forEach(r => r.unitCost = defaultsCosts[r.key] ?? r.unitCost);
    syncUIFromState();
    updateAll();
  });

  ui.toggleSkin.addEventListener("click", () => {
    state.showSkin = !state.showSkin;
    updateAll();
  });

  // Mouse drag rotation
  ui.canvas.addEventListener("mousedown", (e) => {
    state.drag = true;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
  });
  window.addEventListener("mouseup", () => { state.drag = false; });
  window.addEventListener("mousemove", (e) => {
    if (!state.drag) return;
    const dx = e.clientX - state.lastX;
    const dy = e.clientY - state.lastY;
    state.lastX = e.clientX;
    state.lastY = e.clientY;

    state.viewPreset = "iso";
    ui.view.value = "iso";

    state.yaw += dx * 0.0075;
    state.pitch += dy * 0.006;
    state.pitch = clamp(state.pitch, -1.35, 0.35);
    updateAll();
  });

  // Arrow keys orbit; 1/2/3/4 presets
  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowLeft"){ state.yaw -= 0.10; state.viewPreset = "iso"; ui.view.value="iso"; updateAll(); }
    if (k === "ArrowRight"){ state.yaw += 0.10; state.viewPreset = "iso"; ui.view.value="iso"; updateAll(); }
    if (k === "ArrowUp"){ state.pitch -= 0.08; state.pitch = clamp(state.pitch, -1.35, 0.35); state.viewPreset="iso"; ui.view.value="iso"; updateAll(); }
    if (k === "ArrowDown"){ state.pitch += 0.08; state.pitch = clamp(state.pitch, -1.35, 0.35); state.viewPreset="iso"; ui.view.value="iso"; updateAll(); }

    if (k === "1"){ state.viewPreset = "front"; ui.view.value="front"; updateAll(); }
    if (k === "2"){ state.viewPreset = "side"; ui.view.value="side"; updateAll(); }
    if (k === "3"){ state.viewPreset = "top"; ui.view.value="top"; updateAll(); }
    if (k === "4"){ state.viewPreset = "iso"; ui.view.value="iso"; updateAll(); }
  });

  // Resize
  window.addEventListener("resize", () => { resizeCanvas(); updateAll(); });

  // Init
  resizeCanvas();
  syncUIFromState();
  updateAll();
})();

