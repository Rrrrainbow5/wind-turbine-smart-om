import type * as THREE from 'three'

// Source CAD names use Serbian transliterations and sanitized leading letters.
export function isCadFastenerName(name: string) {
  return /bolt|screw|washer|fastener|navrt|podlo|civij|(?:^|[\s_])(?:sraf|[šs]?raf)\b|(?:^|[\s_])klin\b/i.test(name)
}

export function isCadFastener(object: THREE.Object3D, root: THREE.Object3D) {
  let current: THREE.Object3D | null = object
  while (current && current !== root) {
    if (isCadFastenerName(String(current.userData.sourceCadName || current.name))) return true
    current = current.parent
  }
  return false
}

export function isHydraulicAssemblyName(name: string) {
  return /hidraulicna kocnica|cela zupcasta pumpa|hydraulic (?:brake|power|pump)/i.test(name)
}

export function effectiveCadCategory(object: THREE.Object3D, root: THREE.Object3D): string {
  if (object === root || isCadFastener(object, root)) return ''
  let category = ''
  let current: THREE.Object3D | null = object
  while (current && current !== root) {
    // Pump gears and motor internals belong to the hydraulic assembly.
    if (isHydraulicAssemblyName(String(current.userData.sourceCadName || current.name))) return 'HYDRAULIC'
    category ||= String(current.userData.componentCategory || '')
    current = current.parent
  }
  return category
}
