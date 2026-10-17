import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const V3 = THREE.Vector3, M4 = THREE.Matrix4, Q = THREE.Quaternion;
const $ = id => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
                set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const uid = () => Math.random().toString(36).slice(2, 10);
const served = false;   // the online version has no local helper (avatar loading needs one)
// ---- safety: projects, poses and animation files can come from other people, so everything read from them is cleaned
const safeName = (s, max = 40) => String(s ?? '').replace(/[^A-Za-z0-9_ ()'.,!?&+-]/g, '').trim().slice(0, max);
const safePart = s => String(s ?? '').replace(/[^A-Za-z0-9_ -]/g, '').trim().slice(0, 24);
const safeInt = (v, lo, hi, def) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
const safeImg = s => typeof s === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(s) ? s : '';
const safeAudio = s => typeof s === 'string' && s.length < 4.5e6 && /^data:audio\/[a-z0-9.+-]+;base64,[A-Za-z0-9+\/=]+$/i.test(s) ? s : '';
const PRIORITIES = [0, 1, 2, 3, 4, 5, 1000];
const FPS_LIST = [6, 12, 15, 24, 30, 60];
const escH = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// ================================================================== settings and theme
const settings = Object.assign({ theme: 'light', accent: '#f0507a', defFps: 12, hints: true, tourDone: false, oldImported: false },
  (() => { try { return JSON.parse(store.get('r6flipbook.settings') || '{}'); } catch (e) { return {}; } })());
if (!/^#[0-9a-f]{6}$/i.test(settings.accent)) settings.accent = '#f0507a';
if (!['light', 'dark', 'auto'].includes(settings.theme)) settings.theme = 'light';
if (![6, 12, 15, 24, 30, 60].includes(+settings.defFps)) settings.defFps = 12;
const saveSettings = () => store.set('r6flipbook.settings', JSON.stringify(settings));
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => settings.theme === 'dark' || (settings.theme === 'auto' && darkQuery.matches);

// ================================================================== rig: standard R6 plus optional extra parts
const cf = (x, y, z, r) => new M4().set(r[0], r[1], r[2], x, r[3], r[4], r[5], y, r[6], r[7], r[8], z, 0, 0, 0, 1);
const ROOT = [-1, 0, 0, 0, 0, 1, 0, 1, 0], RIGHT = [0, 0, 1, 0, 1, 0, -1, 0, 0], LEFT = [0, 0, -1, 0, 1, 0, 1, 0, 0];
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const BASE = ['Torso', 'Head', 'Right Arm', 'Left Arm', 'Right Leg', 'Left Leg'];
const MIRROR_BASE = { 'Right Arm': 'Left Arm', 'Left Arm': 'Right Arm', 'Right Leg': 'Left Leg', 'Left Leg': 'Right Leg' };
function baseDefs() {
  const d = (name, size, parent, c0, c1, joint, reach, layout) => ({ name, kind: 'base', size, parent, c0, c1, joint, reach, layout });
  return [
    d('Torso', [2, 2, 1], null, cf(0, 0, 0, ROOT), cf(0, 0, 0, ROOT), [0, 0, 0], [0, 1, 0], 'torso'),
    d('Head', [1.2, 1.2, 1.2], 'Torso', cf(0, 1, 0, ROOT), cf(0, -0.5, 0, ROOT), [0, -0.5, 0], [0, 1, 0], 'head'),
    d('Right Arm', [1, 2, 1], 'Torso', cf(1, 0.5, 0, RIGHT), cf(-0.5, 0.5, 0, RIGHT), [0, 0.5, 0], [0, -1, 0], 'rarm'),
    d('Left Arm', [1, 2, 1], 'Torso', cf(-1, 0.5, 0, LEFT), cf(0.5, 0.5, 0, LEFT), [0, 0.5, 0], [0, -1, 0], 'larm'),
    d('Right Leg', [1, 2, 1], 'Torso', cf(1, -1, 0, RIGHT), cf(0.5, 1, 0, RIGHT), [0, 1, 0], [0, -1, 0], 'rleg'),
    d('Left Leg', [1, 2, 1], 'Torso', cf(-1, -1, 0, LEFT), cf(-0.5, 1, 0, LEFT), [0, 1, 0], [0, -1, 0], 'lleg'),
  ];
}
function extraArmDef(k) {
  const sx = k % 2 === 1 ? 1 : -1, drop = k <= 2 ? 0.6 : 1.1, r = sx > 0 ? RIGHT : LEFT;
  return { name: `Extra Arm ${k}`, kind: 'extra', side: sx, size: [1, 2, 1], parent: 'Torso',
           c0: cf(sx, 0.5 - drop, 0, r), c1: cf(-sx * 0.5, 0.5, 0, r), joint: [0, 0.5, 0], reach: [0, -1, 0], layout: sx > 0 ? 'rarm' : 'larm' };
}
const PROPS = {
  knife: { size: [0.2, 0.2, 1.8], grip: [0, 0, 0.55], color: 0xc3cad3 },
  ball:  { size: [1, 1, 1], grip: [0, 0.6, 0], color: 0xff7a1a },
  block: { size: [0.6, 0.6, 0.6], grip: [0, 0.35, 0], color: 0x9b6a3c },
};
function propDef(name, type, parent) {
  const p = PROPS[type];
  return { name, kind: 'prop', propType: type, size: p.size, parent, c0: cf(0, -1, 0, IDENT), c1: cf(...p.grip, IDENT), joint: p.grip.slice(), reach: [0, 0, -1], layout: null };
}
function finishDef(d) { d.c0i = d.c0.clone().invert(); d.c1i = d.c1.clone().invert(); d.restRel = d.c0.clone().multiply(d.c1i); return d; }

let defs = {}, order = [];
function setParts(list) { defs = {}; order = []; for (const d of list) { defs[d.name] = finishDef(d); order.push(d.name); } }
setParts(baseDefs());
const extraDefsList = () => order.filter(n => defs[n].kind !== 'base').map(n => {
  const d = defs[n]; return d.kind === 'extra' ? { kind: 'extra', k: +n.split(' ').pop() } : { kind: 'prop', name: n, type: d.propType, parent: d.parent };
});
function partsFromList(list) {
  const out = baseDefs(), names = new Set(out.map(d => d.name));
  for (const e of Array.isArray(list) ? list.slice(0, 40) : []) {
    let d = null;
    if (e && e.kind === 'extra') { const k = safeInt(e.k, 1, 4, 0); if (k) d = extraArmDef(k); }
    else if (e && e.kind === 'prop') {
      const name = safePart(e.name), parent = safePart(e.parent);
      if (name && names.has(parent) && Object.hasOwn(PROPS, e.type)) d = propDef(name, e.type, parent);
    }
    if (d && !names.has(d.name)) { names.add(d.name); out.push(d); }
  }
  return out;
}
const children = n => order.filter(c => defs[c].parent === n);
function descendants(n) { const out = [n]; for (const c of children(n)) out.push(...descendants(c)); return out; }
function restWorld(n, P) { const d = defs[n]; return d.parent ? P[d.parent].clone().multiply(d.restRel) : d.restRel.clone(); }
function restPose() { const P = {}; for (const n of order) P[n] = restWorld(n, P); return P; }
const clonePose = P => Object.fromEntries(Object.keys(P).map(n => [n, P[n].clone()]));
function transformsFromWorlds(W) {
  const T = {};
  for (const n of order) {
    const d = defs[n], parent = d.parent ? W[d.parent] : new M4();
    T[n] = d.c0i.clone().multiply(parent.clone().invert()).multiply(W[n]).multiply(d.c1);
  }
  return T;
}
function worldsFromTransforms(T) {
  const W = {};
  for (const n of order) {
    const d = defs[n], parent = d.parent ? W[d.parent] : new M4();
    W[n] = parent.clone().multiply(d.c0).multiply(T[n] || new M4()).multiply(d.c1i);
  }
  return W;
}
// Roblox blends keyframes per joint: position lerp + rotation slerp of each Motor6D Transform.
function blendPoses(A_, B_, u) {
  const TA = transformsFromWorlds(A_), TB = transformsFromWorlds(B_), T = {};
  const pa = new V3(), pb = new V3(), qa = new Q(), qb = new Q(), s = new V3();
  for (const n of order) {
    TA[n].decompose(pa, qa, s); TB[n].decompose(pb, qb, s);
    T[n] = new M4().compose(pa.clone().lerp(pb, u), qa.clone().slerp(qb, u), new V3(1, 1, 1));
  }
  return worldsFromTransforms(T);
}
const samePose = (a, b) => a.elements.every((v, k) => Math.abs(v - b.elements[k]) < 1e-4);
const samePoseAll = (A_, B_) => order.every(n => samePose(A_[n], B_[n]));
// "Test for Roblox": slide the whole body so the torso is over the centre spot (keeps pose, lean and height)
function centered(P) {
  const t = new V3().setFromMatrixPosition(P.Torso), M = new M4().makeTranslation(-t.x, 0, -t.z), out = {};
  for (const n of Object.keys(P)) out[n] = M.clone().multiply(P[n]);
  return out;
}

// ================================================================== project state
const ANIM_TYPES = {
  run:    { label: 'Run', loop: true, priority: 1 },
  walk:   { label: 'Walk', loop: true, priority: 1 },
  idle:   { label: 'Idle', loop: true, priority: 0 },
  jump:   { label: 'Jump', loop: false, priority: 1 },
  combat: { label: 'Combat', loop: false, priority: 2 },
  other:  { label: 'Other', loop: true, priority: 2 },
};
const newFrame = P => ({ P, hold: 1, markers: [] });
const newAnim = (name, type, extra = {}) => ({ id: uid(), name, type, loop: ANIM_TYPES[type].loop, priority: ANIM_TYPES[type].priority,
  frames: [newFrame(restPose())], touched: false, ...extra });
let project = null, A = 0, frames = [], cur = 0;
let fsel = new Set();                 // multi-selected frames (indices in the current animation)
let selected = null, clip = null, partClip = null, playing = false, playTime = 0, play = null;
let onion = true, pivotMode = 'joint', axesMode = 'world', liveMirror = false, testMode = false, rate = 1;
const undoStack = [], redoStack = [];
const scene3 = { dummy: false, dummyDist: 4, floor: false, floorSpeed: 16 };
const thumbStore = new Map();
const anim = () => project.anims[A];
const thumbsOf = a => { if (!thumbStore.has(a.id)) thumbStore.set(a.id, []); return thumbStore.get(a.id); };
const fps = () => project.fps;
const smooth = () => project.smooth;

// ================================================================== renderer and scene
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.domElement.className = 'gl';
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const BG = new THREE.Color(0xf4f4f7);
scene.background = BG;
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3b5, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(6, 12, -8); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0xdedee6 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -3.001; scene.add(ground);
let grid = null;
function makeGrid(c1, c2) { const z = grid ? grid.position.z : 0; if (grid) scene.remove(grid); grid = new THREE.GridHelper(60, 60, c1, c2); grid.position.set(0, -3, z); scene.add(grid); }
makeGrid(0xb9b9c6, 0xcdcdd8);

// ------------------------------------------------------------------ clothing template mapping (classic 585 x 559 layout)
const TW = 585, TH = 559;
const R_ = (x, y, w, h) => ({ x, y, w, h });
const LAYOUT = {
  torso: { nz: R_(231, 74, 128, 128), pz: R_(427, 74, 128, 128), px: R_(165, 74, 64, 128), nx: R_(361, 74, 64, 128), py: R_(231, 8, 128, 64), ny: R_(231, 204, 128, 64) },
  rarm:  { py: R_(217, 289, 64, 64), ny: R_(217, 485, 64, 64), nx: R_(19, 355, 64, 128), pz: R_(85, 355, 64, 128), px: R_(151, 355, 64, 128), nz: R_(217, 355, 64, 128) },
  larm:  { py: R_(308, 289, 64, 64), ny: R_(308, 485, 64, 64), nz: R_(308, 355, 64, 128), nx: R_(374, 355, 64, 128), pz: R_(440, 355, 64, 128), px: R_(506, 355, 64, 128) },
};
LAYOUT.rleg = LAYOUT.rarm; LAYOUT.lleg = LAYOUT.larm;
const FACE_AXES = { px: [[0, 0, -1], [0, 1, 0]], nx: [[0, 0, 1], [0, 1, 0]], py: [[-1, 0, 0], [0, 0, 1]],
                    ny: [[-1, 0, 0], [0, 0, -1]], pz: [[1, 0, 0], [0, 1, 0]], nz: [[-1, 0, 0], [0, 1, 0]] };
const FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
function templateUV(geo, size, layout) {
  const pos = geo.attributes.position, uv = geo.attributes.uv, half = size.map(s => s / 2);
  for (let f = 0; f < 6; f++) {
    const rect = layout[FACE_ORDER[f]], [ra, ua] = FACE_AXES[FACE_ORDER[f]];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k, p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const ext = ax => ax.reduce((s, a, j) => s + Math.abs(a) * half[j], 0);
      const s = (p[0] * ra[0] + p[1] * ra[1] + p[2] * ra[2]) / ext(ra), t = (p[0] * ua[0] + p[1] * ua[1] + p[2] * ua[2]) / ext(ua);
      uv.setXY(i, (rect.x + (s + 1) / 2 * rect.w) / TW, 1 - (rect.y + (1 - (t + 1) / 2) * rect.h) / TH);
    }
  }
  uv.needsUpdate = true;
}
const LOOK_SCALE = 2;
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const upperCanvas = mkCanvas(TW * LOOK_SCALE, TH * LOOK_SCALE), lowerCanvas = mkCanvas(TW * LOOK_SCALE, TH * LOOK_SCALE), headCanvas = mkCanvas(256, 256);
const mkTex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
const upperTex = mkTex(upperCanvas), lowerTex = mkTex(lowerCanvas), headTex = mkTex(headCanvas);
const DEFAULT_LOOK = { colors: { head: 'f5cd30', torso: '0d69ac', rightArm: 'f5cd30', leftArm: 'f5cd30', rightLeg: 'a4bd47', leftLeg: 'a4bd47' }, images: {} };
let look = DEFAULT_LOOK;
const headSideMat = new THREE.MeshLambertMaterial({ color: 0xf5cd30 });
function drawLook(L) {
  const col = k => '#' + (L.colors[k] || DEFAULT_LOOK.colors[k]);
  const fillRects = (g, layout, color) => { g.fillStyle = color; for (const r of Object.values(layout)) g.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2); };
  const clipTo = (g, layouts) => { g.beginPath(); for (const l of layouts) for (const r of Object.values(l)) g.rect(r.x, r.y, r.w, r.h); g.clip(); };
  let g = upperCanvas.getContext('2d');
  g.setTransform(LOOK_SCALE, 0, 0, LOOK_SCALE, 0, 0); g.clearRect(0, 0, TW, TH);
  fillRects(g, LAYOUT.torso, col('torso')); fillRects(g, LAYOUT.rarm, col('rightArm')); fillRects(g, LAYOUT.larm, col('leftArm'));
  if (L.images.pants) { g.save(); clipTo(g, [LAYOUT.torso]); g.drawImage(L.images.pants, 0, 0, TW, TH); g.restore(); }
  if (L.images.shirt) g.drawImage(L.images.shirt, 0, 0, TW, TH);
  if (L.images.tshirt) { const f = LAYOUT.torso.nz; g.drawImage(L.images.tshirt, f.x, f.y, f.w, f.h); }
  g = lowerCanvas.getContext('2d');
  g.setTransform(LOOK_SCALE, 0, 0, LOOK_SCALE, 0, 0); g.clearRect(0, 0, TW, TH);
  fillRects(g, LAYOUT.rarm, col('rightLeg')); fillRects(g, LAYOUT.larm, col('leftLeg'));
  if (L.images.pants) { g.save(); clipTo(g, [LAYOUT.rarm, LAYOUT.larm]); g.drawImage(L.images.pants, 0, 0, TW, TH); g.restore(); }
  g = headCanvas.getContext('2d');
  g.fillStyle = col('head'); g.fillRect(0, 0, 256, 256);
  if (L.images.face) g.drawImage(L.images.face, 0, 0, 256, 256);
  else {
    g.fillStyle = '#222'; g.beginPath(); g.ellipse(88, 104, 14, 24, 0, 0, Math.PI * 2); g.ellipse(168, 104, 14, 24, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.arc(128, 140, 52, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
  }
  headSideMat.color.set(col('head'));
  upperTex.needsUpdate = lowerTex.needsUpdate = headTex.needsUpdate = true;
}
drawLook(look);

// ------------------------------------------------------------------ bodies (main, two ghosts, dummy)
function makeMesh(d, style) {
  const geo = d.kind === 'prop' && d.propType === 'ball' ? new THREE.SphereGeometry(0.5, 24, 16) : new THREE.BoxGeometry(...d.size);
  let mat;
  if (style === 'ghostPrev' || style === 'ghostNext') mat = new THREE.MeshBasicMaterial({ color: style === 'ghostPrev' ? 0xff4d6d : 0x2fbf5b, transparent: true, opacity: 0.22, depthWrite: false });
  else if (style === 'dummy') mat = new THREE.MeshLambertMaterial({ color: 0xa3a8b3 });
  else if (d.kind === 'prop') mat = new THREE.MeshLambertMaterial({ color: PROPS[d.propType].color, emissive: d.propType === 'ball' ? 0x8a2a00 : 0x000000 });
  else if (d.layout === 'head') mat = [headSideMat, headSideMat, headSideMat, headSideMat, headSideMat, new THREE.MeshLambertMaterial({ map: headTex })];
  else { templateUV(geo, d.size, LAYOUT[d.layout]); mat = new THREE.MeshLambertMaterial({ map: d.layout === 'rleg' || d.layout === 'lleg' ? lowerTex : upperTex }); }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false; mesh.name = d.name;
  if (style === 'main' || style === 'dummy') {
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0x2a2a33 })));
    if (d.kind === 'prop' && d.propType === 'knife' && style === 'main') {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.55), new THREE.MeshLambertMaterial({ color: 0x3b2b20 }));
      h.position.z = 0.6; mesh.add(h);
    }
  }
  scene.add(mesh);
  return mesh;
}
class Body {
  constructor(style) { this.style = style; this.meshes = {}; }
  sync(names) {
    for (const n of Object.keys(this.meshes)) if (!names.includes(n)) { scene.remove(this.meshes[n]); delete this.meshes[n]; }
    for (const n of names) if (!this.meshes[n]) this.meshes[n] = makeMesh(defs[n], this.style);
  }
  show(P, visible = true) {
    for (const n of Object.keys(this.meshes)) {
      const m = this.meshes[n];
      if (P[n]) { m.matrix.copy(P[n]); m.matrixWorldNeedsUpdate = true; m.visible = visible; } else m.visible = false;
    }
  }
}
const body = new Body('main'), ghostPrev = new Body('ghostPrev'), ghostNext = new Body('ghostNext'), dummy = new Body('dummy');
function syncBodies() {
  for (const b of [body, ghostPrev, ghostNext]) {
    for (const n of Object.keys(b.meshes)) if (defs[n] && b.meshes[n].userData.def && b.meshes[n].userData.def.propType !== defs[n].propType) { scene.remove(b.meshes[n]); delete b.meshes[n]; }
    b.sync(order);
    for (const n of order) b.meshes[n].userData.def = defs[n];
  }
}
dummy.sync(BASE);
syncBodies();
function placeDummy() {
  const P = {}, R = restPose(), base = new M4().makeTranslation(0, 0, -scene3.dummyDist).multiply(new M4().makeRotationY(Math.PI));
  for (const n of BASE) P[n] = base.clone().multiply(R[n]);
  dummy.show(P, scene3.dummy);
}
const viewPose = P => testMode ? centered(P) : P;

