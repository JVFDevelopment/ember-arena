import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { sfx, unlockAudio } from "./audio.js";

// ============================================================ helpers
const $ = (s) => document.querySelector(s);
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const flat = (v) => Math.hypot(v.x, v.z);
const TEST = new URLSearchParams(location.search).has("test");

const ARENA_R = 19;
const C = { mint: 0x7cf7c9, purple: 0x8a7bff, pink: 0xff6fb5, ember: 0xff6a3d, gold: 0xffae3d, red: 0xff3344 };

// ============================================================ renderer / scene
const canvas = $("#game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060d);
scene.fog = new THREE.Fog(0x05060d, 35, 95);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 250);
// bloom makes the sword, embers and telegraphs glow; switched off automatically if frames drop
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.55, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let useBloom = !new URLSearchParams(location.search).has("nobloom");
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// moon + sky tint (turns blood-red during boss waves)
const skyCol = new THREE.Color(0x05060d), bossSky = new THREE.Color(0x1a0508), calmSky = new THREE.Color(0x05060d);
const moon = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshBasicMaterial({ color: 0xffe6c8, fog: false }));
moon.position.set(-40, 34, -70);
scene.add(moon);

scene.add(new THREE.HemisphereLight(0xa99cff, 0x2a1a20, 1.7));
const sun = new THREE.DirectionalLight(0xffe2c4, 2.6);
sun.position.set(14, 26, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 70 });
sun.shadow.normalBias = 0.03;
scene.add(sun);

// ============================================================ arena
const box = new THREE.BoxGeometry(1, 1, 1);
let runeRing;
{
  const cells = [];
  for (let x = -ARENA_R - 1; x <= ARENA_R + 1; x++) for (let z = -ARENA_R - 1; z <= ARENA_R + 1; z++) {
    const d = Math.hypot(x, z) + Math.sin(x * 1.3 + z * 0.7) * 0.6;
    if (d > ARENA_R + 1) continue;
    const depth = Math.floor((1 - d / (ARENA_R + 1)) * 9) + 1;
    for (let y = 0; y < depth; y++) {
      if (y > 0 && y < depth - 1 && d < ARENA_R - 1) continue; // hollow inside: only shell is visible
      const rune = y === 0 && Math.abs(Math.hypot(x, z) - 11) < 0.5;
      const crack = y === 0 && Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5) % 1 < 0.035; // sparse, irregular
      const col = rune ? 0x4a3c86 : crack ? 0x7a3a24 : y === 0 ? ((x + z) & 1 ? 0x3d4160 : 0x454a6b) : 0x2c2f48;
      cells.push([x, -0.5 - y, z, col]);
    }
  }
  const floor = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 0.9 }), cells.length);
  const m = new THREE.Matrix4();
  cells.forEach(([x, y, z, col], i) => { floor.setMatrixAt(i, m.makeTranslation(x, y, z)); floor.setColorAt(i, new THREE.Color(col)); });
  floor.receiveShadow = true;
  scene.add(floor);
  // glowing rune ring
  const ring = runeRing = new THREE.Mesh(new THREE.RingGeometry(10.7, 11.3, 96), new THREE.MeshBasicMaterial({ color: C.purple, transparent: true, opacity: 0.35 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);
}

// broken pillars with braziers
const flames = [];
const glowTex = (() => {
  const cv = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  const g = cv.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(255,255,255,.4)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
const glowSprite = (color, size, opacity = 1) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size);
  return s;
};
const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3a3d55, roughness: 0.85 });
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * TAU + 0.2, h = 3 + (i % 3) * 1.6;
  const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 1.6), stoneMat);
  p.position.set(Math.cos(a) * (ARENA_R + 0.2), h / 2, Math.sin(a) * (ARENA_R + 0.2));
  p.rotation.y = a;
  p.castShadow = p.receiveShadow = true;
  scene.add(p);
  if (i % 2 === 0) {
    const fire = glowSprite(C.ember, 3.2);
    fire.position.set(p.position.x, h + 0.6, p.position.z);
    scene.add(fire);
    const light = new THREE.PointLight(0xff7a3d, 25, 16, 1.8);
    light.position.copy(fire.position);
    scene.add(light);
    flames.push({ fire, light, seed: i });
  }
}
// stars + drifting rocks
{
  const n = 1800, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 90 + Math.random() * 60, t = Math.random() * TAU, p = Math.acos(2 * Math.random() - 1);
    pos.set([r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc9ccff, size: 0.6, fog: false })));
}
const rocks = [];
for (let i = 0; i < 14; i++) {
  const r = new THREE.Mesh(box, stoneMat);
  const a = Math.random() * TAU, d = rand(28, 50);
  r.position.set(Math.cos(a) * d, rand(-12, 10), Math.sin(a) * d);
  r.scale.setScalar(rand(1, 3.5));
  r.userData = { s: rand(0.1, 0.4), p: Math.random() * TAU };
  scene.add(r);
  rocks.push(r);
}

{ const halo = glowSprite(0xffd8a8, 70, 0.35); halo.position.z = -1; moon.add(halo); }

// embers drifting up off the arena (one Points object, updated in place)
const EMBERS = 260;
const emberPos = new Float32Array(EMBERS * 3), emberVel = new Float32Array(EMBERS);
const resetEmber = (i, y = 0) => {
  const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * ARENA_R;
  emberPos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
  emberVel[i] = rand(0.6, 2.2);
};
for (let i = 0; i < EMBERS; i++) resetEmber(i, Math.random() * 14);
const emberGeo = new THREE.BufferGeometry();
emberGeo.setAttribute("position", new THREE.BufferAttribute(emberPos, 3));
const embers = new THREE.Points(emberGeo, new THREE.PointsMaterial({ map: glowTex, color: 0xff8a4a, size: 0.35, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
scene.add(embers);
function updateEmbers(dt) {
  for (let i = 0; i < EMBERS; i++) {
    const k = i * 3;
    emberPos[k + 1] += emberVel[i] * dt;
    emberPos[k] += Math.sin(time * 0.8 + i) * 0.3 * dt;
    if (emberPos[k + 1] > 14) resetEmber(i);
  }
  emberGeo.attributes.position.needsUpdate = true;
}

// ============================================================ particles
const MAX_P = 400;
const parts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshBasicMaterial(), MAX_P);
parts.frustumCulled = false;
const pState = Array.from({ length: MAX_P }, () => ({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), max: 1 }));
const zero = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < MAX_P; i++) { parts.setMatrixAt(i, zero); parts.setColorAt(i, new THREE.Color()); }
scene.add(parts);
let pNext = 0;
const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
function burst(pos, color, n = 14, speed = 6, up = 3) {
  for (let k = 0; k < n; k++) {
    const p = pState[pNext];
    p.pos.copy(pos);
    p.vel.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.3, 1) * speed).add(_v.set(0, up, 0));
    p.life = p.max = rand(0.35, 0.8);
    parts.setColorAt(pNext, _c.set(color).multiplyScalar(2));
    pNext = (pNext + 1) % MAX_P;
  }
  parts.instanceColor.needsUpdate = true;
}
function updateParticles(dt) {
  for (let i = 0; i < MAX_P; i++) {
    const p = pState[i];
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { parts.setMatrixAt(i, zero); continue; }
    p.vel.y -= 14 * dt;
    p.pos.addScaledVector(p.vel, dt);
    if (p.pos.y < 0.07) { p.pos.y = 0.07; p.vel.y *= -0.3; p.vel.x *= 0.7; p.vel.z *= 0.7; }
    parts.setMatrixAt(i, _m.compose(p.pos, _q, _s.setScalar(p.life / p.max)));
  }
  parts.instanceMatrix.needsUpdate = true;
}

