import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Color, GameJSON, Move, PieceType, Pos, Trap } from '@four-chess/engine';
import { DUEL_OFFSET, FILES, FourChess, inBoardForMode, SIZE } from '@four-chess/engine';
import { COLOR_HEX } from '../config';

const TILE_LIGHT = 0xf0f0ed;
const TILE_DARK = 0x27272a;
const TILE_SELECTED = 0x5eead4;
const TILE_LAST = 0xd8c96b;
const TILE_CHECK = 0xb91c1c;

// board (x,y) -> world xz; red's side (y=0) faces +Z
function tileWorld(x: number, y: number): [number, number] {
  return [x - (SIZE - 1) / 2, (SIZE - 1) / 2 - y];
}

// camera starts behind the viewer's own side
function cameraHome(view: Color, duel: boolean): THREE.Vector3 {
  const d = duel ? 9.5 : 15.5;
  const h = duel ? 8 : 11;
  switch (view) {
    case 'red':
      return new THREE.Vector3(0, h, d);
    case 'yellow':
      return new THREE.Vector3(0, h, -d);
    case 'blue':
      return new THREE.Vector3(-d, h, 0);
    case 'green':
      return new THREE.Vector3(d, h, 0);
  }
}

// Staunton-ish pieces as lathe profiles (no model files). Each profile is a
// list of [radius, height] pairs; a repeated point pins a crisp edge when the
// profile gets spline-smoothed. The rook stays a raw polyline so its parapet
// steps don't get rounded off. The knight head is an extruded silhouette.
type Profile = [number, number][];

const PROFILES: Record<Exclude<PieceType, 'N'>, Profile> = {
  P: [
    [0, 0], [0.30, 0], [0.30, 0], [0.31, 0.04], [0.24, 0.10], [0.24, 0.10], [0.15, 0.15],
    [0.11, 0.28], [0.10, 0.36], [0.17, 0.40], [0.17, 0.40], [0.10, 0.45], [0.10, 0.45],
    [0.14, 0.49], [0.175, 0.56], [0.17, 0.63], [0.12, 0.70], [0.05, 0.75], [0, 0.77],
  ],
  R: [
    [0, 0], [0.32, 0], [0.33, 0.05], [0.25, 0.12], [0.17, 0.20], [0.145, 0.36],
    [0.14, 0.52], [0.21, 0.58], [0.23, 0.62], [0.23, 0.76], [0.16, 0.76],
    [0.16, 0.68], [0, 0.68],
  ],
  B: [
    [0, 0], [0.31, 0], [0.31, 0], [0.32, 0.04], [0.24, 0.11], [0.24, 0.11], [0.15, 0.19],
    [0.11, 0.40], [0.10, 0.55], [0.18, 0.60], [0.18, 0.60], [0.10, 0.65], [0.10, 0.65],
    [0.155, 0.71], [0.165, 0.80], [0.12, 0.90], [0.055, 0.97], [0.085, 1.00],
    [0.05, 1.045], [0, 1.07],
  ],
  Q: [
    [0, 0], [0.34, 0], [0.34, 0], [0.35, 0.05], [0.27, 0.12], [0.27, 0.12], [0.17, 0.22],
    [0.125, 0.44], [0.11, 0.62], [0.19, 0.68], [0.19, 0.68], [0.12, 0.73], [0.12, 0.73],
    [0.16, 0.79], [0.20, 0.90], [0.155, 1.00], [0.10, 1.05], [0.165, 1.09], [0.165, 1.09],
    [0.12, 1.14], [0.065, 1.17], [0.085, 1.21], [0, 1.25],
  ],
  K: [
    [0, 0], [0.34, 0], [0.34, 0], [0.35, 0.05], [0.27, 0.12], [0.27, 0.12], [0.18, 0.22],
    [0.135, 0.48], [0.12, 0.68], [0.20, 0.74], [0.20, 0.74], [0.13, 0.79], [0.13, 0.79],
    [0.17, 0.85], [0.205, 0.96], [0.15, 1.06], [0.09, 1.11], [0.15, 1.145], [0.15, 1.145],
    [0.10, 1.19], [0, 1.21],
  ],
};

function latheGeometry(profile: Profile, smooth: boolean): THREE.LatheGeometry {
  if (!smooth) {
    return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 48);
  }
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(72).map((p) => new THREE.Vector2(Math.max(p.x, 0), p.y));
  return new THREE.LatheGeometry(pts, 48);
}

function knightHeadShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.10, 0);
  s.quadraticCurveTo(-0.18, 0.14, -0.16, 0.30); // back of the neck
  s.lineTo(-0.09, 0.35); // mane notch
  s.quadraticCurveTo(-0.08, 0.42, -0.045, 0.47); // up to the ear
  s.lineTo(-0.005, 0.56); // ear tip
  s.lineTo(0.035, 0.46); // front of the ear
  s.quadraticCurveTo(0.10, 0.43, 0.15, 0.37); // forehead
  s.quadraticCurveTo(0.24, 0.30, 0.27, 0.24); // nose bridge
  s.lineTo(0.26, 0.19); // muzzle
  s.quadraticCurveTo(0.18, 0.17, 0.15, 0.14); // mouth
  s.quadraticCurveTo(0.12, 0.08, 0.11, 0); // jaw down to the chest
  s.closePath();
  return s;
}

// knights face their owner's direction of play
const PIECE_YAW: Record<string, number> = {
  red: Math.PI / 2,
  blue: 0,
  yellow: -Math.PI / 2,
  green: Math.PI,
};

function buildPiece(type: PieceType, hex: string, dead: boolean, yaw: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({
    color: dead ? 0x6b7280 : new THREE.Color(hex),
    roughness: 0.32,
    metalness: 0.05,
    clearcoat: 0.5,
    clearcoatRoughness: 0.35,
    transparent: dead,
    opacity: dead ? 0.55 : 1,
  });
  const add = (geo: THREE.BufferGeometry, y = 0, rx = 0, rzOrYaw = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.rotation.x = rx;
    m.rotation.y = rzOrYaw;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  if (type === 'N') {
    add(
      latheGeometry(
        [[0, 0], [0.32, 0], [0.33, 0.05], [0.25, 0.12], [0.17, 0.20], [0.15, 0.30], [0.19, 0.35], [0, 0.37]],
        false,
      ),
    );
    const headGeo = new THREE.ExtrudeGeometry(knightHeadShape(), {
      depth: 0.14,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.025,
      bevelSegments: 2,
    });
    headGeo.translate(0, 0, -0.07 - 0.025);
    const head = new THREE.Mesh(headGeo, mat);
    head.position.y = 0.36;
    head.rotation.y = yaw;
    head.castShadow = true;
    head.receiveShadow = true;
    g.add(head);
    return g;
  }

  add(latheGeometry(PROFILES[type], type !== 'R'));

  if (type === 'R') {
    // rook battlements
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const merlon = add(new THREE.BoxGeometry(0.09, 0.09, 0.1), 0.80);
      merlon.position.x = Math.cos(a) * 0.185;
      merlon.position.z = Math.sin(a) * 0.185;
      merlon.rotation.y = -a;
    }
  }
  if (type === 'Q') {
    // crown pearls
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const pearl = add(new THREE.SphereGeometry(0.035, 10, 8), 1.055);
      pearl.position.x = Math.cos(a) * 0.13;
      pearl.position.z = Math.sin(a) * 0.13;
    }
  }
  if (type === 'K') {
    add(new THREE.BoxGeometry(0.055, 0.24, 0.055), 1.31);
    add(new THREE.BoxGeometry(0.17, 0.055, 0.055), 1.34);
  }
  return g;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    }
  });
}

// canvas-textured label lying flat on the plinth
function coordLabel(text: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#94a3b8';
  g.font = 'bold 38px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 32, 36);
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  tiles: Map<string, THREE.Mesh>;
  pieces: THREE.Group;
  markers: THREE.Group;
  raycaster: THREE.Raycaster;
}