// ================================================================== gizmo: arrows move, rings turn
const gizmo = new THREE.Group(); gizmo.visible = false; scene.add(gizmo);
const AXES = [new V3(1, 0, 0), new V3(0, 1, 0), new V3(0, 0, 1)];
const AXIS_COLORS = [0xff3653, 0x8adb00, 0x2c8fff];
const HOVER = 0xffd23f;
const handles = [];
const hidden = new THREE.MeshBasicMaterial({ visible: false });
const gmat = c => new THREE.MeshBasicMaterial({ color: c, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
for (let i = 0; i < 3; i++) {
  const m = gmat(AXIS_COLORS[i]);
  const arrow = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 8), m); shaft.position.y = 0.55;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 16), m); tip.position.y = 1.24;
  const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.45, 8), hidden); pick.position.y = 0.73;
  arrow.add(shaft, tip, pick);
  if (i === 0) arrow.rotation.z = -Math.PI / 2; else if (i === 2) arrow.rotation.x = Math.PI / 2;
  gizmo.add(arrow);
  handles.push({ type: 'move', axis: i, pick, mats: [m] });
  const rm = gmat(AXIS_COLORS[i]);
  const ring = new THREE.Group();
  ring.add(new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.022, 8, 72), rm));
  const rpick = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.1, 6, 48), hidden); ring.add(rpick);
  if (i === 0) ring.rotation.y = Math.PI / 2; else if (i === 1) ring.rotation.x = Math.PI / 2;
  gizmo.add(ring);
  handles.push({ type: 'turn', axis: i, pick: rpick, mats: [rm] });
}
gizmo.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), gmat(0xffffff)));
gizmo.traverse(o => { if (o.isMesh) o.renderOrder = 999; });
const pickers = handles.map(h => h.pick);
let hovered = null;
function setHover(h) {
  if (hovered === h) return;
  if (hovered) hovered.mats.forEach(m => m.color.setHex(AXIS_COLORS[hovered.axis]));
  hovered = h;
  if (h) h.mats.forEach(m => m.color.setHex(HOVER));
  renderer.domElement.style.cursor = h ? 'grab' : '';
}
function pivotPoint(P, n) { return (pivotMode === 'joint' ? new V3(...defs[n].joint) : new V3()).applyMatrix4(P[n]); }
function axisDirs(P, n) {
  if (axesMode === 'world') return AXES.map(a => a.clone());
  const x = new V3(), y = new V3(), z = new V3(); P[n].extractBasis(x, y, z);
  return [x.normalize(), y.normalize(), z.normalize()];
}
let drawing = false;
function placeGizmo() {
  gizmo.visible = !!project && !!selected && !playing && !drawing && !testMode && !!defs[selected];
  if (!gizmo.visible) return;
  const P = frames[cur].P, p = pivotPoint(P, selected);
  gizmo.position.copy(p);
  if (axesMode === 'local') { const q = new Q(), s = new V3(), t = new V3(); P[selected].decompose(t, q, s); gizmo.quaternion.copy(q); }
  else gizmo.quaternion.identity();
  gizmo.scale.setScalar(camera.position.distanceTo(p) * 0.11);
}

// ------------------------------------------------------------------ mirroring helpers
const S_MIRROR = new M4().makeScale(-1, 1, 1);
function partnerOf(n) {
  if (MIRROR_BASE[n]) return MIRROR_BASE[n];
  const m = /^Extra Arm (\d)$/.exec(n);
  if (m) { const k = +m[1], p = `Extra Arm ${k % 2 ? k + 1 : k - 1}`; return defs[p] ? p : null; }
  return null;
}
// put the partner of n where n would be if mirrored across the torso's own middle
function mirrorPartInto(P, n) {
  const p = partnerOf(n); if (!p) return;
  const T = P.Torso, rel = T.clone().invert().multiply(P[n]);
  placePart(P, p, T.clone().multiply(S_MIRROR.clone().multiply(rel).multiply(S_MIRROR)));
}
function mirrorPose(P) {
  const out = {}, partner = n => partnerOf(n) || n;
  for (const n of order) {
    const d = defs[n];
    if (d.kind === 'prop') {
      const rel = P[d.parent].clone().invert().multiply(P[n]);
      out[n] = out[d.parent].clone().multiply(S_MIRROR.clone().multiply(rel).multiply(S_MIRROR));
    } else out[n] = S_MIRROR.clone().multiply(P[partner(n)]).multiply(S_MIRROR);
  }
  return out;
}
function placePart(P, n, W, carry = true) {
  const delta = W.clone().multiply(P[n].clone().invert());
  const list = carry ? (n === 'Torso' ? order.slice() : descendants(n)) : [n];
  for (const k of list) P[k] = delta.clone().multiply(P[k]);
}

// ================================================================== pointer: drag handles, click to select
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let drag = null, down = null, rdown = null, controls;
function setRay(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function hitHandle(e) {
  if (!gizmo.visible) return null;
  setRay(e); scene.updateMatrixWorld();
  const hit = ray.intersectObjects(pickers, false)[0];
  return hit ? handles.find(h => h.pick === hit.object) : null;
}
function hitPart(e) {
  setRay(e); scene.updateMatrixWorld();
  const hit = ray.intersectObjects(order.map(n => body.meshes[n]).filter(m => m.visible), false)[0];
  return hit ? hit.object.name : null;
}
function closestOnAxis(origin, dir) {
  const o = ray.ray.origin, d = ray.ray.direction, w = origin.clone().sub(o);
  const b = dir.dot(d), den = 1 - b * b;
  if (Math.abs(den) < 1e-4) return null;
  return (b * d.dot(w) - dir.dot(w)) / den;
}
function ringVector() {
  const n = drag.axisW, o = ray.ray.origin, d = ray.ray.direction, dn = d.dot(n);
  if (Math.abs(dn) < 0.2) return null;
  const t = drag.pivot.clone().sub(o).dot(n) / dn;
  return o.clone().addScaledVector(d, t).sub(drag.pivot);
}
const movedParts = (n, altKey) => altKey ? [n] : n === 'Torso' ? order.slice() : descendants(n);
renderer.domElement.addEventListener('pointerdown', e => {
  hideMenu();
  if (e.button === 2) { rdown = { x: e.clientX, y: e.clientY }; return; }
  if (e.button !== 0 || drawing || !project) return;
  closePanels(['markerPop']);
  const h = hitHandle(e);
  if (h) {
    stopPlay();
    const P = frames[cur].P;
    drag = { h, axisW: axisDirs(P, selected)[h.axis], pivot: pivotPoint(P, selected), x0: e.clientX, y0: e.clientY,
             parts: movedParts(selected, e.altKey), base: clonePose(P), before: snapshot() };
    setRay(e);
    if (h.type === 'move') drag.s0 = closestOnAxis(drag.pivot, drag.axisW) ?? 0;
    else { const v = ringVector(); if (v === null) drag.screen = true; else drag.v0 = v; }
    controls.enabled = false;
    renderer.domElement.setPointerCapture(e.pointerId);
    renderer.domElement.style.cursor = 'grabbing';
    e.preventDefault();
  } else down = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointermove', e => {
  if (drawing || !project) return;
  if (!drag) { if (!down) setHover(hitHandle(e)); return; }
  setRay(e);
  const P = frames[cur].P;
  let M;
  if (drag.h.type === 'move') {
    const s = closestOnAxis(drag.pivot, drag.axisW);
    if (s === null) return;
    let d = s - drag.s0;
    if (e.shiftKey) d = Math.round(d * 4) / 4;
    M = new M4().makeTranslation(drag.axisW.clone().multiplyScalar(d));
  } else {
    let a;
    if (drag.screen) a = (e.clientX - drag.x0 + (e.clientY - drag.y0)) * 0.012;
    else { const v = ringVector(); if (v === null) return; a = Math.atan2(drag.v0.clone().cross(v).dot(drag.axisW), drag.v0.dot(v)); }
    if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    const p = drag.pivot;
    M = new M4().makeTranslation(p.x, p.y, p.z).multiply(new M4().makeRotationAxis(drag.axisW, a)).multiply(new M4().makeTranslation(-p.x, -p.y, -p.z));
  }
  for (const n of drag.parts) P[n] = M.clone().multiply(drag.base[n]);
  if (liveMirror && selected !== 'Torso' && partnerOf(selected)) mirrorPartInto(P, selected);
  body.show(viewPose(P));
});
renderer.domElement.addEventListener('pointerup', e => {
  if (drag) {
    undoStack.push(drag.before); redoStack.length = 0;
    drag = null; controls.enabled = true; renderer.domElement.style.cursor = '';
    changed(); return;
  }
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && !testMode) select(hitPart(e));
  down = null;
});
renderer.domElement.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!project || drawing || !rdown || Math.hypot(e.clientX - rdown.x, e.clientY - rdown.y) > 5) return;
  const n = testMode ? null : hitPart(e);
  if (n) { select(n); showMenu(e.clientX, e.clientY, partMenu(n)); }
  else showMenu(e.clientX, e.clientY, viewMenu());
});
controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, -0.5, 0);
controls.enableDamping = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
// Roblox's default camera sits about 12.5 studs behind the head; shift-lock shifts it 1.75 studs to the right
const VIEWS = { angle: [[7.5, 2.5, -10], [0, -0.5, 0]], front: [[0, 0.5, -14], [0, -0.5, 0]], side: [[14, 0.5, 0], [0, -0.5, 0]],
                back: [[0, 0.5, 14], [0, -0.5, 0]], game: [[0, 5.5, 11.5], [0, 1.5, 0]], shiftlock: [[1.75, 5, 11.5], [1.75, 1.5, 0]] };
function setView(name) { const [p, t] = VIEWS[name]; camera.position.set(...p); controls.target.set(...t); controls.update(); }
setView('angle');

// ================================================================== selection card
function select(n) {
  selected = n && defs[n] ? n : null;
  $('sel').style.display = selected ? 'block' : 'none';
  if (selected) {
    $('selName').textContent = selected;
    $('carryNote').textContent = selected === 'Torso' ? 'Moves the whole body. Hold Alt for torso only.'
      : children(selected).length ? 'Things held in this part move with it. Hold Alt to move only this part.' : '';
    $('carryNote').style.display = $('carryNote').textContent ? 'flex' : 'none';
    $('pastePart').disabled = !partClip || !defs[partClip.name];
    $('pastePart').textContent = partClip && defs[partClip.name] ? `Paste ${partClip.name}` : 'Paste part';
    $('liveMirrorBtn').parentElement.style.display = partnerOf(selected) ? 'flex' : 'none';
  }
  for (const k of order) {
    const edges = body.meshes[k]?.children[0];
    if (edges && edges.isLineSegments) edges.material.color.setHex(k === selected ? accentHex() : 0x2a2a33);
  }
}
function seg(id, set) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    [...$(id).children].forEach(c => c.classList.toggle('on', c === b));
    set(b.dataset.v);
  });
}
seg('pivotSeg', v => pivotMode = v);
seg('axesSeg', v => axesMode = v);
function resetPart(n) {
  record();
  const P = frames[cur].P;
  if (n === 'Torso') frames[cur].P = restPose(); else placePart(P, n, restWorld(n, P));
  changed();
}
function copyPart(n) {
  const P = frames[cur].P, d = defs[n];
  partClip = { name: n, rel: d.parent ? P[d.parent].clone().invert().multiply(P[n]) : P[n].clone() };
  toast(`Copied ${n}`); select(selected);
}
function pastePart() {
  if (!partClip || !defs[partClip.name]) return;
  record();
  const P = frames[cur].P, d = defs[partClip.name];
  placePart(P, partClip.name, d.parent ? P[d.parent].clone().multiply(partClip.rel) : partClip.rel.clone());
  changed(); toast(`Pasted ${partClip.name} onto frame ${cur + 1}`);
}
$('resetPart').onclick = () => selected && resetPart(selected);
$('copyPart').onclick = () => selected && copyPart(selected);
$('pastePart').onclick = pastePart;
function setLiveMirror(on) {
  liveMirror = on;
  $('liveMirrorBtn').textContent = `Live mirror: ${on ? 'on' : 'off'}`;
  $('liveMirrorBtn').classList.toggle('on', on);
  toast(on ? 'Live mirror on: posing one side also poses the other' : 'Live mirror off');
}
$('liveMirrorBtn').onclick = () => setLiveMirror(!liveMirror);

