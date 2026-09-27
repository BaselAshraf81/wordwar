// Renders artist-rigged glTF models side-on, each bone posed from its physics body every frame.
// A transparent WebGL canvas sits over the 2D canvas and shares its camera mapping.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import type { Battle, Unit } from "./sim/battle";

interface Template {
  scene: THREE.Object3D;
  rest: Map<string, THREE.Matrix4>; // bone name (Blender) -> rest world matrix, ground at y=0
}

interface Instance {
  unit: Unit;
  root: THREE.Object3D;
  bones: { bone: THREE.Bone; body: string; rest: THREE.Matrix4 }[];
  mats: THREE.MeshStandardMaterial[];
  base: THREE.Color[];
  dead: boolean;
}

const loader = new GLTFLoader();
const templates = new Map<string, Promise<Template>>();
// GLTFLoader strips "." from node names.
const key = (blenderName: string) => blenderName.replace(/[[\].:/]/g, "");

function template(url: string, ground: number): Promise<Template> {
  let t = templates.get(url);
  if (!t) {
    t = loader.loadAsync(url).then((g) => {
      g.scene.updateMatrixWorld(true);
      const rest = new Map<string, THREE.Matrix4>();
      const lift = new THREE.Matrix4().makeTranslation(0, -ground, 0);
      g.scene.traverse((o) => {
        if ((o as THREE.Bone).isBone) rest.set(o.name, lift.clone().multiply(o.matrixWorld));
      });
      return { scene: g.scene, rest };
    });
    templates.set(url, t);
  }
  return t;
}

export class ModelView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  private items: Instance[] = [];
  private battle: Battle | null = null;
  private tmp = new THREE.Matrix4();
  private tmp2 = new THREE.Matrix4();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6b8f41, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-2, 5, 6);
    this.scene.add(sun);
  }

  resize(w: number, h: number): void {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
  }

  /** True once a unit's model has loaded and is drawn here (the 2D renderer then hides it). */
  shows(u: Unit): boolean {
    return this.items.some((i) => i.unit === u);
  }

  attach(b: Battle): void {
    for (const i of this.items) this.scene.remove(i.root);
    this.items = [];
    this.battle = b;
    for (const u of b.units) {
      const lay = u.bp.model;
      if (!lay) continue;
      template(lay.model.url, lay.model.groundY).then((tpl) => {
        if (this.battle !== b) return;
        const root = SkeletonUtils.clone(tpl.scene);
        const mats: THREE.MeshStandardMaterial[] = [];
        const bones: Instance["bones"] = [];
        const byKey = new Map(Object.entries(lay.model.boneGroup).map(([bn, g]) => [key(bn), g]));
        root.traverse((o) => {
          const mesh = o as THREE.SkinnedMesh;
          if (mesh.isSkinnedMesh || (o as THREE.Mesh).isMesh) {
            const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const cl = list.map((m) => {
              const c = (m as THREE.MeshStandardMaterial).clone();
              c.side = THREE.DoubleSide; // mirrored units have flipped winding
              mats.push(c);
              return c;
            });
            mesh.material = Array.isArray(mesh.material) ? cl : cl[0];
            mesh.frustumCulled = false;
          }
          const bone = o as THREE.Bone;
          if (bone.isBone) {
            const group = byKey.get(bone.name);
            const rest = tpl.rest.get(bone.name);
            if (group && rest) {
              bone.matrixAutoUpdate = false;
              bone.matrixWorldAutoUpdate = false;
              bones.push({ bone, body: group, rest });
            }
          }
        });
        this.scene.add(root);
        this.items.push({ unit: u, root, bones, mats, base: mats.map((m) => m.color.clone()), dead: false });
      });
    }
  }

  private cleared = false;

  render(camX: number, scale: number, groundY: number, w: number, h: number): void {
    if (!this.items.length) {
      // Nothing 3D in this fight: clear once, then leave the GPU alone.
      if (!this.cleared) this.renderer.clear();
      this.cleared = true;
      return;
    }
    this.cleared = false;
    const cam = this.camera;
    cam.left = camX - w / 2 / scale;
    cam.right = camX + w / 2 / scale;
    cam.top = groundY / scale;
    cam.bottom = -(h - groundY) / scale;
    cam.updateProjectionMatrix();
    for (const it of this.items) {
      const u = it.unit;
      const lay = u.bp.model!;
      const S = new THREE.Matrix4().makeScale(lay.scale * lay.flip, lay.scale, lay.scale);
      for (const { bone, body, rest } of it.bones) {
        const rb = u.bodies.get(body);
        if (!rb) continue;
        const p = rb.translation();
        const c = lay.centre[body];
        this.tmp.makeRotationZ(rb.rotation()).setPosition(p.x, p.y, 0);
        this.tmp2.makeTranslation(-c[0], -c[1], 0);
        bone.matrixWorld.copy(this.tmp).multiply(this.tmp2).multiply(S).multiply(rest);
      }
      if (!u.alive && !it.dead) {
        it.dead = true;
        it.mats.forEach((m, i) => m.color.copy(it.base[i]).lerp(new THREE.Color(0x77767d), 0.55));
      }
    }
    // Skinning reads bone.matrixWorld directly; don't let the scene overwrite it.
    this.renderer.render(this.scene, cam);
  }
}