export function Board3D({
  state,
  myColor,
  onMove,
  locked = false,
  myTraps = [],
  onSquarePick,
}: {
  state: GameJSON;
  myColor: Color | null;
  onMove: (move: Move) => void;
  locked?: boolean;
  myTraps?: Trap[];
  onSquarePick?: (pos: Pos) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const [selected, setSelected] = useState<Pos | null>(null);
  const view: Color = myColor ?? 'red';

  const engine = useMemo(() => FourChess.fromJSON(state), [state]);
  const myTurn = !locked && myColor !== null && state.turn === myColor && !state.winners;

  const legalTargets = useMemo(() => {
    if (!selected || !myColor) return [];
    return engine.legalMovesFrom(myColor, selected);
  }, [engine, selected, myColor]);

  // Refs so the (once-attached) click handler always sees current values.
  const liveRef = useRef({ state, myColor, myTurn, selected, legalTargets, onMove, onSquarePick });
  liveRef.current = { state, myColor, myTurn, selected, legalTargets, onMove, onSquarePick };

  // --- one-time scene setup ---
  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);

    // generated room environment -> real reflections without texture assets
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.38; // full strength washes the colors out

    const duel = state.mode === 'duel'; // the mode is fixed for a game's lifetime
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.copy(cameraHome(view, duel));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 6;
    controls.maxDistance = 34;

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const sun = new THREE.DirectionalLight(0xffffff, 1.45);
    sun.position.set(7, 16, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = 12;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 45;
    sun.shadow.camera.updateProjectionMatrix(); // required after changing the frustum
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    // Plinth under the board
    const plinthSize = duel ? 9.2 : SIZE + 1.2;
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(plinthSize, 0.5, plinthSize),
      new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.9 }),
    );
    plinth.position.y = -0.33;
    plinth.receiveShadow = true;
    scene.add(plinth);

    // Tiles
    const tiles = new Map<string, THREE.Mesh>();
    const tileGeo = new THREE.BoxGeometry(0.98, 0.16, 0.98);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (!inBoardForMode(state.mode, x, y)) continue;
        const base = (x + y) % 2 === 0 ? TILE_LIGHT : TILE_DARK;
        const tile = new THREE.Mesh(
          tileGeo,
          new THREE.MeshStandardMaterial({ color: base, roughness: 0.75 }),
        );
        const [wx, wz] = tileWorld(x, y);
        tile.position.set(wx, 0, wz);
        tile.receiveShadow = true;
        tile.userData = { x, y, base };
        tiles.set(`${x},${y}`, tile);
        scene.add(tile);
      }
    }

    // Coordinate labels printed on the plinth: file letters along the south
    // edge, rank numbers along the west edge (fixed, like a printed board).
    const coordOff = state.mode === 'duel' ? DUEL_OFFSET : 0;
    for (let x = 0; x < SIZE; x++) {
      let minY: number | null = null;
      for (let y = 0; y < SIZE; y++) if (inBoardForMode(state.mode, x, y)) { minY = y; break; }
      if (minY === null) continue;
      const label = coordLabel(FILES[x - coordOff]);
      const [wx, wz] = tileWorld(x, minY);
      label.position.set(wx, -0.07, wz + 0.82);
      scene.add(label);
    }
    for (let y = 0; y < SIZE; y++) {
      let minX: number | null = null;
      for (let x = 0; x < SIZE; x++) if (inBoardForMode(state.mode, x, y)) { minX = x; break; }
      if (minX === null) continue;
      const label = coordLabel(String(y + 1 - coordOff));
      const [wx, wz] = tileWorld(minX, y);
      label.position.set(wx - 0.82, -0.07, wz);
      scene.add(label);
    }

    const pieces = new THREE.Group();
    const markers = new THREE.Group();
    scene.add(pieces, markers);

    const raycaster = new THREE.Raycaster();
    ctxRef.current = { renderer, scene, camera, controls, tiles, pieces, markers, raycaster };

    const resize = () => {
      const w = mount.clientWidth || 600;
      const h = Math.min(Math.max(w * 0.82, 340), window.innerHeight - 140);
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    // Click-to-move (ignore drags so OrbitControls rotation doesn't select)
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects([...tiles.values(), pieces], true);
      let pos: Pos | null = null;
      for (const hit of hits) {
        let o: THREE.Object3D | null = hit.object;
        while (o && o.userData?.x === undefined) o = o.parent;
        if (o) {
          pos = { x: o.userData.x, y: o.userData.y };
          break;
        }
      }
      if (!pos) return;
      const live = liveRef.current;
      if (live.onSquarePick) {
        live.onSquarePick(pos);
        setSelected(null);
        return;
      }
      const piece = live.state.pieces.find((p) => p.x === pos!.x && p.y === pos!.y);
      const target = live.legalTargets.find((m) => m.to.x === pos!.x && m.to.y === pos!.y);
      if (target) {
        live.onMove(target);
        setSelected(null);
      } else if (piece && piece.color === live.myColor && !piece.dead && live.myTurn) {
        setSelected((cur) => (cur && cur.x === pos!.x && cur.y === pos!.y ? null : pos));
      } else {
        setSelected(null);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      scene.environment = null;
      envTex.dispose();
      pmrem.dispose();
      disposeObject(scene);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      ctxRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Point the camera at the player's own side when their seat is known.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.camera.position.copy(cameraHome(view, state.mode === 'duel'));
    ctx.controls.target.set(0, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // --- per-state rendering: pieces, tile highlights, move markers ---
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    // Pieces
    for (const child of [...ctx.pieces.children]) {
      ctx.pieces.remove(child);
      disposeObject(child);
    }
    for (const p of state.pieces) {
      const grp = buildPiece(p.type, COLOR_HEX[p.color], p.dead, PIECE_YAW[p.color] ?? 0);
      const [wx, wz] = tileWorld(p.x, p.y);
      grp.position.set(wx, 0.08, wz);
      grp.userData = { x: p.x, y: p.y };
      // Powers: ice ring under frozen pieces (shields are drawn on the tile below).
      const frozen = (p.frozenUntil ?? 0) > state.ply;
      if (frozen) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.42, 0.05, 10, 32),
          new THREE.MeshStandardMaterial({ color: 0x7dd3fc, emissive: 0x7dd3fc, emissiveIntensity: 0.5 }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.02;
        grp.add(ring);
      }
      ctx.pieces.add(grp);
    }

    // Shields (public) as a ring on the tile in the owner's colour, empty or not.
    for (const s of state.shields ?? []) {
      if (s.until <= state.ply) continue;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.05, 10, 32),
        new THREE.MeshStandardMaterial({ color: COLOR_HEX[s.color], emissive: COLOR_HEX[s.color], emissiveIntensity: 0.5 }),
      );
      ring.rotation.x = Math.PI / 2;
      const [wx, wz] = tileWorld(s.x, s.y);
      ring.position.set(wx, 0.1, wz);
      ring.userData = { x: s.x, y: s.y };
      ctx.pieces.add(ring);
    }

    // Walls and (only your own) secret traps.
    for (const w of state.walls ?? []) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.7, 0.85),
        new THREE.MeshStandardMaterial({ color: 0x57534e, roughness: 0.95 }),
      );
      const [wx, wz] = tileWorld(w.x, w.y);
      box.position.set(wx, 0.43, wz);
      box.castShadow = true;
      box.userData = { x: w.x, y: w.y };
      ctx.pieces.add(box);
    }
    for (const t of myTraps) {
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, 0.03, 24),
        new THREE.MeshStandardMaterial({
          color: t.type === 'faint' ? 0x38bdf8 : t.type === 'teleport' ? 0xa78bfa : 0xf87171,
          transparent: true,
          opacity: 0.4,
        }),
      );
      const [wx, wz] = tileWorld(t.x, t.y);
      disc.position.set(wx, 0.1, wz);
      disc.userData = { x: t.x, y: t.y };
      ctx.pieces.add(disc);
    }

    // Tile highlights
    const last = state.lastMove;
    const checkedKings = new Set(
      state.pieces
        .filter((p) => p.type === 'K' && !p.dead && state.inCheck.includes(p.color))
        .map((p) => `${p.x},${p.y}`),
    );
    for (const tile of ctx.tiles.values()) {
      const { x, y, base } = tile.userData as { x: number; y: number; base: number };
      const key = `${x},${y}`;
      let color = base;
      if (last && ((last.from.x === x && last.from.y === y) || (last.to.x === x && last.to.y === y))) {
        color = TILE_LAST;
      }
      if (selected && selected.x === x && selected.y === y) color = TILE_SELECTED;
      if (checkedKings.has(key)) color = TILE_CHECK;
      (tile.material as THREE.MeshStandardMaterial).color.setHex(color);
    }

    // Legal-move markers
    for (const child of [...ctx.markers.children]) {
      ctx.markers.remove(child);
      disposeObject(child);
    }
    const dotGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 20);
    const ringGeo = new THREE.TorusGeometry(0.4, 0.05, 10, 32);
    for (const m of legalTargets) {
      const isCapture = state.pieces.some((p) => p.x === m.to.x && p.y === m.to.y);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x14b8a6,
        emissive: 0x14b8a6,
        emissiveIntensity: 0.45,
      });
      const marker = new THREE.Mesh(isCapture ? ringGeo : dotGeo, mat);
      const [wx, wz] = tileWorld(m.to.x, m.to.y);
      marker.position.set(wx, isCapture ? 0.14 : 0.12, wz);
      if (isCapture) marker.rotation.x = Math.PI / 2;
      ctx.markers.add(marker);
    }
  }, [state, selected, legalTargets, myTraps]);

  // Clear selection when the turn moves on or the board locks.
  useEffect(() => {
    if (!myTurn) setSelected(null);
  }, [myTurn]);

  return <div className="board3d" ref={mountRef} />;
}