// ================================================================== serialisation, undo, autosave
const serM = m => m.toArray().map(v => +v.toFixed(6));
const serPose = P => Object.fromEntries(Object.keys(P).filter(n => defs[n]).map(n => [n, serM(P[n])]));
function deserPose(o) { const P = restPose(); for (const n of order) if (o && o[n]) P[n] = new M4().fromArray(o[n]); return P; }
const normMarker = m => {
  if (typeof m === 'string') return { name: safePart(m) || 'Marker' };
  const out = { name: safePart(m && m.name) || 'Marker' };
  if (m && m.sound) out.sound = String(m.sound).replace(/\D/g, '').slice(0, 20) || 'preview';
  if (m && m.audio) out.audio = String(m.audio).replace(/[^a-z0-9]/g, '').slice(0, 16) || null;
  return out;
};
const serFrame = f => ({ P: serPose(f.P), hold: f.hold, markers: f.markers.map(normMarker) });
const deserFrame = f => ({ P: deserPose(f && f.P), hold: safeInt(f && f.hold, 1, 999, 1), markers: (Array.isArray(f && f.markers) ? f.markers.slice(0, 20) : []).map(normMarker) });
function serProject() {
  return { v: 3, id: project.id, name: project.name, created: project.created, updated: Date.now(), fps: project.fps, smooth: project.smooth,
           avatar: project.avatar || '', parts: extraDefsList(), guide: project.guide || null, A, cur,
           anims: project.anims.map(a => ({ id: a.id, name: a.name, type: a.type, loop: a.loop, priority: a.priority, touched: !!a.touched, frames: a.frames.map(serFrame) })),
           sounds: project.sounds || {} };
}
function deserProject(o) {
  setParts(partsFromList(o.parts)); syncBodies();
  const sounds = {};
  if (o.sounds && typeof o.sounds === 'object') for (const [k, v] of Object.entries(o.sounds).slice(0, 50)) { const a = safeAudio(v); if (a) sounds[String(k).replace(/[^a-z0-9]/g, '').slice(0, 16)] = a; }
  const anims = (Array.isArray(o.anims) ? o.anims.slice(0, 50) : []).filter(a => a && Array.isArray(a.frames) && a.frames.length).map(a => ({
    id: uid(), name: safeName(a.name) || 'Animation', type: Object.hasOwn(ANIM_TYPES, a.type) ? a.type : 'other', loop: !!a.loop,
    priority: PRIORITIES.includes(+a.priority) ? +a.priority : 2, touched: !!a.touched, frames: a.frames.slice(0, 2000).map(deserFrame) }));
  if (!anims.length) throw new Error('no animations');
  return { id: typeof o.id === 'string' ? (o.id.replace(/[^a-z0-9]/g, '').slice(0, 16) || uid()) : uid(), name: safeName(o.name) || 'Animation',
           created: +o.created || Date.now(), fps: FPS_LIST.includes(+o.fps) ? +o.fps : 12, smooth: o.smooth !== false,
           avatar: '', guide: o.guide && o.guide.active ? { active: true } : null, sounds, anims,
           _A: safeInt(o.A, 0, anims.length - 1, 0), _cur: safeInt(o.cur, 0, 1e6, 0) };
}
function snapshot() { const s = serProject(); delete s.sounds; return JSON.stringify(s); }
function restore(s) {
  const o = JSON.parse(s), sounds = project.sounds, id = project.id;
  project = deserProject(o); project.sounds = sounds; project.id = id;
  useAnim(Math.min(o.A, project.anims.length - 1), o.cur, true);
  if (selected && !defs[selected]) select(null);
  rethumbAll(); refresh(); refreshPartsPanel();
}
function record() { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; }
function undo() { if (!undoStack.length) return; stopPlay(); redoStack.push(snapshot()); restore(undoStack.pop()); saveSoon(); }
function redo() { if (!redoStack.length) return; stopPlay(); undoStack.push(snapshot()); restore(redoStack.pop()); saveSoon(); }

// projects are kept in the browser's IndexedDB (one copy each, no files pile up); Save/Open use real files
const db = {
  _p: null, mem: new Map(),
  open() {
    if (this._p) return this._p;
    this._p = new Promise(res => {
      try { const r = indexedDB.open('r6flipbook', 2);
            r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
                                         if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); };
            r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); }
    });
    return this._p;
  },
  async all() {
    const d = await this.open(); if (!d) return [...this.mem.values()];
    return new Promise(res => { const out = []; try { const req = d.transaction('projects').objectStore('projects').openCursor();
      req.onsuccess = e => { const c = e.target.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; req.onerror = () => res(out); } catch (e) { res(out); } });
  },
  async put(rec) {
    const d = await this.open(); if (!d) { this.mem.set(rec.id, rec); return; }
    return new Promise(res => { try { const tx = d.transaction('projects', 'readwrite'); tx.objectStore('projects').put(rec); tx.oncomplete = () => res(); tx.onerror = () => res(); } catch (e) { this.mem.set(rec.id, rec); res(); } });
  },
  async kvGet(k) {
    const d = await this.open(); if (!d) return this.mem.get('kv:' + k);
    return new Promise(res => { try { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch (e) { res(undefined); } });
  },
  async kvSet(k, v) {
    const d = await this.open(); if (!d) { this.mem.set('kv:' + k, v); return; }
    return new Promise(res => { try { const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => res(); } catch (e) { res(); } });
  },
  async del(id) {
    const d = await this.open(); if (!d) { this.mem.delete(id); return; }
    return new Promise(res => { try { const tx = d.transaction('projects', 'readwrite'); tx.objectStore('projects').delete(id); tx.oncomplete = () => res(); tx.onerror = () => res(); } catch (e) { res(); } });
  },
};
let saveTimer = null;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
async function saveNow() {
  if (!project) return;
  clearTimeout(saveTimer);
  const data = serProject(), first = project.anims[0];
  const cover = thumbsOf(first)[0] || renderPoseImage(first.frames[0].P);
  await db.put({ id: project.id, name: project.name, updated: Date.now(), cover, kind: project.anims.map(a => a.name).join(' → '), data: JSON.stringify(data) });
}
window.addEventListener('beforeunload', () => { if (project) saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && project) saveNow(); });

// ================================================================== thumbnails and the frame strip
const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
thumbRenderer.setSize(224, 168);
const thumbCam = new THREE.PerspectiveCamera(35, 224 / 168, 0.1, 100);
thumbCam.position.set(7.5, 1.5, -10); thumbCam.lookAt(0, -0.6, 0);
function renderPoseImage(P) {
  const keep = { gizmo: gizmo.visible, bg: scene.background, ground: ground.visible, gz: grid.position.z };
  gizmo.visible = false; scene.background = BG; ground.visible = true; grid.position.z = 0;
  ghostPrev.show(P, false); ghostNext.show(P, false); dummy.show({}, false);
  const edgeColors = order.map(n => body.meshes[n]?.children[0]?.material?.color?.getHex());
  order.forEach(n => body.meshes[n]?.children[0]?.material?.color?.setHex?.(0x2a2a33));
  body.show(P); scene.updateMatrixWorld();
  thumbRenderer.render(scene, thumbCam);
  const url = thumbRenderer.domElement.toDataURL('image/png');
  order.forEach((n, k) => edgeColors[k] !== undefined && body.meshes[n].children[0].material.color.setHex(edgeColors[k]));
  gizmo.visible = keep.gizmo; scene.background = keep.bg; ground.visible = keep.ground; grid.position.z = keep.gz;
  return url;
}
function renderThumb(i) { thumbsOf(anim())[i] = renderPoseImage(frames[i].P); }
function rethumbAll() { for (const a of project.anims) thumbStore.set(a.id, a.frames.map(f => renderPoseImage(f.P))); }
function changed() { anim().touched = true; renderThumb(cur); refresh(); saveSoon(); }

function useAnim(i, c = 0, quiet) {
  A = Math.max(0, Math.min(project.anims.length - 1, i));
  frames = anim().frames; cur = Math.max(0, Math.min(frames.length - 1, c || 0)); fsel = new Set();
  if (!quiet) refresh();
}
function refresh() {
  if (!project) return;
  const strip = $('strip'); strip.innerHTML = '';
  project.anims.forEach((a, k) => {
    if (k > 0) { const l = document.createElement('div'); l.className = 'link'; const pl = project.anims[k - 1].loop; l.textContent = pl ? '·' : '→'; l.title = pl ? 'The one before loops, so it never flows into this one by itself' : 'Flows into the next animation'; strip.appendChild(l); }
    const wrap = document.createElement('div'); wrap.className = 'secWrap' + (k === A ? ' cur' : '');
    wrap.innerHTML = `<div class="secHead"><b>${escH(a.name)}</b><span>${ANIM_TYPES[a.type].label} · ${a.loop ? '↻ loops' : 'plays once'} · ${a.frames.length} frame${a.frames.length > 1 ? 's' : ''}</span></div>`;
    const row = document.createElement('div'); row.className = 'secFrames';
    const th = thumbsOf(a);
    a.frames.forEach((f, i) => {
      const d = document.createElement('div');
      const isCur = k === A && i === cur, isSel = k === A && fsel.has(i) && fsel.size > 1;
      d.className = 'frame' + (isCur ? ' cur' : '') + (isSel ? ' sel' : '');
      d.style.width = (100 + Math.min(f.hold - 1, 3) * 16) + 'px';
      const marks = f.markers.map(m => m.sound ? '♪' : '⚑ ' + m.name).join(' ');
      d.innerHTML = `<img alt="" src="${th[i] || ''}"><span class="num">${i + 1}</span>` +
        (f.hold > 1 ? `<span class="hold">×${f.hold}</span>` : '') + (marks ? `<span class="mark">${escH(marks)}</span>` : '');
      d.onclick = e => frameClick(k, i, e);
      d.oncontextmenu = e => { e.preventDefault(); stopPlay(); if (k !== A) useAnim(k, i); else if (!fsel.has(i)) { fsel = new Set(); goto(i); } showMenu(e.clientX, e.clientY, frameMenu()); };
      row.appendChild(d);
    });
    if (k === A) {
      const add = document.createElement('button');
      add.className = 'addBtn'; add.id = 'add'; add.textContent = '+'; add.title = 'Add a new frame after the current one (a copy you can re-pose). Shortcut: N';
      add.onclick = addFrame; row.appendChild(add);
    }
    wrap.appendChild(row); strip.appendChild(wrap);
  });
  strip.querySelector('.frame.cur')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length;
  $('paste').disabled = !clip; $('del').disabled = frames.length - targets().length < 1;
  $('hold').value = String(frames[cur].hold);
  $('fps').value = String(fps()); $('smooth').classList.toggle('on', smooth());
  refreshAnimCard();
  if ($('markerPop').style.display === 'block') refreshMarkers();
  showCurrent();
}
function frameClick(k, i, e) {
  stopPlay();
  if (k !== A) { useAnim(k, i); return; }
  if (e.ctrlKey || e.metaKey) { if (fsel.size === 0) fsel.add(cur); fsel.has(i) ? fsel.delete(i) : fsel.add(i); if (fsel.size === 0) fsel.add(i); cur = i; refresh(); return; }
  if (e.shiftKey) { const a = Math.min(cur, i), b = Math.max(cur, i); fsel = new Set(); for (let j = a; j <= b; j++) fsel.add(j); cur = i; refresh(); return; }
  fsel = new Set(); goto(i);
}
const targets = () => fsel.size > 1 ? [...fsel].sort((a, b) => a - b) : [cur];
function showCurrent() {
  if (!project) return;
  body.show(viewPose(frames[cur].P));
  const ghosts = onion && !playing;
  showGhost(ghostPrev, cur - 1, ghosts);
  showGhost(ghostNext, cur + 1, ghosts);
  placeDummy(); syncVideo();
}
function showGhost(b, i, on) {
  const valid = on && i >= 0 && i < frames.length;
  const P = frames[valid ? i : cur].P, C = frames[cur].P;
  b.show(viewPose(P), valid);
  if (valid) for (const n of order) b.meshes[n].visible = !!P[n] && !!C[n] && !samePose(P[n], C[n]);
}
function goto(i) { stopPlay(); cur = Math.max(0, Math.min(frames.length - 1, i)); refresh(); }

// ================================================================== frame actions
function addFrame() {
  stopPlay(); record();
  frames.splice(cur + 1, 0, newFrame(clonePose(frames[cur].P)));
  thumbsOf(anim()).splice(cur + 1, 0, thumbsOf(anim())[cur]);
  cur++; fsel = new Set(); anim().touched = true; refresh(); saveSoon();
}
function insertRestFrame() {
  stopPlay(); record();
  frames.splice(cur + 1, 0, newFrame(restPose())); cur++; fsel = new Set(); renderThumbsFrom(cur); refresh(); saveSoon();
}
function deleteFrames() {
  const t = targets(); if (frames.length - t.length < 1) { toast('An animation needs at least one frame'); return; }
  stopPlay(); record();
  for (const i of t.slice().reverse()) { frames.splice(i, 1); thumbsOf(anim()).splice(i, 1); }
  cur = Math.min(t[0], frames.length - 1); fsel = new Set(); refresh(); saveSoon();
}
function copyFrames() {
  const t = targets();
  clip = t.map(i => ({ P: clonePose(frames[i].P), hold: frames[i].hold, markers: frames[i].markers.map(normMarker) }));
  toast(clip.length > 1 ? `Copied ${clip.length} frames` : `Copied frame ${cur + 1}`); refresh();
}
function pasteFrames() {
  if (!clip) return; stopPlay(); record();
  if (clip.length === 1) {
    const P = frames[cur].P; for (const n of order) if (clip[0].P[n]) P[n] = clip[0].P[n].clone();
    changed(); toast(`Pasted onto frame ${cur + 1}`); return;
  }
  const add = clip.map(f => { const P = restPose(); for (const n of order) if (f.P[n]) P[n] = f.P[n].clone(); return { P, hold: f.hold, markers: f.markers.map(normMarker) }; });
  frames.splice(cur + 1, 0, ...add); cur += add.length; fsel = new Set();
  afterBulk(); toast(`Inserted ${add.length} frames`);
}
function mirrorFrames() { stopPlay(); record(); for (const i of targets()) frames[i].P = mirrorPose(frames[i].P); afterBulk(); toast('Mirrored'); }
function reverseFrames() {
  stopPlay(); record();
  const t = targets().length > 1 ? targets() : frames.map((_, i) => i);
  const picked = t.map(i => frames[i]).reverse();
  t.forEach((i, k) => frames[i] = picked[k]);
  afterBulk(); toast(t.length === frames.length ? 'Reversed the whole animation' : `Reversed ${t.length} frames`);
}
function feetOnGround() {
  stopPlay(); record();
  for (const i of targets()) {
    const P = frames[i].P;
    let low = Infinity;
    for (const n of ['Right Leg', 'Left Leg']) for (const x of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) low = Math.min(low, new V3(x, -1, z).applyMatrix4(P[n]).y);
    const M = new M4().makeTranslation(0, -3 - low, 0);
    for (const n of order) P[n] = M.clone().multiply(P[n]);
  }
  afterBulk(); toast('Feet put on the ground');
}
function setHold(h) { record(); for (const i of targets()) frames[i].hold = h; refresh(); saveSoon(); }
function autoLoop() {
  if (frames.length < 2) { toast('Add a few frames first'); return; }
  stopPlay(); record();
  frames.push(newFrame(blendPoses(frames[frames.length - 1].P, frames[0].P, 0.5)));
  cur = frames.length - 1; fsel = new Set(); renderThumbsFrom(cur);
  if (!anim().loop) { anim().loop = true; toast('Added a closing frame halfway between the last and first frame, and turned looping on'); }
  else toast('Added a closing frame halfway between the last and first frame');
  anim().touched = true; refresh(); saveSoon();
}
function afterBulk() { anim().touched = true; thumbStore.set(anim().id, frames.map(f => renderPoseImage(f.P))); refresh(); saveSoon(); }
function renderThumbsFrom(i) { const th = thumbsOf(anim()); th.length = frames.length; for (let k = i; k < frames.length; k++) th[k] = renderPoseImage(frames[k].P); }

// in-betweens
let ibFrom = 0;
function openInbetween() {
  if (frames.length < 2) { toast('You need two frames to put in-betweens between'); return; }
  const last = cur === frames.length - 1;
  if (last && !anim().loop) { toast('This is the last frame. Pick a frame with another frame after it.'); return; }
  ibFrom = cur;
  $('ibWhat').textContent = `Between frame ${cur + 1} and frame ${last ? 1 : cur + 2}${last ? ' (looping back to the start)' : ''}.`;
  $('ibModal').style.display = 'flex';
}
const EASE = { even: u => u, out: u => 1 - (1 - u) * (1 - u), in: u => u * u, both: u => u * u * (3 - 2 * u) };
$('ibCancel').onclick = () => $('ibModal').style.display = 'none';
$('ibGo').onclick = () => {
  $('ibModal').style.display = 'none';
  stopPlay(); record();
  const n = +$('ibCount').value, ease = EASE[$('ibEase').value];
  const a = frames[ibFrom].P, b = frames[(ibFrom + 1) % frames.length].P;
  const add = []; for (let k = 1; k <= n; k++) add.push(newFrame(blendPoses(a, b, ease(k / (n + 1)))));
  frames.splice(ibFrom + 1, 0, ...add);
  cur = ibFrom + 1; fsel = new Set(); afterBulk(); toast(`Added ${n} in-between${n > 1 ? 's' : ''}. Check them and fix by hand.`);
};

// split an animation into two linked ones at the current frame
function splitHere() {
  if (cur === 0) { toast('Pick a frame after the first one: it becomes frame 1 of the new animation'); return; }
  stopPlay(); record();
  const a = anim(), at = cur, rest = a.frames.splice(at);
  const b = { id: uid(), name: a.name + ' (part 2)', type: a.type, loop: a.loop, priority: a.priority, frames: rest, touched: true };
  a.loop = false;
  project.anims.splice(A + 1, 0, b);
  thumbStore.set(b.id, thumbsOf(a).splice(at));
  useAnim(A + 1, 0); saveSoon(); toast(`Split: "${a.name}" now flows into "${b.name}"`);
}

