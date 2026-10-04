import * as THREE from 'three';

/** Draw calls: one per visible mesh, instanced mesh or point cloud. */
export function critterDrawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) n++;
  });
  return n;
}

/**
 * Where each body of a wings-only InstancedMesh is (instance 2i is body i's first wing and sits at the
 * body's position). `name` is 'butterfly-wings' or 'bird-wings'. Empty when the zone has none.
 */
export function wingBodies(zoneRoot: THREE.Object3D, name: 'butterfly-wings' | 'bird-wings'): THREE.Vector3[] {
  const mesh = zoneRoot.getObjectByName(name) as THREE.InstancedMesh | undefined;
  if (!mesh) return [];
  const m = new THREE.Matrix4();
  return Array.from({ length: mesh.count / 2 }, (_, i) => {
    mesh.getMatrixAt(2 * i, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  });
}

/** Where each firefly is right now. */
export function fireflyPositions(zoneRoot: THREE.Object3D): THREE.Vector3[] {
  const points = zoneRoot.getObjectByName('fireflies-points') as THREE.Points | undefined;
  if (!points) return [];
  const position = points.geometry.getAttribute('position');
  return Array.from({ length: position.count }, (_, i) => new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)));
}

/** Step a zone `steps` times at 60 Hz, calling `each` after every `every`th step. */
export function runZone(zone: { update(dt: number): void }, steps: number, each?: () => void, every = 30): void {
  for (let i = 1; i <= steps; i++) {
    zone.update(1 / 60);
    if (each && i % every === 0) each();
  }
}