// slash arcs and ground telegraphs share one sector shape
function sector(radius, arc, color, opacity) {
  const geo = new THREE.RingGeometry(radius * 0.25, radius, 32, 1, Math.PI / 2 - arc / 2, arc);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// ============================================================ voxel figures
function part(w, h, d, color, emissive = 0, ei = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.7, emissive, emissiveIntensity: ei }));
  m.castShadow = true;
  return m;
}
function makeKnight() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const legL = part(0.32, 0.7, 0.34, 0x2b2e48), legR = legL.clone();
  legL.position.set(-0.2, 0.35, 0); legR.position.set(0.2, 0.35, 0);
  const torso = part(0.8, 0.8, 0.5, 0x4a4f7a); torso.position.y = 1.1;
  const belt = part(0.84, 0.12, 0.54, 0x8a5a3c); belt.position.y = 0.76;
  const head = part(0.56, 0.56, 0.56, 0x6b7099); head.position.y = 1.8;
  const visor = part(0.42, 0.08, 0.05, C.mint, C.mint, 2.5); visor.position.set(0, 1.82, 0.29);
  const plume = part(0.1, 0.35, 0.4, C.pink, C.pink, 0.4); plume.position.set(0, 2.2, -0.05);
  const cape = part(0.7, 1.0, 0.06, 0x3b2f6b); cape.position.set(0, 1.05, -0.3);
  const armPivot = new THREE.Group(); armPivot.position.set(0.5, 1.35, 0);
  const arm = part(0.24, 0.6, 0.24, 0x4a4f7a); arm.position.y = -0.25; armPivot.add(arm);
  const sword = new THREE.Group(); sword.position.set(0, -0.5, 0.1); armPivot.add(sword);
  const hilt = part(0.12, 0.12, 0.4, 0x8a5a3c); sword.add(hilt);
  const guard = part(0.4, 0.08, 0.08, C.gold, C.gold, 0.5); guard.position.z = 0.2; sword.add(guard);
  const blade = part(0.08, 0.06, 1.5, C.mint, C.mint, 2.2); blade.position.z = 0.98; sword.add(blade);
  const shield = part(0.12, 0.7, 0.55, 0x3b2f6b); shield.position.set(-0.55, 1.15, 0.05);
  const boss = part(0.14, 0.2, 0.2, C.gold, C.gold, 0.6); boss.position.set(-0.07, 0, 0); shield.add(boss);
  body.add(legL, legR, torso, belt, head, visor, plume, cape, armPivot, shield);
  const swordGlow = glowSprite(C.mint, 1.4, 0.0);
  swordGlow.position.z = 1.2;
  sword.add(swordGlow);
  g.userData = { body, legL, legR, armPivot, cape, swordGlow, blade, shield };
  return g;
}

const ENEMY = {
  husk: { hp: 45, speed: 3.6, radius: 0.6, poise: 30, scale: 1, color: 0x5b5f78, eye: C.ember, score: 100,
    atk: { wind: 0.55, active: 0.16, rec: 0.6, dmg: 16, range: 1.9, arc: 1.6, lunge: 5, cd: 1.1 } },
  brute: { hp: 150, speed: 2.4, radius: 1.0, poise: 90, scale: 1.6, color: 0x6b4a3c, eye: C.gold, score: 300,
    atk: { wind: 0.95, active: 0.2, rec: 0.9, dmg: 32, range: 3.0, arc: 2.4, lunge: 4, cd: 1.6 } },
  caster: { hp: 32, speed: 2.9, radius: 0.6, poise: 20, scale: 1, color: 0x3b2f6b, eye: C.purple, score: 200, keep: 10,
    atk: { wind: 0.75, rec: 0.6, dmg: 14, cd: 2.6, ranged: true } },
  warden: { hp: 750, speed: 2.7, radius: 1.5, poise: 260, scale: 2.4, color: 0x2a2440, eye: C.red, score: 3000, boss: true,
    atk: { wind: 0.8, active: 0.22, rec: 0.8, dmg: 36, range: 4.2, arc: 2.6, lunge: 6, cd: 1.3 },
    slam: { wind: 1.25, active: 0.18, rec: 1.0, dmg: 40, radius: 5.5, cd: 1.6 } },
};

function makeEnemy(type) {
  const t = ENEMY[type];
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const eyeMat = new THREE.MeshStandardMaterial({ color: t.eye, emissive: t.eye, emissiveIntensity: 2 });
  const skinMat = new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.8, emissive: 0xffffff, emissiveIntensity: 0 });
  const add = (w, h, d, x, y, z, mat = skinMat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; body.add(m); return m; };
  let arm = null;
  if (type === "caster") {
    add(0.7, 1.1, 0.5, 0, 1.3, 0);
    add(0.5, 0.5, 0.5, 0, 2.1, 0.05);
    add(0.4, 0.08, 0.05, 0, 2.12, 0.31, eyeMat);
    add(0.9, 0.5, 0.7, 0, 0.75, 0);
    const orb = glowSprite(C.purple, 1.4, 0.8); orb.position.set(0.6, 1.6, 0.4); body.add(orb);
    g.userData.orb = orb;
  } else {
    add(0.3, 0.6, 0.3, -0.22, 0.3, 0); add(0.3, 0.6, 0.3, 0.22, 0.3, 0);
    add(0.85, 0.8, 0.5, 0, 0.95, -0.05);
    add(0.5, 0.48, 0.5, 0, 1.55, 0.1);
    add(0.36, 0.07, 0.05, 0, 1.6, 0.36, eyeMat);
    arm = new THREE.Group(); arm.position.set(0.55, 1.25, 0); body.add(arm);
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.9, 0.26), skinMat); a.position.y = -0.35; a.castShadow = true; arm.add(a);
    const club = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 1.1), new THREE.MeshStandardMaterial({ color: 0x3a2a22, emissive: t.eye, emissiveIntensity: 0.3 }));
    club.position.set(0, -0.8, 0.45); club.castShadow = true; arm.add(club);
    if (type === "warden") { add(1.3, 0.2, 0.7, 0, 1.4, -0.05, new THREE.MeshStandardMaterial({ color: C.gold, emissive: C.gold, emissiveIntensity: 0.4 })); add(0.12, 0.4, 0.12, -0.2, 1.95, 0.1, eyeMat); add(0.12, 0.4, 0.12, 0.2, 1.95, 0.1, eyeMat); }
  }
  g.scale.setScalar(t.scale);
  g.userData = { ...g.userData, body, arm, eyeMat, skinMat };
  return g;
}

// ============================================================ state
const player = {
  mesh: makeKnight(), pos: new THREE.Vector3(), vel: new THREE.Vector3(), facing: 0,
  hp: 100, maxHp: 100, st: 100, maxSt: 100, stDelay: 0, flasks: 3,
  state: "free", t: 0, atk: null, combo: 0, buffer: null, bufferT: 0, hitSet: new Set(), iframe: false, rollDir: new THREE.Vector3(), healed: false,
  parrying: false, maxFlasks: 3,
  // boons stack on these
  buffs: { dmg: 1, rollCost: 1, taken: 1, regen: 1, speed: 1, lifesteal: 0, emberBlade: false, riposte: 3 },
};
scene.add(player.mesh);
const slashFx = sector(3.2, 2.2, C.mint, 0);
slashFx.position.y = 1.1;
scene.add(slashFx);