// ================================================================== playback (one-shot animations flow into the next; loops repeat)
const animSlots = a => a.frames.reduce((s, f) => s + f.hold, 0);
const slotStart = i => frames.slice(0, i).reduce((s, f) => s + f.hold, 0);
function poseInAnim(a, p, nextFirst) {
  let i = 0, s = 0;
  while (i < a.frames.length - 1 && p >= s + a.frames[i].hold) { s += a.frames[i].hold; i++; }
  const local = p - s, f = a.frames[i];
  if (!smooth() || local < f.hold - 1) return { i, P: f.P };
  const nextP = i + 1 < a.frames.length ? a.frames[i + 1].P : nextFirst;
  return { i, P: nextP ? blendPoses(f.P, nextP, Math.min(1, local - (f.hold - 1))) : f.P };
}
function buildPlay(startAnim) {
  const segs = [];
  for (let k = startAnim; k < project.anims.length; k++) { segs.push(k); if (project.anims[k].loop) break; }
  const loopSeg = project.anims[segs[segs.length - 1]].loop ? segs[segs.length - 1] : null;
  return { segs, loopSeg };
}
function poseAtTime(t) {           // t in seconds from the start of the first animation in the chain
  let p = t * fps();
  const { segs, loopSeg } = play;
  const prefix = segs.filter(k => k !== loopSeg).reduce((s, k) => s + animSlots(project.anims[k]), 0);
  if (loopSeg === null) p = p % prefix;
  else if (p >= prefix) {
    const a = project.anims[loopSeg], L = animSlots(a);
    return { k: loopSeg, ...poseInAnim(a, (p - prefix) % L, a.frames[0].P) };
  }
  for (const k of segs) {
    if (k === loopSeg) break;
    const a = project.anims[k], L = animSlots(a);
    if (p < L) {
      const nk = segs[segs.indexOf(k) + 1];
      const nf = nk !== undefined ? project.anims[nk].frames[0].P : project.anims[segs[0]].frames[0].P;
      return { k, ...poseInAnim(a, p, nf) };
    }
    p -= L;
  }
  const k = segs[0]; return { k, ...poseInAnim(project.anims[k], 0, null) };
}
function setPlayIcon() {
  $('playBtn').innerHTML = playing ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>';
  $('playBtn').classList.toggle('on', playing);
}
let lastPlayed = null;
function startPlay() {
  play = buildPlay(A);
  const total = play.segs.reduce((s, k) => s + animSlots(project.anims[k]), 0);
  if (total < 2) { toast('Add a second frame with + first'); return; }
  playing = true; playTime = slotStart(cur) / fps(); lastPlayed = null; setPlayIcon(); showCurrent();
  if (refLoaded() && $('refShow').checked) refVideo.play().catch(() => {});
}
function stopPlay() {
  if (!playing) return; playing = false; setPlayIcon(); grid.position.z = 0;
  refVideo.pause(); refresh();
}
function playStep(dt) {
  playTime += dt * rate;
  const { k, i, P } = poseAtTime(playTime);
  body.show(viewPose(P));
  if (scene3.floor) grid.position.z = (playTime * scene3.floorSpeed) % 1;
  const key = k + ':' + i;
  if (key !== lastPlayed) { lastPlayed = key; playSounds(project.anims[k].frames[i]); }
  if (k !== A) { A = k; frames = anim().frames; cur = i; fsel = new Set(); refreshStripOnly(); }
  else if (i !== cur) { cur = i; document.querySelectorAll('.secWrap.cur .frame').forEach((d, j) => d.classList.toggle('cur', j === i)); }
  syncVideo();
}
function refreshStripOnly() { const was = playing; playing = false; refresh(); playing = was; showGhost(ghostPrev, -1, false); showGhost(ghostNext, -1, false); }

// ================================================================== markers and sounds
const soundCache = new Map();
function playSounds(f) {
  for (const m of f.markers) if (m.audio && project.sounds[m.audio]) {
    let a = soundCache.get(m.audio); if (!a) { a = new Audio(project.sounds[m.audio]); soundCache.set(m.audio, a); }
    try { a.currentTime = 0; a.play().catch(() => {}); } catch (e) {}
  }
}
function refreshMarkers() {
  const list = $('markerList'); list.innerHTML = '';
  const t = targets();
  $('markerTitle').textContent = t.length > 1 ? `Markers on ${t.length} frames` : `Markers on frame ${cur + 1}`;
  if (!frames[cur].markers.length) list.innerHTML = '<p>Nothing yet.</p>';
  for (const [k, m] of frames[cur].markers.entries()) {
    const c = document.createElement('span'); c.className = 'chip';
    c.innerHTML = (m.sound ? `♪ ${escH(m.sound)}${m.audio ? ' (preview)' : ''}` : `⚑ ${escH(m.name)}`) + '<button title="Remove">×</button>';
    c.querySelector('button').onclick = () => { record(); frames[cur].markers.splice(k, 1); refresh(); saveSoon(); };
    list.appendChild(c);
  }
}
function addMarker() {
  const name = $('markerName').value.trim().replace(/[^A-Za-z0-9_ -]/g, '');
  if (!name) return;
  record(); for (const i of targets()) frames[i].markers.push({ name }); $('markerName').value = ''; refresh(); saveSoon();
}
let pendingAudio = null;
$('soundFileBtn').onclick = () => $('soundFile').click();
$('soundFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  if (f.size > 3e6) { toast('That sound file is too big for previews (max 3 MB)'); e.target.value = ''; return; }
  const r = new FileReader(); r.onload = () => { pendingAudio = r.result; $('soundFileName').textContent = f.name; }; r.readAsDataURL(f);
  e.target.value = '';
};
$('soundAdd').onclick = () => {
  const id = $('soundId').value.replace(/\D/g, '');
  if (!id && !pendingAudio) { toast('Type a Roblox sound ID (and optionally pick a preview file)'); return; }
  record();
  let key = null;
  if (pendingAudio) { key = uid(); project.sounds[key] = pendingAudio; }
  for (const i of targets()) frames[i].markers.push({ name: 'Sound', sound: id || 'preview', audio: key });
  $('soundId').value = ''; pendingAudio = null; $('soundFileName').textContent = 'No preview file';
  refresh(); saveSoon();
};
$('markerBtn').onclick = () => togglePanel('markerPop', refreshMarkers);
$('markerAdd').onclick = addMarker;
$('markerName').addEventListener('keydown', e => { if (e.key === 'Enter') addMarker(); });

// ================================================================== panels and menus
const PANELS = ['scenePanel', 'partsPanel', 'posesPanel', 'markerPop', 'settingsPanel'];
function closePanels(only) { for (const p of only || PANELS) $(p).style.display = 'none'; syncPanelButtons(); }
function togglePanel(id, onOpen) {
  const open = $(id).style.display !== 'block';
  closePanels();
  if (open) { $(id).style.display = 'block'; onOpen && onOpen(); }
  syncPanelButtons();
}
function syncPanelButtons() {
  $('sceneBtn').classList.toggle('on', $('scenePanel').style.display === 'block');
  $('partsBtn').classList.toggle('on', $('partsPanel').style.display === 'block');
  $('poses').classList.toggle('on', $('posesPanel').style.display === 'block');
  $('markerBtn').classList.toggle('on', $('markerPop').style.display === 'block');
  $('settingsBtn').classList.toggle('on', $('settingsPanel').style.display === 'block');
}
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { closePanels(); if (!project) $('home').style.display = 'block'; });
$('sceneBtn').onclick = () => togglePanel('scenePanel');
$('partsBtn').onclick = () => togglePanel('partsPanel', refreshPartsPanel);
$('poses').onclick = () => togglePanel('posesPanel', refreshPoses);
$('settingsBtn').onclick = () => togglePanel('settingsPanel', refreshSettings);

// right-click / dropdown menu
const ctx = $('ctx');
function showMenu(x, y, items) {
  ctx.innerHTML = '';
  for (const it of items) {
    if (it === '-') { const d = document.createElement('div'); d.className = 'hr'; ctx.appendChild(d); continue; }
    if (it.head) { const d = document.createElement('div'); d.className = 'head'; d.textContent = it.head; ctx.appendChild(d); continue; }
    const b = document.createElement('button'); b.className = 'item'; b.disabled = !!it.disabled;
    b.innerHTML = `${escH(it.label)}${it.key ? `<span>${escH(it.key)}</span>` : ''}`;
    b.onclick = () => { hideMenu(); it.action(); };
    ctx.appendChild(b);
  }
  ctx.style.display = 'block';
  const r = ctx.getBoundingClientRect();
  ctx.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  ctx.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
function hideMenu() { ctx.style.display = 'none'; }
window.addEventListener('pointerdown', e => { if (!ctx.contains(e.target)) hideMenu(); }, true);
const many = () => targets().length > 1 ? ` (${targets().length} frames)` : '';
function frameMenu() {
  return [
    { head: targets().length > 1 ? `${targets().length} frames` : `Frame ${cur + 1}` },
    { label: 'Copy' + many(), key: 'Ctrl+C', action: copyFrames },
    { label: clip && clip.length > 1 ? `Paste ${clip.length} frames after this` : 'Paste pose here', key: 'Ctrl+V', action: pasteFrames, disabled: !clip },
    { label: 'Duplicate (add a copy after)', key: 'N', action: addFrame },
    { label: 'Add a standing frame after', action: insertRestFrame },
    { label: 'Delete' + many(), key: 'Del', action: deleteFrames, disabled: frames.length - targets().length < 1 },
    '-',
    { label: 'Hold ×1', action: () => setHold(1) }, { label: 'Hold ×2', action: () => setHold(2) }, { label: 'Hold ×3', action: () => setHold(3) },
    '-',
    { label: 'Add marker or sound…', action: () => togglePanel('markerPop', refreshMarkers) },
    { label: 'In-betweens to the next frame…', action: openInbetween },
    { label: 'Mirror pose' + many(), key: 'M', action: mirrorFrames },
    { label: targets().length > 1 ? 'Reverse these frames' : 'Reverse the whole animation', action: reverseFrames },
    { label: 'Feet on ground' + many(), key: 'G', action: feetOnGround },
    '-',
    { label: 'Start a new animation from this frame', action: splitHere, disabled: cur === 0 },
  ];
}
function partMenu(n) {
  return [
    { head: n },
    { label: 'Copy part', action: () => copyPart(n) },
    { label: partClip && defs[partClip.name] ? `Paste ${partClip.name}` : 'Paste part', action: pastePart, disabled: !partClip || !defs[partClip?.name] },
    { label: 'Reset this part', action: () => resetPart(n) },
    { label: `Copy to the other side${partnerOf(n) ? ` (${partnerOf(n)})` : ''}`, disabled: !partnerOf(n), action: () => { record(); mirrorPartInto(frames[cur].P, n); changed(); } },
    { label: `Live mirror: ${liveMirror ? 'on' : 'off'}`, action: () => setLiveMirror(!liveMirror) },
    '-',
    { label: 'Feet on ground', key: 'G', action: feetOnGround },
    ...(defs[n].kind !== 'base' ? ['-', { label: `Remove ${n}`, action: () => removePart(n) }] : []),
  ];
}
function viewMenu() {
  return [
    { head: `Frame ${cur + 1}` },
    { label: 'Mirror pose', key: 'M', action: mirrorFrames },
    { label: `Live mirror: ${liveMirror ? 'on' : 'off'}`, action: () => setLiveMirror(!liveMirror) },
    { label: 'Feet on ground', key: 'G', action: feetOnGround },
    { label: `Test for Roblox: ${testMode ? 'on' : 'off'}`, key: 'T', action: () => setTest(!testMode) },
    '-',
    { label: 'Game camera', action: () => setView('game') }, { label: 'Shift-lock camera', action: () => setView('shiftlock') },
    { label: 'Side view', action: () => setView('side') }, { label: 'Front view', action: () => setView('front') },
  ];
}
$('mirror').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); showMenu(r.left, r.bottom + 6, [
  { label: 'Flip this pose left ↔ right' + many(), key: 'M', action: mirrorFrames },
  { label: `Live mirror: ${liveMirror ? 'on — click to turn off' : 'off — click to turn on'}`, action: () => setLiveMirror(!liveMirror) },
]); };
$('tools').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); showMenu(r.left - 120, r.bottom + 6, [
  { label: 'In-betweens to the next frame…', action: openInbetween },
  { label: targets().length > 1 ? 'Reverse selected frames' : 'Reverse the whole animation', action: reverseFrames },
  { label: 'Feet on ground' + many(), key: 'G', action: feetOnGround },
  { label: 'Auto loop (add a closing frame)', action: autoLoop },
  { label: 'Get an AI prompt for this animation', action: () => showAiHelp([anim()], true, true) },
  '-',
  { label: 'Start a new animation from this frame', action: splitHere, disabled: cur === 0 },
  { label: 'Add a standing frame after', action: insertRestFrame },
]); };

// ------------------------------------------------------------------ parts panel
function refreshPartsPanel() {
  if (!project) return;
  const holders = order.filter(n => /Arm/.test(n));
  const sel = $('propHolder'), keep = sel.value;
  sel.innerHTML = holders.map(n => `<option>${escH(n)}</option>`).join('');
  sel.value = holders.includes(keep) ? keep : 'Right Arm';
  const extras = order.filter(n => defs[n].kind !== 'base');
  const list = $('partList');
  list.innerHTML = extras.length ? '' : '<p>None yet.</p>';
  for (const n of extras) {
    const r = document.createElement('div'); r.className = 'partRow';
    const d = defs[n];
    r.innerHTML = `<span>${escH(n)}${d.kind === 'prop' ? ` <span style="color:var(--muted)">in ${escH(d.parent)}</span>` : ''}</span><button class="small">Remove</button>`;
    r.querySelector('button').onclick = () => removePart(n);
    list.appendChild(r);
  }
  $('addArm').disabled = order.filter(n => defs[n].kind === 'extra').length >= 4;
}
function addPart(def, initial) {
  record();
  setParts(partsFromList([...extraDefsList(), def.kind === 'extra' ? { kind: 'extra', k: +def.name.split(' ').pop() } : { kind: 'prop', name: def.name, type: def.propType, parent: def.parent }]));
  syncBodies();
  for (const a of project.anims) for (const f of a.frames) f.P[def.name] = initial(f.P);
  rethumbAll(); refresh(); refreshPartsPanel(); saveSoon(); select(def.name);
}
function removePart(n) {
  record();
  const gone = descendants(n);
  setParts(partsFromList(extraDefsList().filter(e => !gone.includes(e.kind === 'extra' ? `Extra Arm ${e.k}` : e.name))));
  for (const a of project.anims) for (const f of a.frames) for (const g of gone) delete f.P[g];
  syncBodies(); if (gone.includes(selected)) select(null);
  rethumbAll(); refresh(); refreshPartsPanel(); saveSoon();
}
$('addArm').onclick = () => {
  let k = 1; while (defs[`Extra Arm ${k}`]) k++;
  if (k > 4) return;
  const d = finishDef(extraArmDef(k));
  addPart(d, P => {
    const W = P.Torso.clone().multiply(d.restRel);
    const socket = new V3(...d.joint).applyMatrix4(W), axis = new V3(0, 0, 1).transformDirection(P.Torso);
    return new M4().makeTranslation(socket.x, socket.y, socket.z).multiply(new M4().makeRotationAxis(axis, d.side * 0.5))
      .multiply(new M4().makeTranslation(-socket.x, -socket.y, -socket.z)).multiply(W);
  });
};
$('propType').onchange = () => { $('propName').value = { knife: 'Knife', ball: 'Fireball', block: 'Block' }[$('propType').value]; };
$('addProp').onclick = () => {
  let name = $('propName').value.trim().replace(/[^A-Za-z0-9_ -]/g, '') || 'Prop';
  if (defs[name]) { let k = 2; while (defs[`${name} ${k}`]) k++; name = `${name} ${k}`; }
  const d = finishDef(propDef(name, $('propType').value, $('propHolder').value));
  addPart(d, P => P[d.parent].clone().multiply(d.restRel));
};

