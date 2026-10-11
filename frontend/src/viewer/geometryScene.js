import { Scene, PerspectiveCamera, WebGLRenderer, Color, HemisphereLight, DirectionalLight, Box3, Vector3, Raycaster, Vector2, Mesh, BoxHelper } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { verifyGeometryMapping } from "./geometryCatalog";

export async function parseGeometry(bytes, catalog) {
  // External resources are forbidden: protected application assets must be self-contained GLBs.
  const header = new DataView(bytes);
  if (header.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== bytes.byteLength) throw new Error("Invalid GLB container.");
  const length = header.getUint32(12, true);
  if (header.getUint32(16, true) !== 0x4e4f534a || length + 20 > bytes.byteLength) throw new Error("GLB JSON chunk unavailable.");
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
  if ([...(json.buffers ?? []), ...(json.images ?? [])].some(resource => resource.uri)) throw new Error("External GLB resources are unsupported.");
  const gltf = await new GLTFLoader().parseAsync(bytes, "");
  // Resolve original GLB names by loader associations, never by fuzzy name matching.
  gltf.scene.traverse(node => {
    const index = gltf.parser.associations.get(node)?.nodes;
    if (index !== undefined && json.nodes[index]?.name) node.name = json.nodes[index].name;
  });
  try { return { scene: gltf.scene, mapping: verifyGeometryMapping(gltf.scene, catalog) }; }
  catch (error) { disposeGeometry(gltf.scene); throw error; }
}
export function disposeGeometry(scene) {
  scene.traverse(node => {
    if (!(node instanceof Mesh)) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}
/** @param {(camera: {position: number[], target: number[]}) => void} onCameraChange */
export function mountGeometry(host, model, markers, onPick, onLayout, savedCamera, onCameraChange = () => {}) {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-label", "Rotatable vehicle model");
  const scene = new Scene(); scene.background = new Color("#edf0f2"); scene.add(model.scene);
  scene.add(new HemisphereLight(0xffffff, 0x485060, 3));
  const light = new DirectionalLight(0xffffff, 3); light.position.set(3, 5, 4); scene.add(light);
  const camera = new PerspectiveCamera(45, 1, .01, 10000);
  const controls = new OrbitControls(camera, renderer.domElement);
  const bounds = new Box3().setFromObject(model.scene), center = bounds.getCenter(new Vector3()), size = bounds.getSize(new Vector3()).length();
  const frame = () => { controls.target.copy(center); camera.position.copy(center).add(new Vector3(size, size * .6, size)); controls.update(); };
  if (savedCamera) { camera.position.fromArray(savedCamera.position); controls.target.fromArray(savedCamera.target); controls.update(); } else frame();
  let selected;
  let inspectParts = false;
  const ray = new Raycaster();
  let visibleMarkers = markers;
  function paint() {
    renderer.render(scene, camera);
    model.scene.updateMatrixWorld(true);
    const rect = host.getBoundingClientRect();
    const projected = visibleMarkers.flatMap(marker => {
      const part = model.mapping.get(marker.partId); if (!part) return [];
      const world = part.anchor.localToWorld(new Vector3(...part.local));
      const screen = world.clone().project(camera); if (screen.z < -1 || screen.z > 1) return [];
      ray.set(camera.position, world.clone().sub(camera.position).normalize());
      const hit = ray.intersectObject(model.scene, true).find(item => item.object.visible);
      const occluded = hit && hit.distance + size * .002 < camera.position.distanceTo(world) && !part.meshes.includes(hit.object);
      return occluded ? [] : [{ id: marker.id, x: (screen.x + 1) * rect.width / 2, y: (1 - screen.y) * rect.height / 2, width: Math.min(160, Math.max(88, marker.label.length * 7 + 30)), height: 40 }];
    });
    onLayout(projected, rect.width, rect.height);
  }
  function resize() { const rect = host.getBoundingClientRect(); renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height)); camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height); camera.updateProjectionMatrix(); paint(); }
  const observer = new ResizeObserver(resize); observer.observe(host);
  controls.addEventListener("change", paint);
  controls.addEventListener("end", () => onCameraChange({ position: camera.position.toArray(), target: controls.target.toArray() }));
  function pick(event) {
    const rect = host.getBoundingClientRect(); ray.setFromCamera(new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
    const hit = ray.intersectObject(model.scene, true).find(item => item.object.visible);
    if (hit) for (const [id, part] of model.mapping) if (part.meshes.includes(hit.object)) { onPick(id); break; }
  }
  let pointer; const down = event => { pointer = [event.clientX, event.clientY]; }; const up = event => { if (pointer && Math.hypot(event.clientX - pointer[0], event.clientY - pointer[1]) < 5) pick(event); pointer = null; };
  renderer.domElement.addEventListener("pointerdown", down); renderer.domElement.addEventListener("pointerup", up);
  resize();
  return {
    setMarkers(next) { visibleMarkers = next; paint(); },
    camera: () => ({ position: camera.position.toArray(), target: controls.target.toArray() }),
    inspect() { inspectParts = !inspectParts; const mapped = new Set([...model.mapping.values()].flatMap(part => part.meshes)); model.scene.traverse(node => { if (node.isMesh) node.visible = !inspectParts || mapped.has(node); }); paint(); return inspectParts; },
    action(action) { if (action === "frame") frame(); else if (action === "left" || action === "right") { const offset = camera.position.clone().sub(controls.target).applyAxisAngle(new Vector3(0, 1, 0), action === "left" ? .2 : -.2); camera.position.copy(controls.target).add(offset); } else camera.position.sub(controls.target).multiplyScalar(action === "in" ? .8 : 1.25).add(controls.target); controls.update(); paint(); },
    focus(id, moveCamera = true) { if (selected) { scene.remove(selected); selected.dispose(); selected = null; } const part = model.mapping.get(id); if (!part) { paint(); return; } if (moveCamera) { const offset = camera.position.clone().sub(controls.target); const partSize = new Box3().setFromObject(part.anchor).getSize(new Vector3()).length(); controls.target.copy(part.anchor.localToWorld(new Vector3(...part.local))); camera.position.copy(controls.target).add(offset.normalize().multiplyScalar(Math.max(partSize * 1.5, .2))); } selected = new BoxHelper(part.anchor, 0xb62e3c); scene.add(selected); controls.update(); paint(); if (moveCamera) onCameraChange({ position: camera.position.toArray(), target: controls.target.toArray() }); },
    dispose() { observer.disconnect(); controls.dispose(); selected?.dispose(); renderer.dispose(); renderer.domElement.remove(); }
  };
}