// sword trail: a ribbon through the blade's recent positions, rebuilt only while swinging
const TRAIL = 14;
const trailPos = new Float32Array(TRAIL * 2 * 3), trailAlpha = new Float32Array(TRAIL * 2);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute("alpha", new THREE.BufferAttribute(trailAlpha, 1));
const trailIdx = [];
for (let i = 0; i < TRAIL - 1; i++) { const a = i * 2; trailIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
trailGeo.setIndex(trailIdx);
const trail = new THREE.Mesh(trailGeo, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { color: { value: new THREE.Color(C.mint).multiplyScalar(2) } },
  vertexShader: "attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
  fragmentShader: "uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color * vA, vA); }",
}));
trail.frustumCulled = false;
scene.add(trail);
const trailPts = []; // [{ base, tip }] newest first
const _tb = new THREE.Vector3(), _tt = new THREE.Vector3();
function updateTrail(active, dt) {
  const { blade } = player.mesh.userData;
  if (active) {
    blade.localToWorld(_tb.set(0, 0, -0.6));
    blade.localToWorld(_tt.set(0, 0, 0.8));
    trailPts.unshift({ base: _tb.clone(), tip: _tt.clone(), life: 1 });
  }
  for (const p of trailPts) p.life -= dt * 7;
  while (trailPts.length > TRAIL || (trailPts.length && trailPts[trailPts.length - 1].life <= 0)) trailPts.pop();
  trail.visible = trailPts.length > 1;
  if (!trail.visible) return;
  for (let i = 0; i < TRAIL; i++) {
    const p = trailPts[Math.min(i, trailPts.length - 1)];
    trailPos.set([p.base.x, p.base.y, p.base.z], i * 6);
    trailPos.set([p.tip.x, p.tip.y, p.tip.z], i * 6 + 3);
    const a = i < trailPts.length ? Math.max(0, p.life) * (1 - i / TRAIL) * 0.8 : 0;
    trailAlpha[i * 2] = a * 0.2; trailAlpha[i * 2 + 1] = a;
  }
  trailGeo.attributes.position.needsUpdate = trailGeo.attributes.alpha.needsUpdate = true;
}

// ============================================================ boons (pick 1 of 3 between waves)
const BOONS = [
  { id: "whetstone", name: "Whetstone", desc: "+20% damage", apply: (b) => (b.dmg *= 1.2) },
  { id: "feather", name: "Featherstep", desc: "Rolls cost 35% less stamina", apply: (b) => (b.rollCost *= 0.65) },
  { id: "flask", name: "Deep Flask", desc: "+1 flask, refilled now", apply: () => { player.maxFlasks++; player.flasks = player.maxFlasks; } },
  { id: "leech", name: "Bloodthirst", desc: "Heal 3 HP per hit", apply: (b) => (b.lifesteal += 3) },
  { id: "iron", name: "Iron Skin", desc: "Take 20% less damage", apply: (b) => (b.taken *= 0.8) },
  { id: "wind", name: "Second Wind", desc: "+40% stamina regen", apply: (b) => (b.regen *= 1.4) },
  { id: "haste", name: "Swift Hands", desc: "Attacks 15% faster", apply: (b) => (b.speed *= 1.15) },
  { id: "ember", name: "Ember Blade", desc: "Heavy attacks erupt in fire", apply: (b) => (b.emberBlade = true), once: true },
  { id: "vigor", name: "Vigor", desc: "+25 max HP, healed fully", apply: () => { player.maxHp += 25; player.hp = player.maxHp; } },
  { id: "riposte", name: "Executioner", desc: "Ripostes deal 4x damage", apply: (b) => (b.riposte = 4), once: true },
];
let boonChoices = [], taken = new Set();
function offerBoons() {
  const pool = BOONS.filter((b) => !(b.once && taken.has(b.id)));
  boonChoices = pool.sort(() => Math.random() - 0.5).slice(0, 3);
  $("#boon-list").replaceChildren(...boonChoices.map((b, i) => {
    const btn = document.createElement("button");
    btn.className = "boon";
    btn.innerHTML = `<kbd>${i + 1}</kbd><b>${b.name}</b><span>${b.desc}</span>`;
    btn.addEventListener("click", () => pickBoon(i));
    return btn;
  }));
  game = "boon";
  $("#boons").hidden = false;
  if (document.pointerLockElement) document.exitPointerLock();
}
function pickBoon(i) {
  const b = boonChoices[i];
  if (!b || game !== "boon") return;
  b.apply(player.buffs);
  taken.add(b.id);
  sfx("boon");
  $("#boons").hidden = true;
  play();
  waveTimer = 1.2;
}

const ATTACKS = {
  light: { cost: 14, active: [0.08, 0.2], total: 0.42, dmg: 22, poise: 22, range: 2.8, arc: 2.0, lunge: 4 },
  heavy: { cost: 28, active: [0.36, 0.52], total: 0.92, dmg: 50, poise: 70, range: 3.3, arc: 2.6, lunge: 6 },
};

let enemies = [], orbs = [];
let game = "title", wave = 0, waveTimer = 0, score = 0, mult = 1, multT = 0, kills = 0, best = +(localStorage.getItem("ember.best") || 0);
let lock = null, hitstop = 0, shake = 0, time = 0;
const cam = { yaw: Math.PI, pitch: 0.42, dist: 9 };
const keys = new Set();

// ============================================================ input
addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (game === "boon" && /^Digit[123]$/.test(e.code)) return pickBoon(+e.code.slice(5) - 1);
  if (game !== "play") return;
  if (e.code === "Space") { e.preventDefault(); queue("roll"); }
  if (e.code === "KeyF") queue("parry");
  if (e.code === "KeyQ") toggleLock();
  if (e.code === "KeyR") queue("heal");
  if (e.code === "Escape") pause();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("mousedown", (e) => {
  if (game !== "play") return;
  if (e.button === 0) queue("light");
  if (e.button === 2) queue("heavy");
  if (e.button === 1) { e.preventDefault(); toggleLock(); }
});
addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("mousemove", (e) => {
  if (game !== "play" || document.pointerLockElement !== canvas) return;
  if (!lock) cam.yaw -= e.movementX * 0.0032;
  cam.pitch = clamp(cam.pitch + e.movementY * 0.0024, 0.12, 1.1);
});
document.addEventListener("pointerlockchange", () => { if (!document.pointerLockElement && game === "play" && !TEST) pause(); });
addEventListener("blur", () => game === "play" && !TEST && pause());

function queue(action) { player.buffer = action; player.bufferT = 0.35; }

function toggleLock() {
  if (lock) { lock = null; return; }
  let best = null, bestScore = Infinity;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = e.pos.distanceTo(player.pos);
    if (d > 26) continue;
    const off = Math.abs(angDiff(cam.yaw + Math.PI, yawTo(player.pos, e.pos)));
    const s = d + off * 8;
    if (s < bestScore) { bestScore = s; best = e; }
  }
  lock = best;
}