// ------------------------------------------------------------------ pose library
let library = [];
try { library = JSON.parse(store.get('r6flipbook.poses') || '[]'); } catch (e) { library = []; }
const saveLibrary = () => store.set('r6flipbook.poses', JSON.stringify(library));
function refreshPoses() {
  const g = $('poseGrid'); g.innerHTML = library.length ? '' : '<p style="grid-column:1/-1">No saved poses yet.</p>';
  library.forEach((p, k) => {
    const d = document.createElement('div'); d.className = 'poseItem'; d.title = `Put "${p.name}" on frame ${cur + 1}`;
    d.innerHTML = `<img alt="" src="${escH(safeImg(p.img))}"><div>${escH(p.name)}</div><button title="Delete">×</button>`;
    d.onclick = e => {
      if (e.target.tagName === 'BUTTON') { library.splice(k, 1); saveLibrary(); refreshPoses(); return; }
      record();
      const P = frames[cur].P;
      for (const n of order) if (p.P[n]) P[n] = new M4().fromArray(p.P[n]);
      changed(); toast(`Used "${p.name}" on frame ${cur + 1}`);
    };
    g.appendChild(d);
  });
}
$('poseSave').onclick = () => {
  const name = $('poseName').value.trim() || `Pose ${library.length + 1}`;
  library.unshift({ name, P: serPose(frames[cur].P), img: thumbsOf(anim())[cur] || renderPoseImage(frames[cur].P) });
  saveLibrary(); $('poseName').value = ''; refreshPoses(); toast(`Saved "${name}"`);
};

// ------------------------------------------------------------------ scene panel
$('dummyOn').onchange = e => { scene3.dummy = e.target.checked; placeDummy(); };
$('dummyDist').onchange = e => { scene3.dummyDist = +e.target.value; placeDummy(); };
$('floorOn').onchange = e => { scene3.floor = e.target.checked; if (!e.target.checked) grid.position.z = 0; };
$('floorSpeed').onchange = e => { scene3.floorSpeed = +e.target.value; };
const refVideo = $('refVideo');
let refStart = 0, refUrl = null;
const refLoaded = () => !!refUrl && refVideo.readyState >= 1;
function refApply() {
  const on = refLoaded() && $('refShow').checked;
  refVideo.style.display = on ? 'block' : 'none';
  refVideo.style.opacity = $('refOpacity').value;
  scene.background = on ? null : BG; ground.visible = !on;
  syncVideo();
}
function syncVideo() {
  if (!project || !refLoaded() || !$('refShow').checked) return;
  const N = animSlots(anim());
  const slot = playing ? ((playTime * fps()) % N) : slotStart(cur);
  const target = Math.min(refStart + slot / fps(), Math.max(0, refVideo.duration - 0.01));
  if (Math.abs(refVideo.currentTime - target) > (playing ? 0.15 : 0.01)) refVideo.currentTime = target;
}
$('refChoose').onclick = () => $('refFile').click();
$('refFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  if (refUrl) URL.revokeObjectURL(refUrl);
  refUrl = URL.createObjectURL(f); refVideo.src = refUrl; refStart = 0;
  refVideo.onloadedmetadata = () => { $('refStart').max = refVideo.duration; $('refStart').value = 0; $('refTime').textContent = '0.00s'; $('refShow').checked = true; refApply(); toast('Video loaded. Line up the camera with it.'); };
  e.target.value = '';
};
$('refShow').onchange = refApply;
$('refOpacity').oninput = refApply;
$('refStart').oninput = e => { refStart = +e.target.value; $('refTime').textContent = refStart.toFixed(2) + 's'; syncVideo(); };
const nudge = d => { refStart = Math.max(0, Math.min(refVideo.duration || 0, refStart + d)); $('refStart').value = refStart; $('refTime').textContent = refStart.toFixed(2) + 's'; syncVideo(); };
$('refBack').onclick = () => nudge(-1 / 30); $('refFwd').onclick = () => nudge(1 / 30);
$('refClear').onclick = () => { if (refUrl) URL.revokeObjectURL(refUrl); refUrl = null; refVideo.removeAttribute('src'); refVideo.load(); refApply(); };

const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
async function loadAvatar(name) {
  name = (name || '').trim(); if (!name) return;
  if (!served) { $('avStatus').textContent = 'Loading Roblox avatars isn\'t available in the online version yet.'; return; }
  $('avStatus').textContent = `Loading ${name}…`; $('avLoad').disabled = true;
  try {
    const d = await (await fetch('/api/avatar?name=' + encodeURIComponent(name))).json();
    if (d.error) throw new Error(d.error);
    const images = {};
    for (const [k, url] of Object.entries(d.images || {})) images[k] = await loadImg(url);
    look = { colors: d.colors, images }; drawLook(look);
    if (project) project.avatar = d.user.name;
    const got = Object.keys(images).filter(k => images[k]);
    $('avStatus').textContent = `${d.user.name}: body colours` + (got.length ? ` + ${got.join(', ')}` : '') + '.' +
      (d.notes?.length ? ' ' + d.notes.join(' ') : '') + (got.length ? '' : ' (They wear no classic clothing, so Roblox shows plain colours on R6.)');
    if (project) { rethumbAll(); refresh(); saveSoon(); }
  } catch (err) {
    $('avStatus').textContent = /fetch/i.test(err.message) ? 'The helper isn\'t running. Open the app with "Start R6 Flipbook".' : err.message;
  }
  $('avLoad').disabled = false;
}
$('avLoad').onclick = () => loadAvatar($('avName').value);
$('avName').addEventListener('keydown', e => { if (e.key === 'Enter') loadAvatar($('avName').value); });
$('avReset').onclick = () => { look = DEFAULT_LOOK; if (project) project.avatar = ''; drawLook(look); if (project) { rethumbAll(); refresh(); saveSoon(); } $('avStatus').textContent = 'Back to the default look.'; };

// ================================================================== animation card, guide, Test for Roblox
function riseInfo(a) {
  let best = null;
  a.frames.forEach((f, i) => { const y = f.P.Torso.elements[13]; if (y > 1 && (!best || y > best.rise)) best = { i, rise: y }; });
  return best;
}
function refreshAnimCard() {
  $('pname').textContent = project.name;
  $('animPick').innerHTML = project.anims.map((a, k) => `<option value="${k}">${k + 1}. ${escH(a.name)}</option>`).join('') + '<option value="add">＋ Add another animation…</option>';
  $('animPick').value = String(A);
  const a = anim();
  $('animLoop').textContent = `${ANIM_TYPES[a.type].label} · ${a.loop ? '↻ loops' : 'plays once'}`;
  const g = project.guide;
  if (g && g.active) {
    const last = A >= project.anims.length - 1;
    $('guideRow').style.display = 'block';
    $('guideText').innerHTML = `<b>Step ${A + 1} of ${project.anims.length}:</b> make the <b>${escH(a.name)}</b>.` + (last ? ' This is the last part.' : ` Press Done when it's finished to move on to <b>${escH(project.anims[A + 1].name)}</b>.`);
    $('guideDone').textContent = last ? 'Finish' : `Done → ${project.anims[A + 1].name}`;
  } else $('guideRow').style.display = 'none';
  const r = riseInfo(a);
  $('riseWarn').style.display = r ? 'block' : 'none';
  if (r) $('riseWarn').textContent = `⚠ The body rises ${r.rise.toFixed(1)} studs (frame ${r.i + 1}). In Roblox the game handles jump height, so for a normal jump keep the body low. For a skill like a jump-slam this can be on purpose.`;
}
$('animPick').onchange = e => {
  if (e.target.value === 'add') { $('animPick').value = String(A); addAnimAfter(); return; }
  stopPlay(); useAnim(+e.target.value, 0);
};
$('guideDone').onclick = () => {
  const g = project.guide;
  if (A >= project.anims.length - 1) { g.active = false; refresh(); saveSoon(); toast('All parts done! Press Play on the first part to watch them together, then Export.'); return; }
  record();
  const prev = anim(), next = project.anims[A + 1];
  if (!next.touched && next.frames.length === 1) {   // start the next part where this one ends, so they connect
    next.frames[0].P = clonePose(prev.frames[prev.frames.length - 1].P);
    thumbStore.set(next.id, [renderPoseImage(next.frames[0].P)]);
  }
  stopPlay(); useAnim(A + 1, 0); saveSoon();
  toast(`Now make "${next.name}". It starts from where "${prev.name}" ended.`);
};
function setTest(on) {
  testMode = on; stopPlay();
  $('testBtn').classList.toggle('on', on);
  $('testBtn').textContent = on ? 'Test for Roblox: on' : 'Test for Roblox';
  if (on) { select(null); $('hint').textContent = 'Test for Roblox: the body stays on the character\'s spot, like in the game. Editing is paused. Try Scene → Moving floor and press Play.'; }
  else $('hint').textContent = HINT;
  showCurrent();
}
$('testBtn').onclick = () => setTest(!testMode);

