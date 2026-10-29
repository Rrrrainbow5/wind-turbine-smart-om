import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { bindCadPartNames, makeRealGearboxBearingGroup, setFaultPartState } from '../src/WindScene'
import { effectiveCadCategory } from '../src/cadMapping'

export function runChecks() {
  const bytes = readFileSync('public/assets/wind-turbine-engineering.glb')
  const cad = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString())
  const root = new THREE.Group()
  const geometry = new THREE.BoxGeometry()
  const nodes: THREE.Object3D[] = cad.nodes.map((node: { mesh?: number; name?: string }) => {
    const object = node.mesh === undefined ? new THREE.Group() : new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
    object.name = node.name || ''
    return object
  })
  cad.nodes.forEach((node: { children?: number[] }, index: number) => node.children?.forEach(child => nodes[index].add(nodes[child])))
  nodes.filter(node => !node.parent).forEach(node => root.add(node))
  bindCadPartNames(root, 'WT02')
  root.add(makeRealGearboxBearingGroup(root, 'WT02'))
  const fastener = /bolt|screw|washer|fastener|navrt|podlo|civij|(?:^|[\s_])(?:[šs]?raf|klin)\b/i
  const source = (object: THREE.Object3D) => String(object.userData.sourceCadName || '')
  const counts: Record<string, number> = {}
  for (const category of ['GEARBOX', 'GEARBOX_BEARING', 'HYDRAULIC'] as const) {
    setFaultPartState(root, category, 'HIGH')
    const overlay = root.getObjectByName('FAULT_HIGHLIGHT_OVERLAY')!
    assert.ok(overlay?.children.length, `${category} must have real CAD targets`)
    assert.ok(overlay.children.every(node => !fastener.test(source(node))), `${category} must exclude all bolts, nuts, pins and washers`)
    assert.ok(overlay.children.every(node => effectiveCadCategory(node, root) === category))
    if (category === 'HYDRAULIC') {
      assert.ok(overlay.children.some(node => source(node) === 'rezervoar.STEP'), 'Hydraulic tank must be highlighted')
      assert.ok(overlay.children.some(node => source(node).startsWith('crevo od T spoja')), 'Hydraulic hose must be highlighted')
    } else {
      assert.ok(overlay.children.every(node => !/pump|pumpe|kocnic|rezervoar/i.test(source(node))), 'Hydraulic pump gears must not become gearbox faults')
    }
    counts[category] = overlay.children.length
  }
  setFaultPartState(root, undefined, 'NORMAL')
  assert.equal(root.getObjectByName('FAULT_HIGHLIGHT_OVERLAY'), undefined)
  assert.equal(root.userData.faultHighlightCount, 0)
  // A named assembly may contain generic, unnamed mesh children.
  const bolt = new THREE.Group()
  bolt.name = '_raf za spur gear_ISO 4014'
  const child = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
  bolt.add(child)
  root.add(bolt)
  bindCadPartNames(bolt, 'WT02')
  assert.equal(effectiveCadCategory(child, root), '')
  console.log('Actual CAD mapping checks passed:', counts)
}