// ============================================================ HUD
const hud = {
  hp: $(".bars .hp .fill"), hpGhost: $(".bars .hp .ghost"), st: $(".bars .st .fill"), stBar: $(".bars .st"),
  flasks: $("#flasks"), wave: $("#wave"), score: $("#score"), mult: $("#mult"), boss: $("#boss"), bossFill: $("#boss .fill"), bossGhost: $("#boss .ghost"),
  reticle: $("#reticle"), numbers: $("#numbers"), banner: $("#banner"), hurt: $("#hurt"),
};
function banner(text) { hud.banner.textContent = text; hud.banner.classList.remove("show"); void hud.banner.offsetWidth; hud.banner.classList.add("show"); }
const _p = new THREE.Vector3();
function screenOf(pos, yOff = 0) { _p.copy(pos); _p.y += yOff; _p.project(camera); return _p.z < 1 ? [(_p.x + 1) / 2 * innerWidth, (1 - _p.y) / 2 * innerHeight] : null; }
function number(pos, text, cls = "") {
  const s = screenOf(pos, 2.2);
  if (!s) return;
  const b = document.createElement("b");
  b.textContent = text; b.className = cls;
  b.style.transform = `translate(${s[0] + rand(-14, 14)}px, ${s[1]}px)`;
  hud.numbers.append(b);
  setTimeout(() => b.remove(), 800);
}
function drawHud() {
  hud.hp.style.transform = hud.hpGhost.style.transform = `scaleX(${player.hp / player.maxHp})`;
  hud.st.style.transform = `scaleX(${player.st / player.maxSt})`;
  if (hud.flaskCount !== player.flasks) { // only touch the DOM when it changes
    hud.flaskCount = player.flasks;
    hud.flasks.replaceChildren(...Array.from({ length: player.maxFlasks }, (_, i) => i).map((i) => Object.assign(document.createElement("i"), { className: i < player.flasks ? "" : "used" })));
  }
  hud.score.textContent = score.toLocaleString();
  hud.mult.textContent = mult > 1 ? `x${mult} streak` : "";
  const boss = enemies.find((e) => e.t.boss && !e.dead);
  hud.boss.hidden = !boss;
  if (boss) hud.bossFill.style.transform = hud.bossGhost.style.transform = `scaleX(${Math.max(0, boss.hp / boss.maxHp)})`;
  const s = lock && !lock.dead ? screenOf(lock.pos, 1.3 * lock.t.scale) : null;
  hud.reticle.hidden = !s;
  if (s) hud.reticle.style.transform = `translate(${s[0]}px, ${s[1]}px)`;
}
function noStamina() { hud.stBar.classList.remove("empty"); void hud.stBar.offsetWidth; hud.stBar.classList.add("empty"); }

// ============================================================ player
const _in = new THREE.Vector3();
function moveInput() {
  const f = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0), r = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  if (!f && !r) return null;
  const fy = cam.yaw + Math.PI; // camera looks along this yaw
  return _in.set(Math.sin(fy) * f - Math.cos(fy) * r, 0, Math.cos(fy) * f + Math.sin(fy) * r).normalize();
}

function spend(n) {
  if (player.st <= 0) { noStamina(); return false; }
  player.st = Math.max(-20, player.st - n); // can act on a sliver of stamina, Souls-style
  player.stDelay = 0.6;
  return true;
}

function startAction(a) {
  const p = player;
  if (a === "parry") {
    if (!spend(10)) return;
    p.state = "parry"; p.t = 0;
    if (lock && !lock.dead) p.facing = yawTo(p.pos, lock.pos);
  } else if (a === "roll") {
    if (!spend(22 * p.buffs.rollCost)) return;
    sfx("roll");
    const dir = moveInput();
    if (dir) p.rollDir.copy(dir); else p.rollDir.set(-Math.sin(p.facing), 0, -Math.cos(p.facing)); // backstep
    p.facing = Math.atan2(p.rollDir.x, p.rollDir.z);
    p.state = "roll"; p.t = 0;
  } else if (a === "light" || a === "heavy") {
    if (!spend(ATTACKS[a].cost)) return;
    p.combo = p.state === "attack" && a === "light" ? p.combo + 1 : 0;
    p.state = "attack"; p.atk = ATTACKS[a]; p.atkName = a; p.t = 0; p.hitSet.clear(); p.swung = false;
    if (lock && !lock.dead) p.facing = yawTo(p.pos, lock.pos);
    else { const dir = moveInput(); if (dir) p.facing = Math.atan2(dir.x, dir.z); }
  } else if (a === "heal") {
    if (p.flasks <= 0 || p.hp >= p.maxHp) return;
    p.flasks--; p.state = "heal"; p.t = 0; p.healed = false;
  }
}

const PARRY_WINDOW = [0.03, 0.2], PARRY_TOTAL = 0.5;

function canAct(a) {
  const p = player;
  if (p.state === "free") return true;
  if (p.state === "attack") {
    const pastActive = p.t > p.atk.active[1];
    if (a === "roll") return pastActive; // roll-cancel the recovery
    if (a === "light" && p.atkName === "light") return p.t > p.atk.active[1] + 0.02 && p.combo < 2;
    return p.t >= p.atk.total - 0.05;
  }
  if (p.state === "roll") return p.t > 0.42 && a !== "heal";
  if (p.state === "parry") return p.t > PARRY_WINDOW[1] + 0.1;
  return false;
}