// animation settings
function openAnimSettings() {
  const a = anim();
  $('amName').value = a.name;
  $('amType').innerHTML = Object.entries(ANIM_TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('');
  $('amType').value = a.type; $('amLoop').checked = a.loop; $('amPriority').value = String(a.priority);
  $('amDelete').disabled = project.anims.length < 2;
  $('animModal').style.display = 'flex';
}
$('animSettingsBtn').onclick = openAnimSettings;
$('amType').onchange = () => { const t = ANIM_TYPES[$('amType').value]; $('amLoop').checked = t.loop; $('amPriority').value = String(t.priority); };
$('amOk').onclick = () => {
  record();
  const a = anim();
  a.name = $('amName').value.trim() || a.name; a.type = $('amType').value; a.loop = $('amLoop').checked; a.priority = +$('amPriority').value;
  $('animModal').style.display = 'none'; refresh(); saveSoon();
};
$('amDelete').onclick = () => {
  if (project.anims.length < 2) return;
  if (!confirm(`Delete the animation "${anim().name}" from this project? (You can undo.)`)) return;
  record(); project.anims.splice(A, 1); $('animModal').style.display = 'none'; useAnim(Math.max(0, A - 1), 0); saveSoon();
};
$('amAdd').onclick = () => { $('animModal').style.display = 'none'; addAnimAfter(); };
function addAnimAfter() {
  stopPlay(); record();
  const prev = anim();
  const a = newAnim('New animation', prev.type);
  a.frames[0].P = clonePose(prev.frames[prev.frames.length - 1].P);
  project.anims.splice(A + 1, 0, a);
  thumbStore.set(a.id, [renderPoseImage(a.frames[0].P)]);
  useAnim(A + 1, 0); saveSoon(); openAnimSettings();
}

// ================================================================== guided draw-to-pose
const drawLayer = $('drawLayer'), dctx = drawLayer.getContext('2d');
let drawSteps = [], drawStep = 0, stroke = null, strokes = [];
const DRAW_TEXT = { Torso: 'from the <b>neck</b> down to the <b>hips</b>', Head: 'from the <b>neck</b> up to the <b>top of the head</b>' };
function drawPrompt() {
  const n = drawSteps[drawStep];
  const how = DRAW_TEXT[n] || (/Leg/.test(n) ? 'from the <b>hip</b> to the <b>foot</b>' : 'from the <b>shoulder</b> to the <b>hand</b>');
  $('drawText').innerHTML = `${drawStep + 1}/${drawSteps.length} · Draw the <b>${escH(n.toUpperCase())}</b> ${how}`;
  select(n);
}
function startDraw() {
  if (drawing) return endDraw();
  if (testMode) setTest(false);
  stopPlay(); closePanels(); record();
  drawing = true; drawStep = 0; strokes = [];
  drawSteps = ['Torso', 'Head', 'Right Arm', 'Left Arm', ...order.filter(n => defs[n].kind === 'extra'), 'Right Leg', 'Left Leg'];
  drawLayer.style.display = 'block'; $('drawBanner').style.display = 'flex'; $('draw').classList.add('on');
  controls.enabled = false; sizeDrawLayer(); redrawStrokes(); drawPrompt();
  $('hint').textContent = 'Tip: use the Side or Front view. Each line sets one body part; fine-tune with the rings after.';
}
function endDraw() {
  drawing = false; drawLayer.style.display = 'none'; $('drawBanner').style.display = 'none'; $('draw').classList.remove('on');
  controls.enabled = true; select(null); $('hint').textContent = HINT;
  if (undoStack.length && undoStack[undoStack.length - 1] === snapshot()) undoStack.pop();
  changed();
}
function sizeDrawLayer() { drawLayer.width = view.clientWidth; drawLayer.height = view.clientHeight; }
function redrawStrokes() {
  dctx.clearRect(0, 0, drawLayer.width, drawLayer.height);
  dctx.lineCap = 'round'; dctx.lineJoin = 'round';
  for (const s of [...strokes, ...(stroke ? [stroke] : [])]) {
    dctx.strokeStyle = s === stroke ? settings.accent : (isDark() ? 'rgba(236,236,241,.6)' : 'rgba(36,36,44,.55)'); dctx.lineWidth = s === stroke ? 5 : 4;
    dctx.beginPath(); s.forEach((p, k) => k ? dctx.lineTo(p.x, p.y) : dctx.moveTo(p.x, p.y)); dctx.stroke();
  }
}
function screenToWorld(p) {
  const r = drawLayer.getBoundingClientRect();
  ndc.set((p.x / r.width) * 2 - 1, -(p.y / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const center = new V3().applyMatrix4(frames[cur].P.Torso), n = camera.getWorldDirection(new V3());
  return ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, center), new V3());
}
function applyStroke(n, a, b) {
  const P = frames[cur].P, d = defs[n];
  const q = new Q(), t = new V3(), s = new V3(); P[n].decompose(t, q, s);
  if (n === 'Torso') {
    const up = a.clone().sub(b).normalize(), cu = new V3(0, 1, 0).applyQuaternion(q);
    placePart(P, 'Torso', new M4().compose(a.clone().add(b).multiplyScalar(0.5), new Q().setFromUnitVectors(cu, up).multiply(q), new V3(1, 1, 1)));
  } else {
    const dir = b.clone().sub(a).normalize(), now = new V3(...d.reach).applyQuaternion(q).normalize();
    const nq = new Q().setFromUnitVectors(now, dir).multiply(q);
    const socket = new V3(...d.joint).applyMatrix4(P[d.parent].clone().multiply(d.restRel));
    placePart(P, n, new M4().compose(socket.clone().sub(new V3(...d.joint).applyQuaternion(nq)), nq, new V3(1, 1, 1)));
  }
  body.show(P);
}
drawLayer.addEventListener('pointerdown', e => { stroke = [{ x: e.offsetX, y: e.offsetY }]; drawLayer.setPointerCapture(e.pointerId); });
drawLayer.addEventListener('pointermove', e => { if (stroke) { stroke.push({ x: e.offsetX, y: e.offsetY }); redrawStrokes(); } });
drawLayer.addEventListener('pointerup', () => {
  if (!stroke) return;
  const s = stroke; stroke = null;
  const a = s[0], b = s[s.length - 1];
  if (Math.hypot(b.x - a.x, b.y - a.y) < 12) { redrawStrokes(); toast('Draw a longer line'); return; }
  strokes.push(s); redrawStrokes();
  const wa = screenToWorld(a), wb = screenToWorld(b);
  if (wa && wb) applyStroke(drawSteps[drawStep], wa, wb);
  nextDrawStep();
});
function nextDrawStep() { drawStep++; if (drawStep >= drawSteps.length) endDraw(); else drawPrompt(); }
$('draw').onclick = startDraw;
$('drawSkip').onclick = nextDrawStep;
$('drawDone').onclick = endDraw;
const HINT = $('hint').textContent;

// ================================================================== export
const cleanName = s => (s || 'Animation').replace(/[^A-Za-z0-9_ -]/g, '').trim() || 'Animation';
function buildRbxmx(a, center) {
  let ref = 0;
  const nxt = () => 'RBX' + (++ref).toString(16).toUpperCase();
  const ease = smooth() ? 0 : 1;           // PoseEasingStyle: Linear 0, Constant 1
  const tags = ['X', 'Y', 'Z', 'R00', 'R01', 'R02', 'R10', 'R11', 'R12', 'R20', 'R21', 'R22'];
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cfx = m => {
    const e = m.elements;
    const v = [e[12], e[13], e[14], e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
    return '<CoordinateFrame name="CFrame">' + v.map((x, k) => `<${tags[k]}>${(Math.abs(x) < 1e-9 ? 0 : x).toFixed(6)}</${tags[k]}>`).join('') + '</CoordinateFrame>';
  };
  const pose = (part, T) => {
    const kids = part === 'HumanoidRootPart' ? ['Torso'] : children(part);
    const m = part === 'HumanoidRootPart' ? new M4() : T[part];
    return `<Item class="Pose" referent="${nxt()}"><Properties>${cfx(m)}<token name="EasingDirection">0</token>` +
      `<token name="EasingStyle">${ease}</token><string name="Name">${esc(part)}</string><float name="Weight">1</float></Properties>` +
      kids.map(k => pose(k, T)).join('') + '</Item>';
  };
  const fix = P => center ? centered(P) : P;
  const marker = m => `<Item class="KeyframeMarker" referent="${nxt()}"><Properties><string name="Name">${esc(m.name)}</string>` +
    `<string name="Value">${m.sound && m.sound !== 'preview' ? 'rbxassetid://' + esc(m.sound) : ''}</string></Properties></Item>`;
  const key = (time, P, markers = []) => `<Item class="Keyframe" referent="${nxt()}"><Properties><string name="Name">Keyframe</string>` +
    `<float name="Time">${time.toFixed(6)}</float></Properties>${pose('HumanoidRootPart', transformsFromWorlds(fix(P)))}` + markers.map(marker).join('') + '</Item>';
  const keys = [];
  let s = 0;
  for (const f of a.frames) {
    keys.push(key(s / fps(), f.P, f.markers));
    if (f.hold > 1) keys.push(key((s + f.hold - 1) / fps(), f.P));
    s += f.hold;
  }
  keys.push(key(s / fps(), a.loop ? a.frames[0].P : a.frames[a.frames.length - 1].P));
  return '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">' +
    '<Item class="KeyframeSequence" referent="RBX0"><Properties><float name="AuthoredHipHeight">2</float>' +
    `<bool name="Loop">${a.loop}</bool><string name="Name">${esc(cleanName(a.name))}</string><token name="Priority">${a.priority}</token></Properties>` +
    keys.join('') + '</Item></roblox>';
}
function download(name, text, type) {
  const el = document.createElement('a');
  el.href = URL.createObjectURL(new Blob([text], { type }));
  el.download = name; document.body.appendChild(el); el.click(); el.remove();
  setTimeout(() => URL.revokeObjectURL(el.href), 2000);
}
let exScope = 'this';
function openExport() {
  stopPlay();
  const many_ = project.anims.length > 1;
  $('exWhich').innerHTML = many_ ? `<div class="row" style="font-size:13px;color:var(--ink)">Export <div class="seg" id="exScopeSeg"><button data-v="this">This one: ${escH(anim().name)}</button><button data-v="all">All ${project.anims.length}</button></div></div>` : `<p style="font-size:13px;color:var(--ink)">${escH(anim().name)}</p>`;
  exScope = many_ ? 'all' : 'this';
  if (many_) { seg('exScopeSeg', v => { exScope = v; exWarn(); }); [...$('exScopeSeg').children].forEach(c => c.classList.toggle('on', c.dataset.v === exScope)); }
  exWarn();
  exFolderText().then(t => $('exWhere').textContent = t);
  $('exportModal').style.display = 'flex';
}
function exList() { return exScope === 'all' ? project.anims : [anim()]; }
function exWarn() {
  const w = exList().map(a => ({ a, r: riseInfo(a) })).filter(x => x.r);
  $('exWarn').innerHTML = w.map(x => `<div class="warnBox">⚠ "${escH(x.a.name)}": the body rises ${x.r.rise.toFixed(1)} studs on frame ${x.r.i + 1}. The game handles jump height. Fine if it's a skill like a jump-slam; otherwise lower it.</div>`).join('');
}
// export folder: Chrome and Edge can save straight into a folder you pick once; other browsers download the files
const canPickFolder = typeof window.showDirectoryPicker === 'function';
async function exportFolder(ask) {
  let h = await db.kvGet('exportDir');
  if (h) {
    let perm = await h.queryPermission({ mode: 'readwrite' });
    if (perm === 'prompt' && ask) perm = await h.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') return h;
    if (!ask) return null;
  }
  if (!ask) return null;
  try { h = await window.showDirectoryPicker({ id: 'r6flipbook-exports', mode: 'readwrite' }); } catch (e) { return null; }
  await db.kvSet('exportDir', h);
  return h;
}
async function exFolderText() {
  if (!canPickFolder) return 'Your browser will download the files. (Chrome or Edge can save them straight into a folder.)';
  const h = await db.kvGet('exportDir');
  return h ? `Files are saved into your "${h.name}" folder. You can change it in Settings.` : 'The first time, you pick a folder for your exports. After that they go there automatically.';
}
async function chooseExportFolder() {
  if (!canPickFolder) return;
  try { const h = await window.showDirectoryPicker({ id: 'r6flipbook-exports', mode: 'readwrite' }); await db.kvSet('exportDir', h); toast(`Exports will go into "${h.name}"`); } catch (e) {}
  refreshSettings();
}
async function doExport(center) {
  $('exportModal').style.display = 'none';
  const list = exList(), names = [];
  const dir = canPickFolder ? await exportFolder(true) : null;
  for (const a of list) {
    const name = cleanName(a.name), xml = buildRbxmx(a, center);
    let saved = false;
    if (dir) {
      try {
        const fh = await dir.getFileHandle(name + '.rbxmx', { create: true }), w = await fh.createWritable();
        await w.write(new Blob([xml], { type: 'application/xml' })); await w.close(); saved = true;
      } catch (e) { saved = false; }
    }
    if (!saved) download(name + '.rbxmx', xml, 'application/xml');
    names.push(name);
  }
  toast(`Exported ${names.join(', ')}${dir ? ` into "${dir.name}"` : ' (downloaded)'}`);
  showAiHelp(list, center);
}

// ================================================================== "use it with AI": a ready-made prompt for any AI helper
const TYPE_HOW = {
  run: 'Play it while the character is running (Humanoid.Running with speed above about 0.5), replacing the default run animation in the Animate script. It loops. Optionally scale its speed with the walk speed using AnimationTrack:AdjustSpeed.',
  walk: 'Play it while the character is walking (Humanoid.Running), replacing the default walk animation in the Animate script. It loops. Optionally scale its speed with the walk speed using AnimationTrack:AdjustSpeed.',
  idle: 'Play it while the character stands still, replacing the default idle animation in the Animate script. It loops.',
  jump: 'Hook it to the jump states: take-off when the Humanoid enters Jumping, the looping "in the air" part during Freefall, and the landing part on Landed. The game handles jump height; the animation only shows the pose.',
  combat: 'Play it from the attack input or ability (one-shot). Use the markers for timing: connect AnimationTrack:GetMarkerReachedSignal("<name>") to deal damage or spawn effects exactly on that frame. Damage must be checked on the server, never trusted from the client.',
  other: 'Play it when it makes sense for my game (ask me if unsure).',
};
function aiPrompt(list, center) {
  const L = [];
  const many = list.length > 1, told = new Set();
  L.push(`I made ${many ? 'these R6 animations' : 'this R6 animation'} with R6 Flipbook and exported ${many ? 'them as .rbxmx files' : 'it as a .rbxmx file'} (Roblox KeyframeSequence). Please help me put ${many ? 'them' : 'it'} into my Roblox game.`);
  L.push('');
  L.push(`Facts about the file${many ? 's' : ''}:`);
  L.push('- Rig: standard Roblox R6 (Torso, Head, Right Arm, Left Arm, Right Leg, Left Leg, joined by the usual R6 Motor6Ds under HumanoidRootPart). The game must use R6 avatars.');
  L.push(`- ${center ? 'Exported with "Center the torso": the body stays on the character\'s spot, so the Humanoid does the moving.' : 'Exported with "Keep motion": the body moves around inside the animation itself.'}`);
  L.push(`- Speed: ${fps()} frames per second. Easing: ${smooth() ? 'Linear (smooth)' : 'Constant (snappy, flipbook style)'}.`);
  L.push('');
  list.forEach((a, k) => {
    const secs = animSlots(a) / fps();
    L.push(`${many ? `${k + 1}. ` : ''}"${cleanName(a.name)}.rbxmx": ${ANIM_TYPES[a.type].label.toLowerCase()}, ${a.loop ? 'loops' : 'plays once'}, ${secs.toFixed(2)} seconds, priority ${PRIORITY_NAMES[a.priority] || a.priority}.`);
    let t = 0; const marks = [];
    for (const f of a.frames) { for (const m of f.markers) marks.push(m.sound && m.sound !== 'preview' ? `sound marker "${m.name}" at ${(t / fps()).toFixed(2)}s (plays rbxassetid://${m.sound})` : `marker "${m.name}" at ${(t / fps()).toFixed(2)}s`); t += f.hold; }
    if (marks.length) L.push(`   Markers (KeyframeMarkers): ${marks.join('; ')}.`);
    if (a.type === 'jump' && many) L.push(`   How to use it: ${a.loop ? 'loop it while the Humanoid is in Freefall (in the air).' : k === 0 ? 'play it when the Humanoid enters the Jumping state.' : 'play it when the Humanoid lands (the Landed state).'}${k === 0 ? ' The game handles jump height; the animation only shows the pose.' : ''}`);
    else if (!told.has(a.type)) { told.add(a.type); L.push(`   How to use it: ${TYPE_HOW[a.type]}`); }
    else L.push('   How to use it: same as above.');
  });
  const chain = list.filter((a, k) => !a.loop && k < list.length - 1);
  if (many && chain.length) { L.push(''); L.push(`They are linked in this order: ${list.map(a => `"${cleanName(a.name)}"`).join(' → ')}. A one-shot part should flow straight into the next one (play the next when the current track's Stopped/Ended fires, or slightly before with a short fade). A looping part keeps going until the game stops it.`); }
  if (list.some(a => a.frames.some(f => f.markers.some(m => m.sound && m.sound !== 'preview')))) { L.push(''); L.push('For each sound marker, play the Roblox sound in its value (rbxassetid://...) from the character when the marker is reached.'); }
  const extras = order.filter(n => defs[n].kind !== 'base');
  if (extras.length) {
    L.push(''); L.push('The animations also move extra parts. The character needs a part for each, joined by a Motor6D with exactly this name (the animation finds the joint by the part\'s name):');
    const lua = m => { const e = m.elements, r = v => +(Math.abs(v) < 1e-9 ? 0 : v).toFixed(4); return `CFrame.new(${[e[12], e[13], e[14], e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]].map(r).join(', ')})`; };
    for (const n of extras) {
      const d = defs[n];
      L.push(`- "${n}": ${d.kind === 'prop' ? `a ${{ knife: 'knife', ball: 'ball', block: 'block' }[d.propType]} prop` : 'an extra arm'}, size ${d.size.join(' x ')} studs, Motor6D named "${n}" with Part0 = "${d.parent}", Part1 = the "${n}" part, C0 = ${lua(d.c0)}, C1 = ${lua(d.c1)}.`);
    }
  }
  L.push('');
  L.push('Steps I need help with:');
  L.push('1. Uploading: in Roblox Studio, drag each .rbxmx file into the place, right-click the KeyframeSequence and choose "Save to Roblox" to get an animation ID. (I will do this part and give you the IDs.)');
  L.push('2. Write the script(s) that load and play the animations as described above, using the Humanoid\'s Animator.');
  L.push('3. Tell me exactly where each script goes (StarterCharacterScripts, ServerScriptService, ...) and what to test.');
  L.push('');
  L.push('Please ask me before changing or replacing anything that already exists in my game.');
  return L.join('\n');
}
const PRIORITY_NAMES = { 0: 'Idle', 1: 'Movement', 2: 'Action', 3: 'Action2', 4: 'Action3', 5: 'Action4', 1000: 'Core' };
let aiLast = null;
function showAiHelp(list, center, fromTools) {
  aiLast = { list, center };
  $('aiTitle').textContent = fromTools ? 'Use this animation with AI' : 'Exported! Want an AI to add it to your game?';
  $('aiText').value = aiPrompt(list, center);
  $('aiModal').style.display = 'flex';
}
$('aiCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('aiText').value); toast('Copied! Paste it into your AI chat with the .rbxmx file(s).'); }
  catch (e) { $('aiText').select(); toast('Press Ctrl+C to copy'); }
};
$('aiClose').onclick = () => $('aiModal').style.display = 'none';

$('export').onclick = openExport;
$('exCenter').onclick = () => doExport(true);
$('exKeep').onclick = () => doExport(false);
$('exCancel').onclick = () => $('exportModal').style.display = 'none';


// ================================================================== share: GIF, video and links
// One play-through of the chosen animations, in order. Returns the pose at p frames from the start.
function shareSeq(list) {
  const lens = list.map(animSlots), total = lens.reduce((a, b) => a + b, 0);
  return { total, at(p) {
    p = Math.max(0, Math.min(p, total - 1e-6));
    for (let k = 0; k < list.length; k++) {
      if (p < lens[k] || k === list.length - 1) {
        const a = list[k], next = list[k + 1] ? list[k + 1].frames[0].P : (a.loop ? a.frames[0].P : null);
        return poseInAnim(a, Math.min(p, lens[k] - 1e-6), next).P;
      }
      p -= lens[k];
    }
  } };
}
const SHARE_SIZES = { small: [480, 360], medium: [640, 480], large: [1280, 720] };
let shareRenderer = null;
function shareCanvas(w, h) {
  if (!shareRenderer) shareRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  shareRenderer.setPixelRatio(1); shareRenderer.setSize(w, h, false);
  const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
  const cam = camera.clone(); cam.aspect = w / h; cam.updateProjectionMatrix();
  const g = c2.getContext('2d', { willReadFrequently: true });
  return { c2, g, draw(P) {
    const keep = { gizmo: gizmo.visible, bg: scene.background, ground: ground.visible };
    gizmo.visible = false; scene.background = BG; ground.visible = true;
    ghostPrev.show(P, false); ghostNext.show(P, false);
    body.show(viewPose(P)); scene.updateMatrixWorld();
    shareRenderer.render(scene, cam);
    gizmo.visible = keep.gizmo; scene.background = keep.bg; ground.visible = keep.ground;
    g.drawImage(shareRenderer.domElement, 0, 0, w, h);
    const fs = Math.max(11, Math.round(h / 30));
    g.font = `600 ${fs}px system-ui, sans-serif`; g.textAlign = 'right'; g.textBaseline = 'bottom';
    g.fillStyle = isDark() ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.4)';
    g.fillText('R6 Flipbook', w - fs * 0.8, h - fs * 0.6);
  } };
}
// --- a small GIF maker (GIF89a, 256 colours, loops forever)
function makeGif(images, w, h, delayCs) {
  const counts = new Map();
  for (const im of images) { const d = im.data; for (let i = 0; i < d.length; i += 8) { const k = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3); counts.set(k, (counts.get(k) || 0) + 1); } }
  const keys = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map(e => e[0]);
  const pal = keys.map(k => [(k >> 10 & 31) * 8 + 4, (k >> 5 & 31) * 8 + 4, (k & 31) * 8 + 4]);
  while (pal.length < 256) pal.push([0, 0, 0]);
  const near = new Int16Array(32768).fill(-1);
  const lookup = k => {
    if (near[k] >= 0) return near[k];
    const r = (k >> 10 & 31) * 8 + 4, g = (k >> 5 & 31) * 8 + 4, b = (k & 31) * 8 + 4;
    let best = 0, bd = Infinity;
    for (let i = 0; i < keys.length; i++) { const p = pal[i], dd = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (dd < bd) { bd = dd; best = i; } }
    return near[k] = best;
  };
  const out = [];
  const u16 = v => out.push(v & 255, v >> 8 & 255);
  for (const c of 'GIF89a') out.push(c.charCodeAt(0));
  u16(w); u16(h); out.push(0xF7, 0, 0);
  for (const p of pal) out.push(p[0], p[1], p[2]);
  out.push(0x21, 0xFF, 11); for (const c of 'NETSCAPE2.0') out.push(c.charCodeAt(0)); out.push(3, 1, 0, 0, 0);
  for (const im of images) {
    const d = im.data, idx = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < idx.length; i += 4, j++) idx[j] = lookup((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
    out.push(0x21, 0xF9, 4, 0x04); u16(delayCs); out.push(0, 0);
    out.push(0x2C); u16(0); u16(0); u16(w); u16(h); out.push(0);
    out.push(8);
    const data = lzw(idx, 8);
    for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); out.push(n); for (let k = 0; k < n; k++) out.push(data[i + k]); }
    out.push(0);
  }
  out.push(0x3B);
  return new Uint8Array(out);
}
function lzw(idx, minSize) {
  const clear = 1 << minSize, eoi = clear + 1, out = [];
  let size = minSize + 1, next = eoi + 1, cur = 0, bits = 0, dict = new Map();
  const emit = c => { cur |= c << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  emit(clear);
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = prefix << 8 | k, v = dict.get(key);
    if (v !== undefined) { prefix = v; continue; }
    emit(prefix);
    if (next === 4096) { emit(clear); dict = new Map(); size = minSize + 1; next = eoi + 1; }
    else { if (next >= 1 << size) size++; dict.set(key, next++); }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return out;
}
let sharing = false;
async function shareGif() {
  if (sharing) return; sharing = true; stopPlay(); $('exportModal').style.display = 'none';
  try {
    const list = exList(), seq = shareSeq(list), [w, h] = SHARE_SIZES[$('shSize').value] || SHARE_SIZES.small;
    const step = 20, secs = Math.min(20, Math.max(0.5, seq.total / fps()));
    const n = Math.max(2, Math.round(secs * step)), sc = shareCanvas(w, h), images = [];
    toast('Making your GIF…'); await new Promise(r => setTimeout(r, 30));
    for (let i = 0; i < n; i++) { sc.draw(seq.at(i / step * fps())); images.push(sc.g.getImageData(0, 0, w, h)); if (i % 10 === 9) await new Promise(r => setTimeout(r, 0)); }
    const gif = makeGif(images, w, h, 5);
    downloadBlob(cleanName(list.length > 1 ? project.name : list[0].name) + '.gif', new Blob([gif], { type: 'image/gif' }));
    toast(`GIF saved (${(gif.length / 1048576).toFixed(1)} MB). Drop it into Discord!`);
  } catch (e) { toast('Sorry, the GIF could not be made'); }
  sharing = false; showCurrent();
}
async function shareVideo() {
  if (sharing) return;
  if (typeof MediaRecorder !== 'function') { toast('This browser can\'t record video. Try Chrome or Edge, or make a GIF.'); return; }
  sharing = true; stopPlay(); $('exportModal').style.display = 'none';
  try {
    const list = exList(), seq = shareSeq(list), [w, h] = SHARE_SIZES[$('shSize').value] || SHARE_SIZES.medium;
    const once = seq.total / fps(), loops = list[list.length - 1].loop ? Math.max(1, Math.min(4, Math.ceil(3 / Math.max(once, 0.1)))) : 1;
    const secs = Math.min(30, once * loops + (list[list.length - 1].loop ? 0 : 0.5));
    const sc = shareCanvas(w, h);
    const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(sc.c2.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6e6 }), chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(r => rec.onstop = r);
    sc.draw(seq.at(0)); rec.start();
    toast(`Recording video… (${secs.toFixed(1)} s)`);
    const t0 = performance.now();
    await new Promise(res => { const tick = () => { const t = (performance.now() - t0) / 1000; if (t >= secs) return res();
      const p = (t * fps()) % (list[list.length - 1].loop ? seq.total : Infinity); sc.draw(seq.at(p)); requestAnimationFrame(tick); }; tick(); });
    rec.stop(); await done;
    const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
    downloadBlob(cleanName(list.length > 1 ? project.name : list[0].name) + '.' + ext, new Blob(chunks, { type: mime.split(';')[0] }));
    toast(`Video saved (.${ext}). Drop it into Discord!`);
  } catch (e) { toast('Sorry, the video could not be made'); }
  sharing = false; showCurrent();
}
function downloadBlob(name, blob) {
  const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = name;
  document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(el.href), 4000);
}
// --- share by link: the whole project is packed (compressed) into the part of the link after "#",
// which browsers never send to any server.
const b64url = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = s => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
async function streamBytes(stream, limit) {
  const reader = stream.getReader(), parts = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > limit) { reader.cancel(); throw new Error('too big'); } parts.push(value); }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