const _fwd = new THREE.Vector3(), _dir = new THREE.Vector3(), _side = new THREE.Vector3(), _off = new THREE.Vector3(), _look = new THREE.Vector3();
function updatePlayer(dt) {
  const p = player;
  p.t += p.state === "attack" ? dt * p.buffs.speed : dt;
  p.bufferT -= dt;
  p.parrying = p.state === "parry" && p.t >= PARRY_WINDOW[0] && p.t <= PARRY_WINDOW[1];
  if (p.buffer && p.bufferT > 0 && canAct(p.buffer)) { const a = p.buffer; p.buffer = null; startAction(a); }
  if (p.bufferT <= 0) p.buffer = null;

  // stamina
  p.stDelay -= dt;
  if (p.stDelay <= 0 && p.state !== "roll") p.st = Math.min(p.maxSt, p.st + (p.state === "free" ? 45 : 20) * p.buffs.regen * dt);

  const input = moveInput();
  let speed = 0;
  p.iframe = false;
  const { body, legL, legR, armPivot, cape, swordGlow } = p.mesh.userData;
  armPivot.rotation.set(0, 0, 0);
  body.rotation.set(0, 0, 0);
  body.position.y = 0;
  swordGlow.material.opacity = damp(swordGlow.material.opacity, 0, 10, dt);
  slashFx.material.opacity = damp(slashFx.material.opacity, 0, 14, dt);

  if (p.state === "free") {
    if (input) {
      speed = keys.has("ShiftLeft") && p.st > 0 ? 9.5 : 6.5;
      if (speed > 7) { p.st -= 12 * dt; p.stDelay = 0.3; }
      p.vel.copy(input).multiplyScalar(speed);
      if (!lock) p.facing += angDiff(p.facing, Math.atan2(input.x, input.z)) * Math.min(1, 14 * dt);
    } else p.vel.multiplyScalar(Math.exp(-14 * dt));
    if (lock && !lock.dead) p.facing += angDiff(p.facing, yawTo(p.pos, lock.pos)) * Math.min(1, 12 * dt);
    const stride = Math.sin(time * 11) * Math.min(1, p.vel.length() / 6);
    legL.rotation.x = stride * 0.7; legR.rotation.x = -stride * 0.7;
    armPivot.rotation.x = -0.3 - stride * 0.3;
    cape.rotation.x = 0.15 + p.vel.length() * 0.04;
  } else if (p.state === "roll") {
    const T = 0.55, k = p.t / T;
    p.iframe = p.t > 0.04 && p.t < 0.38;
    p.vel.copy(p.rollDir).multiplyScalar(15 * (1 - k) ** 1.4);
    body.rotation.x = k * TAU;
    body.position.y = Math.sin(k * Math.PI) * 0.3;
    if (p.t >= T) p.state = "free";
  } else if (p.state === "attack") {
    const a = p.atk, [s, e] = a.active, inActive = p.t >= s && p.t <= e;
    if (lock && !lock.dead && p.t < s) p.facing += angDiff(p.facing, yawTo(p.pos, lock.pos)) * Math.min(1, 10 * dt);
    const fwd = _fwd.set(Math.sin(p.facing), 0, Math.cos(p.facing));
    p.vel.copy(fwd).multiplyScalar(inActive ? a.lunge : p.t < s ? a.lunge * 0.3 : 0);
    // sword animation
    const side = p.combo % 2 ? -1 : 1;
    if (p.atkName === "heavy") {
      const k = p.t < s ? p.t / s : Math.min(1, (p.t - s) / (e - s));
      armPivot.rotation.x = p.t < s ? -2.6 * k : -2.6 + 3.6 * k;
      body.rotation.x = p.t < s ? -0.2 * k : 0.25;
    } else {
      const k = p.t < s ? p.t / s : Math.min(1, (p.t - s) / (e - s));
      armPivot.rotation.x = -1.4;
      armPivot.rotation.z = p.t < s ? 1.3 * side * k : side * (1.3 - 2.8 * k);
      body.rotation.y = side * (p.t < s ? 0.3 * k : 0.3 - 0.7 * k);
    }
    if (inActive && !p.swung) { p.swung = true; sfx(p.atkName === "heavy" ? "heavySwing" : "swing"); }
    if (inActive) {
      swordGlow.material.opacity = 0.9;
      slashFx.material.opacity = 0.35;
      slashFx.position.set(p.pos.x, 1.1, p.pos.z);
      slashFx.rotation.z = p.facing;
      for (const en of enemies) {
        if (en.dead || en.state === "spawn" || p.hitSet.has(en)) continue;
        const d = flat(_v.subVectors(en.pos, p.pos));
        if (d > a.range + en.t.radius * en.t.scale * 0.6) continue;
        if (Math.abs(angDiff(p.facing, yawTo(p.pos, en.pos))) > a.arc / 2 && d > en.t.radius * 1.2) continue;
        p.hitSet.add(en);
        hitEnemy(en, a, fwd);
      }
    }
    if (p.t >= a.total) { p.state = "free"; p.combo = 0; }
  } else if (p.state === "heal") {
    p.vel.multiplyScalar(Math.exp(-10 * dt));
    if (input) p.vel.copy(input).multiplyScalar(2);
    armPivot.rotation.x = -2.2 * Math.sin(Math.min(1, p.t / 0.6) * Math.PI / 2);
    if (p.t > 0.6 && !p.healed) {
      p.healed = true;
      p.hp = Math.min(p.maxHp, p.hp + 45);
      sfx("flask");
      burst(p.pos.clone().setY(1.4), C.gold, 22, 3, 4);
      number(p.pos, "+45", "big");
    }
    if (p.t > 1.05) p.state = "free";
  } else if (p.state === "parry") {
    p.vel.multiplyScalar(Math.exp(-14 * dt));
    const k = Math.min(1, p.t / 0.06);
    p.mesh.userData.shield.position.set(-0.35 + 0.2 * k, 1.25 + 0.15 * k, 0.05 + 0.4 * k); // shield thrust forward
    body.rotation.y = 0.35 * k;
    if (p.t >= PARRY_TOTAL) p.state = "free";
  } else if (p.state === "hurt") {
    p.vel.multiplyScalar(Math.exp(-8 * dt));
    body.rotation.x = -0.35;
    if (p.t > 0.38) p.state = "free";
  } else if (p.state === "dead") {
    p.vel.set(0, 0, 0);
    body.rotation.x = -Math.min(1, p.t * 2) * 1.5;
  }

  if (p.state !== "parry") p.mesh.userData.shield.position.set(-0.55, 1.15, 0.05);
  updateTrail(p.state === "attack" && p.t >= p.atk.active[0] - 0.04 && p.t <= p.atk.active[1] + 0.02, dt);
  p.pos.addScaledVector(p.vel, dt);
  const r = flat(p.pos);
  if (r > ARENA_R - 0.8) p.pos.multiplyScalar((ARENA_R - 0.8) / r);
  p.mesh.position.copy(p.pos);
  p.mesh.rotation.y = p.facing;
}

// returns "parried" | "blocked" | "dodged" | "hit"
function hurtPlayer(dmg, from, source = null) {
  const p = player;
  if (p.state === "dead") return "dodged";
  if (p.iframe) { burst(p.pos.clone().setY(1), C.mint, 6, 2, 2); return "dodged"; }
  const facingIt = from && Math.abs(angDiff(p.facing, yawTo(p.pos, from))) < 1.3;
  if (p.parrying && facingIt) {
    sfx("parry");
    hitstop = 0.16; shake = Math.max(shake, 0.35);
    burst(p.pos.clone().setY(1.3).addScaledVector(_fwd.set(Math.sin(p.facing), 0, Math.cos(p.facing)), 0.8), C.gold, 26, 7, 2);
    number(p.pos, "PARRY", "big");
    p.facing = yawTo(p.pos, from); // square up for the riposte
    if (source && !source.t.boss) { source.state = "riposte"; source.st = 0; source.tele && (source.tele.visible = false); }
    else if (source) { source.poise -= 80; if (source.poise <= 0) { source.poise = source.t.poise; source.state = "riposte"; source.st = 0; } }
    return "parried";
  }
  if (p.state === "parry" && facingIt && p.st > 0) { // late press: a block soaks half
    dmg = Math.round(dmg * 0.5);
    p.st -= dmg * 1.5; p.stDelay = 0.6;
    sfx("block");
  }
  dmg = Math.max(1, Math.round(dmg * p.buffs.taken));
  sfx("hurt");
  p.hp -= dmg;
  number(p.pos, `-${dmg}`, "player");
  shake = Math.max(shake, 0.5);
  hitstop = 0.07;
  burst(p.pos.clone().setY(1.2), C.red, 16, 5, 3);
  hud.hurt.classList.add("on");
  setTimeout(() => hud.hurt.classList.remove("on"), 90);
  mult = 1; multT = 0;
  if (p.hp <= 0) { p.hp = 0; p.state = "dead"; p.t = 0; sfx("death"); game = "dying"; setTimeout(die, 1600); return "hit"; }
  p.state = "hurt"; p.t = 0;
  if (from) p.vel.subVectors(p.pos, from).setY(0).normalize().multiplyScalar(7);
  return "hit";
}

// ============================================================ enemies
function spawn(type) {
  const t = ENEMY[type];
  const a = yawTo(new THREE.Vector3(), player.pos) + Math.PI + rand(-1.4, 1.4);
  const d = rand(11, ARENA_R - 2);
  const e = { type, t, mesh: makeEnemy(type), pos: new THREE.Vector3(Math.sin(a) * d, 0, Math.cos(a) * d), vel: new THREE.Vector3(),
    hp: t.hp, poise: t.poise, state: "spawn", st: 0, cd: rand(0.5, 1.5), facing: 0, flash: 0, dead: false, move: null, tele: null,
    flank: rand(-1.1, 1.1) };
  e.hp = e.maxHp = Math.round(t.hp * (1 + 0.08 * Math.max(0, wave - 1))); // keeps pace with boons
  e.mesh.position.copy(e.pos);
  scene.add(e.mesh);
  burst(e.pos.clone().setY(0.2), t.eye, 20, 4, 6);
  enemies.push(e);
}

function hitEnemy(e, a, fwd, splash = false) {
  const b = player.buffs;
  const riposte = e.state === "riposte", crit = riposte || e.state === "stagger";
  const dmg = Math.round(a.dmg * b.dmg * (riposte ? b.riposte : crit ? 1.5 : 1) * rand(0.92, 1.08));
  e.hp -= dmg;
  e.flash = 1;
  number(e.pos, riposte ? `RIPOSTE ${dmg}` : crit ? `${dmg}!` : `${dmg}`, crit ? "big" : "");
  if (b.lifesteal && !splash) player.hp = Math.min(player.maxHp, player.hp + b.lifesteal);
  burst(e.pos.clone().setY(1.2 * e.t.scale), C.ember, a === ATTACKS.heavy || riposte ? 26 : 14, 7, 3);
  if (!splash) sfx(a === ATTACKS.heavy || riposte ? "heavyHit" : "hit");
  if (riposte) { e.state = "stagger"; e.st = 0.5; }
  // Ember Blade: heavy hits erupt, scorching others nearby
  if (b.emberBlade && a === ATTACKS.heavy && !splash) {
    burst(e.pos.clone().setY(0.4), C.gold, 30, 8, 5);
    for (const o of enemies) if (o !== e && !o.dead && o.state !== "spawn" && o.pos.distanceTo(e.pos) < 4) hitEnemy(o, EMBER_SPLASH, fwd, true);
  }
  hitstop = Math.max(hitstop, riposte ? 0.16 : a === ATTACKS.heavy ? 0.11 : 0.055);
  shake = Math.max(shake, a === ATTACKS.heavy ? 0.45 : 0.22);
  e.vel.copy(fwd).multiplyScalar((a === ATTACKS.heavy ? 9 : 5) / e.t.scale);
  if (e.hp <= 0) return kill(e);
  e.poise -= a.poise;
  if (e.poise <= 0) { e.poise = e.t.poise; e.state = "stagger"; e.st = 0; e.tele && (e.tele.visible = false); }
}

function kill(e) {
  e.dead = true; e.state = "dead"; e.st = 0;
  if (e.tele) e.tele.visible = false;
  if (lock === e) lock = null;
  kills++;
  score += e.t.score * mult;
  mult = Math.min(5, mult + 1); multT = 4;
  sfx("kill");
  // crumble: the body bursts into voxels of its own colour
  burst(e.pos.clone().setY(1 * e.t.scale), e.t.color, e.t.boss ? 90 : 36, e.t.boss ? 9 : 5, 4);
  burst(e.pos.clone().setY(1.2 * e.t.scale), e.t.eye, e.t.boss ? 40 : 10, 6, 5);
  if (e.t.boss) { banner("Warden felled"); shake = 1; hitstop = 0.25; bossWave.on = false; }
}
const EMBER_SPLASH = { dmg: 20, poise: 30 };

const _to = new THREE.Vector3();
function updateEnemy(e, dt) {
  e.st += dt; e.cd -= dt;
  const t = e.t, ud = e.mesh.userData;
  ud.skinMat.emissiveIntensity = (e.flash = Math.max(0, e.flash - dt * 6)) * 0.8;
  ud.body.rotation.set(0, 0, 0);
  if (ud.arm) ud.arm.rotation.set(0, 0, 0);

  if (e.state === "dead") {
    // shrink away fast: the voxel burst sells the crumble
    e.mesh.scale.setScalar(e.t.scale * Math.max(0.001, 1 - e.st * 3));
    if (e.st > 0.4) {
      scene.remove(e.mesh);
      e.mesh.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); // free GPU buffers
      for (const k in e.teles ?? {}) { scene.remove(e.teles[k]); e.teles[k].geometry.dispose(); e.teles[k].material.dispose(); }
      e.gone = true;
    }
    return;
  }
  if (e.state === "spawn") {
    e.mesh.position.y = -2.2 * t.scale * (1 - Math.min(1, e.st / 0.8));
    if (e.st > 0.8) e.state = "chase";
    return;
  }
  _to.subVectors(player.pos, e.pos).setY(0);
  const dist = _to.length(), target = Math.atan2(_to.x, _to.z);
  const turn = (k) => (e.facing += angDiff(e.facing, target) * Math.min(1, k * dt));
  ud.eyeMat.emissiveIntensity = 2;

  // Warden phase two at half health: faster, angrier, more slams
  if (t.boss && !e.enraged && e.hp < e.maxHp / 2) {
    e.enraged = true; e.state = "roar"; e.st = 0;
    sfx("roar"); banner("The Warden rages"); shake = 0.8;
    ud.eyeMat.color.set(C.ember);
  }
  const speedMul = e.enraged ? 1.35 : 1;

  if (e.state === "roar") {
    e.vel.multiplyScalar(Math.exp(-8 * dt));
    ud.body.rotation.x = -0.5;
    ud.eyeMat.emissiveIntensity = 14;
    if (e.st % 0.15 < dt) burst(e.pos.clone().setY(2.5 * t.scale), C.ember, 6, 6, 4);
    if (e.st > 1.4) { e.state = "chase"; e.cd = 0.3; }
  } else if (e.state === "stagger" || e.state === "riposte") {
    e.vel.multiplyScalar(Math.exp(-6 * dt));
    const long = e.state === "riposte";
    ud.body.rotation.x = long ? -0.7 : -0.4;
    ud.body.rotation.z = Math.sin(e.st * 30) * 0.08;
    if (long) ud.eyeMat.emissiveIntensity = 0.4; // dazed
    if (e.st > (long ? 1.6 : 0.9)) { e.state = "chase"; e.cd = 0.4; }
  } else if (e.state === "chase") {
    turn(6);
    const want = t.keep ? (dist < t.keep - 2 ? -1 : dist > t.keep + 2 ? 1 : 0) : dist > (t.atk.range ?? 2) * 0.8 ? 1 : 0;
    const dir = _dir.copy(_to).normalize();
    // husks fan out around the player instead of queueing behind each other
    if (e.type === "husk" && dist > 3.5) dir.add(_side.set(-dir.z, 0, dir.x).multiplyScalar(e.flank));
    if (t.keep) dir.add(_side.set(-dir.z, 0, dir.x).multiplyScalar(0.6 * Math.sin(time + e.pos.x))); // casters strafe
    e.vel.copy(dir).normalize().multiplyScalar(t.speed * speedMul * want);
    ud.body.rotation.z = Math.sin(time * 9 + e.pos.x) * 0.06 * Math.abs(want);
    if (player.state !== "dead" && e.cd <= 0) {
      if (t.slam && dist < t.slam.radius - 0.5 && Math.random() < (e.enraged ? 0.65 : 0.4)) startEnemyAttack(e, "slam");
      else if (t.atk.ranged && dist < 22) startEnemyAttack(e, "atk");
      else if (!t.atk.ranged && dist < t.atk.range + 0.6) startEnemyAttack(e, "atk");
    }
  } else if (e.state === "wind") {
    const m = e.move;
    if (!m.ranged) turn(m.radius ? 0 : 3.5);
    else turn(8);
    e.vel.multiplyScalar(Math.exp(-10 * dt));
    const k = Math.min(1, e.st / e.windT);
    // delayed swings: some attacks hold at full wind-up before releasing, punishing panic rolls
    if (e.hold && k >= 1) ud.body.rotation.y = Math.sin(e.st * 40) * 0.03;
    ud.eyeMat.emissiveIntensity = 2 + k * 10;
    ud.body.rotation.x = -0.3 * k;
    if (ud.arm) ud.arm.rotation.x = m.radius ? -3 * k : -2.2 * k;
    if (e.tele) { e.tele.material.opacity = 0.12 + 0.4 * k; e.tele.position.set(e.pos.x, 0.03, e.pos.z); e.tele.rotation.z = e.facing; }
    if (e.st >= e.windT + e.hold) {
      if (m.ranged) { fireOrb(e); e.state = "rec"; e.st = 0; }
      else { e.state = "active"; e.st = 0; e.hit = false; }
    }
  } else if (e.state === "active") {
    const m = e.move;
    if (!m.radius) e.vel.set(Math.sin(e.facing), 0, Math.cos(e.facing)).multiplyScalar(m.lunge);
    if (ud.arm) ud.arm.rotation.x = m.radius ? 0.8 : -2.2 + 3.2 * Math.min(1, e.st / m.active);
    ud.body.rotation.x = 0.2;
    if (!e.hit) {
      const inRange = m.radius ? dist < m.radius : dist < m.range + 0.5 && Math.abs(angDiff(e.facing, target)) < m.arc / 2;
      if (inRange) {
        e.hit = true;
        if (hurtPlayer(m.dmg, e.pos, m.radius ? null : e) === "parried") e.vel.set(0, 0, 0);
      }
    }
    if (m.radius && !e.slammed) {
      e.slammed = true;
      burst(e.pos.clone().setY(0.2), C.ember, 40, 9, 2);
      shake = Math.max(shake, 0.6);
      sfx("slam");
      runeFlash = 1; // arena runes flare on impact
    }
    if (e.st >= m.active && e.state === "active") { e.state = "rec"; e.st = 0; if (e.tele) e.tele.visible = false; }
  } else if (e.state === "rec") {
    e.vel.multiplyScalar(Math.exp(-8 * dt));
    if (ud.arm) ud.arm.rotation.x = 0.6 * (1 - e.st / e.move.rec);
    if (e.st >= e.move.rec) { e.state = "chase"; e.cd = e.move.cd * rand(0.8, 1.3); }
  }
  if (ud.orb) ud.orb.material.opacity = 0.6 + 0.3 * Math.sin(time * 5) + (e.state === "wind" ? e.st : 0);

  // keep apart from other enemies and the player
  for (const o of enemies) {
    if (o === e || o.dead) continue;
    _v.subVectors(e.pos, o.pos).setY(0);
    const d = _v.length(), min = (e.t.radius + o.t.radius) * 0.9;
    if (d > 0 && d < min) e.pos.addScaledVector(_v, ((min - d) / d) * 0.5);
  }
  if (dist < e.t.radius + 0.5 && dist > 0) e.pos.addScaledVector(_to, -((e.t.radius + 0.5 - dist) / dist));
  e.pos.addScaledVector(e.vel, dt);
  const r = flat(e.pos);
  if (r > ARENA_R - 1) e.pos.multiplyScalar((ARENA_R - 1) / r);
  e.mesh.position.set(e.pos.x, 0, e.pos.z);
  e.mesh.rotation.y = e.facing;
}