const QS = 1000;   // rotation precision in links (about 0.1 degree)
async function makeShareLink() {
  const per = order.length;
  const anims = project.anims.slice(0, 20).map(a => {
    const d = [], m = []; let prev = null;
    a.frames.forEach((f, i) => {
      const T = transformsFromWorlds(f.P), row = [];
      for (const n of order) { const p = new V3(), q = new Q(), sc = new V3(); T[n].decompose(p, q, sc);
        row.push(Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 1000), Math.round(q.x * QS), Math.round(q.y * QS), Math.round(q.z * QS), Math.round(q.w * QS)); }
      d.push(...(prev ? row.map((v, j) => v - prev[j]) : row)); prev = row;
      for (const mk of f.markers) m.push(mk.sound && mk.sound !== 'preview' ? [i, mk.name, mk.sound] : [i, mk.name]);
    });
    return { n: a.name, t: a.type, l: a.loop ? 1 : 0, r: a.priority, h: a.frames.map(f => f.hold), m, d };
  });
  const json = JSON.stringify({ v: 1, q: QS, n: project.name, f: project.fps, s: project.smooth ? 1 : 0, p: extraDefsList(), k: per, a: anims });
  const z = await streamBytes(new Blob([new TextEncoder().encode(json)]).stream().pipeThrough(new CompressionStream('deflate-raw')), 5e6);
  return location.origin + location.pathname + '#share=' + b64url(z);
}
async function shareLink() {
  $('exportModal').style.display = 'none';
  try {
    const url = await makeShareLink();
    $('linkText').value = url;
    $('linkNote').textContent = url.length <= 1900 ? `Fits in a Discord message (${url.length} characters). Anyone who opens it gets their own copy; nothing is uploaded.`
      : `This link is ${url.length} characters, too long for a normal Discord message (2000). Share a GIF or video instead, or send the project file (Save).`;
    $('linkModal').style.display = 'flex';
  } catch (e) { toast('Sorry, the link could not be made'); }
}
$('linkCopy').onclick = async () => { try { await navigator.clipboard.writeText($('linkText').value); toast('Link copied!'); } catch (e) { $('linkText').select(); toast('Press Ctrl+C to copy'); } };
$('linkClose').onclick = () => $('linkModal').style.display = 'none';
async function openSharedLink() {
  const m = /^#share=([A-Za-z0-9_-]{1,300000})$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const raw = unb64url(m[1]);
    const o = JSON.parse(new TextDecoder().decode(await streamBytes(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')), 4e6)));
    if (!o || o.v !== 1 || !Array.isArray(o.a)) throw new Error('bad');
    setParts(partsFromList(o.p)); syncBodies();
    if (o.k !== order.length) throw new Error('parts');
    const per = order.length * 7;   // rotations are normalised, so their stored scale (o.q) does not matter
    const anims = o.a.slice(0, 20).map(a => {
      const holds = Array.isArray(a.h) ? a.h.slice(0, 2000) : [];
      if (!holds.length || !Array.isArray(a.d) || a.d.length !== holds.length * per) throw new Error('size');
      let prev = null;
      const frames = holds.map((hd, i) => {
        const row = a.d.slice(i * per, (i + 1) * per).map((v, j) => { if (!Number.isInteger(v)) throw new Error('num'); return prev ? prev[j] + v : v; });
        prev = row;
        const T = {};
        order.forEach((n, k) => { const r = row.slice(k * 7, k * 7 + 7), q = new Q(r[3], r[4], r[5], r[6]);
          if (q.length() < 1e-6) q.set(0, 0, 0, 1); q.normalize();
          T[n] = new M4().compose(new V3(r[0] / 1000, r[1] / 1000, r[2] / 1000), q, new V3(1, 1, 1)); });
        const W = worldsFromTransforms(T);
        return { P: Object.fromEntries(order.map(n => [n, W[n].toArray()])), hold: hd, markers: [] };
      });
      for (const mk of Array.isArray(a.m) ? a.m.slice(0, 200) : []) if (Array.isArray(mk) && frames[mk[0]]) frames[mk[0]].markers.push(mk[2] ? { name: mk[1], sound: mk[2] } : { name: mk[1] });
      return { name: a.n, type: a.t, loop: !!a.l, priority: a.r, frames };
    });
    const p = deserProject({ v: 3, name: o.n, fps: o.f, smooth: !!o.s, parts: o.p, anims });
    p.id = uid(); p.name = (p.name + ' (shared)').slice(0, 48);
    const frames_ = p.anims.reduce((s, a) => s + a.frames.length, 0);
    if (!confirm(`Someone shared an animation with you:\n\n"${p.name}" (${p.anims.length > 1 ? p.anims.length + ' linked parts, ' : ''}${frames_} frames)\n\nOpen it? It will be added to your projects.`)) { showHome(); return; }
    await openProject(p, true);
    toast('Opened the shared animation. It\'s saved in your projects.');
  } catch (e) { toast('That share link is broken or incomplete'); showHome(); }
}
window.addEventListener('hashchange', () => { if (/^#share=/.test(location.hash)) openSharedLink(); });
$('shGif').onclick = shareGif; $('shVid').onclick = shareVideo; $('shLink').onclick = shareLink;

// ================================================================== import (.rbxmx) and old project formats
function rbxmxToAnim(text, fileName) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const seq = [...doc.getElementsByTagName('Item')].find(i => i.getAttribute('class') === 'KeyframeSequence');
  if (!seq) throw new Error('no KeyframeSequence');
  const prop = (item, tag, name) => [...item.querySelector(':scope > Properties').children].find(c => c.tagName === tag && c.getAttribute('name') === name);
  const loop = (prop(seq, 'bool', 'Loop')?.textContent || 'false') === 'true';
  const pr0 = +(prop(seq, 'token', 'Priority')?.textContent || '2'), priority = PRIORITIES.includes(pr0) ? pr0 : 2;
  const seqName = safeName(prop(seq, 'string', 'Name')?.textContent || fileName) || 'Animation';
  const kids = (item, cls) => [...item.children].filter(c => c.tagName === 'Item' && c.getAttribute('class') === cls);
  const keys = [], parentOf = {};
  let constant = false;
  const readCF = el => { const v = {}; for (const c of el.children) v[c.tagName] = +c.textContent;
    return new M4().set(v.R00, v.R01, v.R02, v.X, v.R10, v.R11, v.R12, v.Y, v.R20, v.R21, v.R22, v.Z, 0, 0, 0, 1); };
  for (const kf of kids(seq, 'Keyframe')) {
    const T = {};
    const walk = (p, parent) => {
      const n = prop(p, 'string', 'Name').textContent;
      if (n !== 'HumanoidRootPart') { T[n] = readCF(prop(p, 'CoordinateFrame', 'CFrame')); parentOf[n] = parent; }
      if (prop(p, 'token', 'EasingStyle')?.textContent === '1') constant = true;
      for (const c of kids(p, 'Pose')) walk(c, n);
    };
    for (const p of kids(kf, 'Pose')) walk(p, null);
    keys.push({ t: +prop(kf, 'float', 'Time').textContent, T, markers: kids(kf, 'KeyframeMarker').map(m => {
      const name = safePart(prop(m, 'string', 'Name')?.textContent) || 'Marker', val = prop(m, 'string', 'Value')?.textContent || '';
      const sid = /rbxassetid:\/\/(\d+)/.exec(val); return sid ? { name, sound: sid[1] } : { name }; }) });
  }
  if (!keys.length) throw new Error('no keyframes');
  keys.sort((a, b) => a.t - b.t);
  // make sure this project has any extra parts the file uses
  const need = [];
  for (const [n, parent] of Object.entries(parentOf)) {
    if (BASE.includes(n) || defs[n]) continue;
    const m = /^Extra Arm (\d)$/.exec(n);
    if (m) need.push({ kind: 'extra', k: +m[1] });
    else if (parent && parent !== 'HumanoidRootPart' && safePart(n) === n) need.push({ kind: 'prop', name: n, type: /knife|blade|sword/i.test(n) ? 'knife' : /ball|fire/i.test(n) ? 'ball' : 'block', parent });
  }
  if (need.length) {
    need.sort((a, b) => (a.kind === 'prop') - (b.kind === 'prop'));
    setParts(partsFromList([...extraDefsList(), ...need])); syncBodies();
    if (project) for (const a of project.anims) for (const f of a.frames) for (const n of order) if (!f.P[n]) f.P[n] = restWorld(n, f.P);
  }
  const poses = keys.map(k => worldsFromTransforms(k.T));
  const gaps = keys.slice(1).map((k, i) => k.t - keys[i].t).filter(g => g > 1e-4);
  const step = gaps.length ? Math.min(...gaps) : 1 / 12;
  const rate_ = [6, 12, 15, 24, 30, 60].reduce((b, r) => Math.abs(r - 1 / step) < Math.abs(b - 1 / step) ? r : b, 12);
  let n = keys.length;
  if (n > 1 && (loop ? samePoseAll(poses[n - 1], poses[0]) : samePoseAll(poses[n - 1], poses[n - 2]))) n--;
  const out = [];
  for (let i = 0; i < n; i++) {
    const end = i + 1 < keys.length ? keys[i + 1].t : keys[i].t + 1 / rate_;
    const slots = Math.max(1, Math.round((end - keys[i].t) * rate_));
    const prev = out[out.length - 1];
    if (prev && !keys[i].markers.length && samePoseAll(prev.P, poses[i])) { prev.hold += slots; continue; }
    out.push({ P: poses[i], hold: slots, markers: keys[i].markers });
  }
  const type = priority === 0 ? 'idle' : /run/i.test(seqName) ? 'run' : /walk/i.test(seqName) ? 'walk' : /jump|fall|land/i.test(seqName) ? 'jump' : priority >= 2 ? 'combat' : 'other';
  return { anim: { id: uid(), name: seqName, type, loop, priority, frames: out, touched: true }, fps: rate_, smooth: !constant };
}
function projectFromOld(o, name) {          // v1 / v2 single-animation projects
  setParts(partsFromList(o.v === 2 ? o.parts : [])); syncBodies();
  const fr = o.frames.slice(0, 2000).map(f => f && f.P ? deserFrame(f) : newFrame(deserPose(f)));
  const ex = o.export || {};
  const pr = PRIORITIES.includes(+ex.priority) ? +ex.priority : 2; name = safeName(name); ex.name = safeName(ex.name);
  return { id: uid(), name: name || ex.name || 'My animation', created: Date.now(), fps: FPS_LIST.includes(+o.fps) ? +o.fps : 12, smooth: o.smooth !== false, avatar: '', guide: null, sounds: {},
           anims: [{ id: uid(), name: ex.name || name || 'Animation', type: pr === 0 ? 'idle' : pr === 1 ? 'run' : 'other', loop: ex.loop !== false, priority: pr, frames: fr, touched: true }] };
}

// ================================================================== opening, saving, projects home
async function openProject(p, fresh) {
  project = p; undoStack.length = 0; redoStack.length = 0; select(null);
  if (testMode) setTest(false);
  thumbStore.clear();
  useAnim(p._A || 0, p._cur || 0, true);
  delete p._A; delete p._cur;
  closePanels(); $('home').style.display = 'none';
  if (p.avatar && served) { $('avName').value = p.avatar; loadAvatar(p.avatar); }
  else { look = DEFAULT_LOOK; drawLook(look); }
  rethumbAll(); refresh(); refreshPartsPanel();
  if (fresh) await saveNow();
  if (!settings.tourDone) setTimeout(startTour, 400);
}
async function showHome() {
  if (project) { stopPlay(); await saveNow(); }
  project = null; closePanels(); hideMenu(); select(null);
  $('home').style.display = 'block';
  const list = (await db.all()).sort((a, b) => b.updated - a.updated);
  const g = $('projGrid'); g.innerHTML = '';
  $('homeEmpty').style.display = list.length ? 'none' : 'block';
  $('homeOld').style.display = store.get('r6flipbook') && !settings.oldImported ? 'inline-block' : 'none';
  for (const rec of list) {
    const c = document.createElement('div'); c.className = 'proj card';
    c.innerHTML = `<img alt="" src="${rec.cover || ''}"><div class="meta"><b>${escH(rec.name)}</b><span>${escH(rec.kind || '')}</span><br><span>${new Date(rec.updated).toLocaleString()}</span></div>`;
    const open = () => { try { openProject(deserProject(JSON.parse(rec.data))); } catch (e) { toast('That project could not be opened'); } };
    c.onclick = open;
    c.oncontextmenu = e => { e.preventDefault(); showMenu(e.clientX, e.clientY, [
      { head: rec.name },
      { label: 'Open', action: open },
      { label: 'Rename…', action: async () => { const n = prompt('New name:', rec.name); if (!n) return; const d = JSON.parse(rec.data); d.name = n; rec.name = n; rec.data = JSON.stringify(d); await db.put(rec); showHome(); } },
      { label: 'Duplicate', action: async () => { const d = JSON.parse(rec.data); d.id = uid(); d.name = rec.name + ' copy'; await db.put({ ...rec, id: d.id, name: d.name, updated: Date.now(), data: JSON.stringify(d) }); showHome(); } },
      { label: 'Save to a file', action: () => download(cleanName(rec.name) + '.r6flip.json', rec.data, 'application/json') },
      '-',
      { label: 'Delete…', action: async () => { if (confirm(`Delete "${rec.name}"? This can't be undone. (Save it to a file first if you might want it back.)`)) { await db.del(rec.id); showHome(); } } },
    ]); };
    g.appendChild(c);
  }
}
$('homeBtn').onclick = showHome;
$('homeSettings').onclick = () => { $('home').style.display = 'none'; togglePanel('settingsPanel', refreshSettings); };
$('homeOpen').onclick = () => $('fileIn').click();
$('homeOld').onclick = async () => {
  try {
    const o = JSON.parse(store.get('r6flipbook'));
    const p = projectFromOld(o, 'My animation (from the old version)');
    settings.oldImported = true; saveSettings();
    await openProject(p, true); toast('Brought back your work from the old version');
  } catch (e) { toast('Could not read the old work'); }
};
$('save').onclick = () => download(cleanName(project.name) + '.r6flip.json', JSON.stringify({ ...serProject(), poses: library }), 'application/json');
$('open').onclick = () => $('fileIn').click();
$('fileIn').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  try {
    if (f.size > 50e6) throw new Error('too big');
    const text = await f.text();
    if (/\.rbxmx$/i.test(f.name) || text.trimStart().startsWith('<')) {
      if (project) {                          // add it to this project as another animation
        record();
        const r = rbxmxToAnim(text, f.name.replace(/\.rbxmx$/i, ''));
        project.anims.push(r.anim); rethumbAll();
        useAnim(project.anims.length - 1, 0); saveSoon();
        toast(`Added "${r.anim.name}" (${r.anim.frames.length} frames) to this project`);
      } else {
        setParts(baseDefs()); syncBodies();
        const r = rbxmxToAnim(text, f.name.replace(/\.rbxmx$/i, ''));
        await openProject({ id: uid(), name: r.anim.name, created: Date.now(), fps: r.fps, smooth: r.smooth, avatar: '', guide: null, sounds: {}, anims: [r.anim] }, true);
        toast(`Imported ${f.name}`);
      }
    } else {
      const o = JSON.parse(text);
      if (Array.isArray(o.poses)) { for (const p of o.poses.slice(0, 200)) { const name = safeName(p && p.name, 24); if (name && p.P && typeof p.P === 'object' && !library.some(l => l.name === name)) library.push({ name, P: p.P, img: safeImg(p.img) }); } saveLibrary(); }
      let p;
      if (o.v === 3) { p = deserProject(o); p.id = uid(); }
      else if (Array.isArray(o.frames)) p = projectFromOld(o, f.name.replace(/\.r6flip\.json$|\.json$/i, ''));
      else throw new Error('unknown');
      if (project) await saveNow();
      await openProject(p, true); toast(`Opened ${f.name}`);
    }
  } catch (err) { toast('That file could not be opened'); if (project) refresh(); }
};

// new animation flow
const FOLLOW = {
  run: [{ q: 'Do you want a charge-up into your run?', yes: [['Run start', 'run', false, 1], ['Run', 'run', true, 1]], no: [['Run', 'run', true, 1]] }],
  walk: [{ q: 'Do you want a start-up into your walk?', yes: [['Walk start', 'walk', false, 1], ['Walk', 'walk', true, 1]], no: [['Walk', 'walk', true, 1]] }],
  idle: [],
  jump: [{ q: 'Split the jump into take-off, in the air and landing? (This is how Roblox jumps feel smooth: the air part repeats while the character is up.)',
           yes: [['Take-off', 'jump', false, 1], ['In the air', 'jump', true, 1], ['Landing', 'jump', false, 1]], no: [['Jump', 'jump', false, 1]] }],
  combat: [{ q: 'Add a wind-up before the attack?', key: 'wind' }, { q: 'Add a recovery after the attack?', key: 'rec' }],
  other: [{ q: 'Should it loop (repeat over and over)?', key: 'loop' }],
};
const TYPE_BLURB = { run: 'with an optional charge-up', walk: 'with an optional start', idle: 'standing still, looping', jump: 'take-off, air, landing', combat: 'punches, kicks, skills', other: 'anything else' };
let newType = 'run', answers = {};
function renderNew() {
  $('typeGrid').innerHTML = Object.entries(ANIM_TYPES).map(([k, t]) =>
    `<button class="typeBtn${k === newType ? ' on' : ''}" data-t="${k}">${t.label}<small>${TYPE_BLURB[k]}</small></button>`).join('');
  $('typeGrid').querySelectorAll('.typeBtn').forEach(b => b.onclick = () => { newType = b.dataset.t; answers = {}; $('newName').value = newType === 'other' ? 'My animation' : 'My ' + ANIM_TYPES[newType].label.toLowerCase(); renderNew(); });
  const fu = $('followUps'); fu.innerHTML = '';
  FOLLOW[newType].forEach((f, k) => {
    const key = f.key || 'q' + k;
    if (answers[key] === undefined) answers[key] = newType !== 'combat' && newType !== 'other';
    const d = document.createElement('div'); d.className = 'ask';
    d.innerHTML = `${escH(f.q)}<div class="seg"><button data-v="1" class="${answers[key] ? 'on' : ''}">Yes</button><button data-v="0" class="${answers[key] ? '' : 'on'}">No</button></div>`;
    d.querySelector('.seg').onclick = e => { const b = e.target.closest('button'); if (!b) return; answers[key] = b.dataset.v === '1'; renderNew(); };
    fu.appendChild(d);
  });
  if (newType === 'combat') { const p = document.createElement('p'); p.textContent = 'Tip: put a "Hit" marker on the frame where the attack connects, so the game deals damage right then.'; fu.appendChild(p); }
  const plan = planAnims();
  if (plan.length > 1) { const p = document.createElement('p'); p.innerHTML = `You'll make them in order: <b>${plan.map(x => escH(x[0])).join(' → ')}</b>. Press Done after each one.`; fu.appendChild(p); }
}
function planAnims() {
  if (newType === 'combat') {
    const list = [];
    if (answers.wind) list.push(['Wind-up', 'combat', false, 2]);
    list.push(['Attack', 'combat', false, 2]);
    if (answers.rec) list.push(['Recovery', 'combat', false, 2]);
    return list;
  }
  if (newType === 'other') return [['Animation', 'other', !!answers.loop, 2]];
  if (newType === 'idle') return [['Idle', 'idle', true, 0]];
  const f = FOLLOW[newType][0];
  return answers.q0 ? f.yes : f.no;
}
$('newBtn').onclick = () => { newType = 'run'; answers = {}; $('newName').value = 'My run'; $('newFps').value = String(settings.defFps); renderNew(); $('newModal').style.display = 'flex'; };
$('newCancel').onclick = () => $('newModal').style.display = 'none';
$('newGo').onclick = async () => {
  $('newModal').style.display = 'none';
  setParts(baseDefs()); syncBodies();
  const plan = planAnims();
  const p = { id: uid(), name: $('newName').value.trim() || 'My animation', created: Date.now(), fps: +$('newFps').value, smooth: true, avatar: '', sounds: {},
              guide: plan.length > 1 ? { active: true } : null,
              anims: plan.map(([name, type, loop, priority]) => ({ ...newAnim(name, type), loop, priority })) };
  await openProject(p, true);
  if (plan.length > 1) toast(`Start with "${plan[0][0]}". Press Done (top left) when it's finished.`);
};

// ================================================================== settings, theme, tutorial
const ACCENTS = ['#f0507a', '#4f8cff', '#2fbf71', '#ff8a2a', '#9b6bff', '#e8b400'];
const accentHex = () => parseInt(settings.accent.slice(1), 16);
function hexToRgba(h, a) { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--accent', settings.accent);
  document.documentElement.style.setProperty('--accent-soft', hexToRgba(settings.accent, dark ? 0.22 : 0.14));
  BG.set(dark ? 0x1b1b21 : 0xf4f4f7);
  ground.material.color.set(dark ? 0x2a2a33 : 0xdedee6);
  makeGrid(dark ? 0x4a4a58 : 0xb9b9c6, dark ? 0x383844 : 0xcdcdd8);
  $('hint').style.display = settings.hints ? 'block' : 'none';
  if (project) { select(selected); rethumbAll(); refresh(); }
}
darkQuery.addEventListener('change', () => settings.theme === 'auto' && applyTheme());
function refreshSettings() {
  [...$('themeSeg').children].forEach(c => c.classList.toggle('on', c.dataset.v === settings.theme));
  $('swatches').innerHTML = ACCENTS.map(c => `<button class="swatch${c === settings.accent ? ' on' : ''}" style="background:${c}" data-c="${c}" title="${c}"></button>`).join('');
  $('swatches').querySelectorAll('button').forEach(b => b.onclick = () => { settings.accent = b.dataset.c; saveSettings(); applyTheme(); refreshSettings(); });
  $('accentPick').value = settings.accent;
  $('defFps').value = String(settings.defFps);
  $('hintsOn').checked = settings.hints;
  exFolderText().then(t => $('exportWhere').textContent = t);
  $('pickFolder').style.display = canPickFolder ? 'inline-block' : 'none';
}
seg('themeSeg', v => { settings.theme = v; saveSettings(); applyTheme(); });
$('accentPick').oninput = e => { settings.accent = e.target.value; saveSettings(); applyTheme(); };
$('defFps').onchange = e => { settings.defFps = +e.target.value; saveSettings(); };
$('hintsOn').onchange = e => { settings.hints = e.target.checked; saveSettings(); applyTheme(); };
$('pickFolder').onclick = chooseExportFolder;
$('tourAgain').onclick = () => { closePanels(); if (project) startTour(); else { $('home').style.display = 'block'; toast('Open or start an animation first, then the tour runs'); settings.tourDone = false; saveSettings(); } };

const TOUR = [
  { el: null, text: '<b>Welcome to R6 Flipbook!</b> You make Roblox R6 animations frame by frame, like FlipaClip. This quick tour takes about 30 seconds.' },
  { el: '#view', text: '<b>Pose the character.</b> Click any body part. Drag the <b>arrows</b> to move it and the <b>rings</b> to turn it. Drag empty space to spin the camera.' },
  { el: '#add', text: '<b>Add frames.</b> Press <b>+</b> to add the next frame. It starts as a copy, so you only change what moves.' },
  { el: '#play', text: '<b>Watch it.</b> Press play. You can slow it down or speed it up with Play speed.' },
  { el: '#strip', text: '<b>Right-click for more.</b> Right-click a frame or the character for in-betweens, reverse, feet on ground, markers, mirror and more. Ctrl-click or Shift-click frames to pick several.' },
  { el: '#animCard', text: '<b>Your animations.</b> A project can hold linked parts, like Run start → Run. Pick which one you\'re editing here. <b>Test for Roblox</b> shows it the way the game plays it.' },
  { el: '#export', text: '<b>Export when you\'re done.</b> Pick "Center the torso" for most animations, then put the file into Roblox Studio.' },
  { el: '#settingsBtn', text: '<b>Settings</b> has dark mode, colours, and this tour if you want to see it again. Have fun!' },
];
let tourAt = -1;
function startTour() { tourAt = 0; showTour(); }
function endTour() { tourAt = -1; $('tourShade').style.display = 'none'; $('tourCard').style.display = 'none'; settings.tourDone = true; saveSettings(); }
function showTour() {
  const step = TOUR[tourAt], shade = $('tourShade'), card = $('tourCard');
  $('tourText').innerHTML = step.text; $('tourCount').textContent = `${tourAt + 1} / ${TOUR.length}`;
  $('tourBack').style.visibility = tourAt ? 'visible' : 'hidden';
  $('tourNext').textContent = tourAt === TOUR.length - 1 ? 'Finish' : 'Next';
  shade.style.display = 'block'; card.style.display = 'block';
  const el = step.el && document.querySelector(step.el);
  const cw = 300, ch = card.offsetHeight || 150;
  if (!el) {
    Object.assign(shade.style, { left: innerWidth / 2 + 'px', top: innerHeight / 2 + 'px', width: '0px', height: '0px' });
    Object.assign(card.style, { left: (innerWidth - cw) / 2 + 'px', top: (innerHeight - ch) / 2 + 'px' });
    return;
  }
  if (step.el === '#add') el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  let r = el.getBoundingClientRect();
  if (step.el === '#view') r = { left: innerWidth * 0.3, top: innerHeight * 0.18, width: innerWidth * 0.4, height: innerHeight * 0.55, right: innerWidth * 0.7, bottom: innerHeight * 0.73 };
  const pad = 6;
  Object.assign(shade.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
  let x = Math.min(Math.max(12, r.left), innerWidth - cw - 12), y = r.bottom + 14;
  if (y + ch > innerHeight - 12) y = r.top - ch - 14;
  if (y < 12) { y = Math.max(12, r.top); x = r.right + 14 + cw < innerWidth ? r.right + 14 : r.left - cw - 14; }
  Object.assign(card.style, { left: x + 'px', top: y + 'px' });
}
$('tourNext').onclick = () => { if (tourAt >= TOUR.length - 1) endTour(); else { tourAt++; showTour(); } };
$('tourBack').onclick = () => { if (tourAt > 0) { tourAt--; showTour(); } };
$('tourSkip').onclick = endTour;
window.addEventListener('resize', () => tourAt >= 0 && showTour());

// ================================================================== toolbar wiring and keys
let toastTimer;
function toast(t) { const el = $('toast'); el.textContent = t; el.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.style.opacity = 0, 2400); }
$('undo').onclick = undo; $('redo').onclick = redo;
$('copy').onclick = copyFrames; $('paste').onclick = pasteFrames; $('del').onclick = deleteFrames;
$('onion').onclick = () => { onion = !onion; $('onion').classList.toggle('on', onion); showCurrent(); };
$('smooth').onclick = () => { project.smooth = !project.smooth; refresh(); toast(project.smooth ? 'Smooth: blends between frames' : 'Flipbook: snaps frame to frame'); saveSoon(); };
$('prev').onclick = () => goto(cur - 1); $('next').onclick = () => goto(cur + 1);
$('playBtn').onclick = () => playing ? stopPlay() : startPlay();
$('fps').onchange = e => { project.fps = +e.target.value; saveSoon(); };
$('hold').onchange = e => setHold(+e.target.value);
$('rate').onchange = e => {
  const custom = e.target.value === 'custom';
  $('rateCustom').style.display = custom ? 'block' : 'none';
  rate = custom ? Math.max(0.05, Math.min(10, +$('rateCustom').value || 1)) : +e.target.value;
};
$('rateCustom').oninput = e => { rate = Math.max(0.05, Math.min(10, +e.target.value || 1)); };
document.querySelectorAll('#left [data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));

window.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, select, textarea')) { if (e.key === 'Escape') { e.target.blur(); closePanels(); } return; }
  if (tourAt >= 0) { if (e.key === 'Escape') endTour(); return; }
  if ([...document.querySelectorAll('.modal')].some(m => m.style.display === 'flex')) { if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); return; }
  if (!project) return;
  if (drawing) { if (e.key === 'Escape') endDraw(); return; }
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (ctrl && k === 'z' && !e.shiftKey) { undo(); e.preventDefault(); }
  else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { redo(); e.preventDefault(); }
  else if (ctrl && k === 'c') { copyFrames(); e.preventDefault(); }
  else if (ctrl && k === 'v') { pasteFrames(); e.preventDefault(); }
  else if (ctrl && k === 's') { saveNow(); toast('Saved'); e.preventDefault(); }
  else if (ctrl && k === 'a') { fsel = new Set(frames.map((_, i) => i)); refresh(); e.preventDefault(); }
  else if (ctrl) return;
  else if (e.key === ' ') { playing ? stopPlay() : startPlay(); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { fsel = new Set(); goto(cur - 1); }
  else if (e.key === 'ArrowRight') { fsel = new Set(); goto(cur + 1); }
  else if (k === 'n' || e.key === '+') addFrame();
  else if (k === 'm') mirrorFrames();
  else if (k === 'g') feetOnGround();
  else if (k === 't') setTest(!testMode);
  else if (e.key === 'Delete') deleteFrames();
  else if (e.key === 'Escape') { select(null); closePanels(); hideMenu(); fsel = new Set(); refresh(); }
});

// ================================================================== start
function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (drawing) { sizeDrawLayer(); redrawStrokes(); }
}
new ResizeObserver(resize).observe(view); resize();
applyTheme();
showHome().then(openSharedLink);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});

let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (project) {
    if (playing) playStep(dt);
    controls.update();
    placeGizmo();
    renderer.render(scene, camera);
  }
});
// test hook (used to check the maths); harmless for normal use
window.R6Flipbook = { get project() { return project; }, get frames() { return frames; }, get order() { return order; }, get A() { return A; }, get cur() { return cur; },
  transformsFromWorlds, worldsFromTransforms, buildRbxmx, rbxmxToAnim, mirrorPose, centered, poseAtTime, buildPlay, setPlay: p => play = p, db, projectFromOld, openProject, showHome, aiPrompt, makeShareLink, openSharedLink, makeGif };