function startEnemyAttack(e, kind) {
  const m = e.t[kind];
  e.move = m; e.state = "wind"; e.st = 0; e.slammed = false;
  e.windT = m.wind / (e.enraged ? 1.25 : 1);
  e.hold = e.type === "brute" && Math.random() < 0.4 ? rand(0.35, 0.6) : e.enraged && Math.random() < 0.3 ? 0.4 : 0;
  if (m.ranged) return;
  // one ground telegraph per attack kind, built once and reused
  e.teles ??= {};
  if (!e.teles[kind]) { e.teles[kind] = m.radius ? sector(m.radius, TAU, C.red, 0) : sector(m.range + 0.6, m.arc, C.red, 0); scene.add(e.teles[kind]); }
  if (e.tele && e.tele !== e.teles[kind]) e.tele.visible = false;
  e.tele = e.teles[kind];
  e.tele.visible = true;
}

function fireOrb(e) {
  const s = glowSprite(C.purple, 1.6);
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshBasicMaterial({ color: 0xd8d0ff }));
  const g = new THREE.Group(); g.add(s, core);
  const from = e.pos.clone().setY(1.6);
  const to = player.pos.clone().setY(1.1).addScaledVector(player.vel, 0.25); // leads a little
  g.position.copy(from);
  scene.add(g);
  orbs.push({ g, vel: to.sub(from).normalize().multiplyScalar(12), life: 3.5, dmg: e.move.dmg, owner: e });
  sfx("orb");
}

const REFLECT = { dmg: 40, poise: 40 };
function updateOrbs(dt) {
  for (const o of orbs) {
    o.life -= dt;
    o.g.position.addScaledVector(o.vel, dt);
    o.g.children[1].rotation.x += dt * 8; o.g.children[1].rotation.y += dt * 6;
    if (o.reflected) {
      // a parried orb flies back and hits its caster (or anyone in the way)
      for (const e of enemies) {
        if (e.dead || e.state === "spawn" || o.g.position.distanceTo(_v.copy(e.pos).setY(1.4 * e.t.scale)) > 1.2 * e.t.scale) continue;
        hitEnemy(e, REFLECT, o.vel.clone().setY(0).normalize());
        o.life = 0;
        break;
      }
    } else if (o.g.position.distanceTo(_v.copy(player.pos).setY(1.1)) < 0.9 && player.state !== "dead") {
      const r = hurtPlayer(o.dmg, o.g.position);
      if (r === "parried") {
        o.reflected = true; o.life = 3;
        const target = o.owner && !o.owner.dead ? o.owner.pos.clone().setY(1.6) : o.g.position.clone().sub(o.vel);
        o.vel.copy(target.sub(o.g.position).normalize().multiplyScalar(18));
        o.g.children[0].material.color.set(C.gold);
      } else if (r !== "dodged") o.life = 0;
    }
    if (o.life <= 0) { scene.remove(o.g); burst(o.g.position, C.purple, 8, 3, 1); }
  }
  orbs = orbs.filter((o) => o.life > 0);
}

// ============================================================ waves
function nextWave() {
  wave++;
  const isBoss = wave % 5 === 0;
  bossWave.on = isBoss;
  banner(isBoss ? "The Warden awakens" : `Wave ${wave}`);
  sfx(isBoss ? "roar" : "wave");
  hud.wave.textContent = `Wave ${wave}`;
  const list = [];
  if (isBoss) { list.push("warden"); for (let i = 0; i < Math.floor(wave / 5); i++) list.push("husk"); }
  else {
    for (let i = 0; i < 2 + wave; i++) list.push("husk");
    for (let i = 0; i < Math.floor(wave / 2); i++) list.push("brute");
    for (let i = 0; i < Math.floor((wave - 1) / 2); i++) list.push("caster");
  }
  pendingSpawns = list.length;
  const run = runId;
  list.forEach((type, i) => setTimeout(() => {
    if (run !== runId) return; // a restart happened meanwhile
    pendingSpawns--;
    spawn(type);
  }, 700 + i * 380));
  waveTimer = -1;
}

// ============================================================ camera
function updateCamera(dt) {
  if (lock && !lock.dead) cam.yaw += angDiff(cam.yaw, yawTo(lock.pos, player.pos)) * Math.min(1, 6 * dt);
  const pitch = lock && !lock.dead ? 0.35 : cam.pitch;
  const off = _off.set(Math.sin(cam.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(cam.yaw) * Math.cos(pitch)).multiplyScalar(cam.dist);
  const look = _look.copy(player.pos).setY(1.5);
  if (lock && !lock.dead) look.lerp(_dir.copy(lock.pos).setY(1.2), 0.3);
  camera.position.lerp(off.add(look), 1 - Math.exp(-14 * dt));
  if (shake > 0) camera.position.add(_v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(shake * 0.35));
  shake = Math.max(0, shake - dt * 2.2);
  camera.lookAt(look);
}

// ============================================================ loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += real;
  let dt = real;
  if (hitstop > 0) { hitstop -= real; dt = 0; }

  for (const f of flames) { f.fire.scale.setScalar(3 + Math.sin(time * 13 + f.seed) * 0.3 + Math.sin(time * 7.3 + f.seed * 2) * 0.2); f.light.intensity = 22 + Math.sin(time * 11 + f.seed) * 5; }
  for (const r of rocks) { r.rotation.y += r.userData.s * real; r.position.y += Math.sin(time * 0.5 + r.userData.p) * 0.004; }

  if (game === "play" || game === "dying") {
    updatePlayer(dt);
    for (const e of enemies) updateEnemy(e, dt);
    enemies = enemies.filter((e) => !e.gone);
    updateOrbs(dt);
    multT -= dt;
    if (multT <= 0) mult = 1;
    if (game === "play" && waveTimer < 0 && !boonDue && pendingSpawns === 0 && enemies.every((e) => e.dead)) {
      boonDue = 1.6; // wave cleared: refill a flask, bank a bonus, then pick a boon
      player.flasks = Math.min(player.maxFlasks, player.flasks + 1);
      score += 250 * wave;
      banner("Wave cleared");
    }
    if (boonDue > 0) { boonDue -= dt; if (boonDue <= 0) { boonDue = 0; if (game === "play") TEST ? (waveTimer = 1) : offerBoons(); } }
    if (waveTimer > 0) { waveTimer -= dt; if (waveTimer <= 0) nextWave(); }
    updateCamera(real);
    drawHud();
  } else if (game === "boon" || game === "paused") {
    updateCamera(real); // hold the scene still behind the menu
  } else {
    // title / paused / dead: slow orbit
    cam.yaw += real * 0.12;
    camera.position.lerp(_off.set(Math.sin(cam.yaw) * 22, 9, Math.cos(cam.yaw) * 22), 1 - Math.exp(-3 * real));
    camera.lookAt(0, 1, 0);
    player.mesh.position.copy(player.pos);
  }
  updateParticles(real);
  updateEmbers(real);
  // sky reddens for the boss; runes flare when the Warden slams
  skyCol.lerp(bossWave.on ? bossSky : calmSky, 1 - Math.exp(-1.5 * real));
  scene.background.copy(skyCol);
  scene.fog.color.copy(skyCol);
  runeFlash = Math.max(0, runeFlash - real * 1.5);
  runeRing.material.opacity = 0.35 + runeFlash * 0.65;
  runeRing.material.color.lerpColors(PURPLE_C, EMBER_C, Math.max(runeFlash, bossWave.on ? 0.5 : 0));
  embers.material.size = bossWave.on ? 0.5 : 0.35;
  governBloom(real);
  if (useBloom) composer.render(); else renderer.render(scene, camera);
}
let pendingSpawns = 0; // spawns scheduled for this wave but not in the arena yet
let boonDue = 0, runeFlash = 0;
const bossWave = { on: false };
const PURPLE_C = new THREE.Color(C.purple), EMBER_C = new THREE.Color(C.ember);

// drop bloom if the frame rate sags for a few seconds (it's the most expensive effect)
let gFrames = 0, gTime = 0;
function governBloom(real) {
  if (!useBloom || game !== "play") { gFrames = gTime = 0; return; }
  gFrames++; gTime += real;
  if (gTime < 4) return;
  if (gFrames / gTime < 40) { useBloom = false; console.info("Ember Arena: bloom off to keep the frame rate up"); }
  gFrames = gTime = 0;
}

// ============================================================ game flow
let runId = 0;
function reset() {
  runId++;
  pendingSpawns = 0;
  for (const e of enemies) { scene.remove(e.mesh); for (const k in e.teles ?? {}) scene.remove(e.teles[k]); }
  for (const o of orbs) scene.remove(o.g);
  enemies = []; orbs = []; lock = null;
  Object.assign(player, { hp: 100, maxHp: 100, st: 100, flasks: 3, maxFlasks: 3, state: "free", t: 0, buffer: null, combo: 0, facing: Math.PI });
  player.buffs = { dmg: 1, rollCost: 1, taken: 1, regen: 1, speed: 1, lifesteal: 0, emberBlade: false, riposte: 3 };
  taken.clear();
  player.pos.set(0, 0, 6); player.vel.set(0, 0, 0);
  wave = 0; score = 0; mult = 1; kills = 0; waveTimer = 1.2; boonDue = 0; bossWave.on = false;
  hud.flaskCount = -1;
  $("#boons").hidden = true;
  cam.yaw = 0; cam.pitch = 0.42;
}
function play() {
  $("#title").hidden = $("#paused").hidden = $("#dead").hidden = true;
  $("#hud").hidden = false;
  game = "play";
  last = performance.now();
  if (!TEST) canvas.requestPointerLock?.();
}
function start() { unlockAudio(); reset(); play(); }
function pause() {
  if (game !== "play") return;
  game = "paused";
  $("#paused").hidden = false;
  if (document.pointerLockElement) document.exitPointerLock();
}
function die() {
  game = "dead";
  if (document.pointerLockElement) document.exitPointerLock();
  const isBest = score > best;
  if (isBest) { best = score; localStorage.setItem("ember.best", String(best)); }
  $("#stats").innerHTML = `Reached wave ${wave} · ${kills} kills<br>Score ${score.toLocaleString()}${isBest ? " · <b style='color:var(--gold)'>New best!</b>" : ` · Best ${best.toLocaleString()}`}`;
  $("#dead").hidden = false;
  $("#hud").hidden = true;
}
$("#start").addEventListener("click", start);
$("#retry").addEventListener("click", start);
$("#resume").addEventListener("click", play);
$("#best").textContent = best ? `Best score: ${best.toLocaleString()}` : "";

reset();
player.pos.set(0, 0, 0);
requestAnimationFrame(frame);
if (TEST) window.__g = { get player() { return player; }, get enemies() { return enemies; }, get wave() { return wave; }, get score() { return score; }, start, queue, keys, toggleLock, spawn, get game() { return game; }, offerBoons, pickBoon, nextWave, get orbs() { return orbs; }, get useBloom() { return useBloom; } };
