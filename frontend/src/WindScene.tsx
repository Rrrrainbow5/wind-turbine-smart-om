import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Turbine } from './data'

interface Props {
  turbines: Turbine[]
  selectedId: string
  onSelect: (id: string) => void
  serviced: boolean
  engineeringView: boolean
  onOpenEngineering: () => void
}

const colors = { NORMAL: 0x75a79b, LOW: 0xe4af55, MEDIUM: 0xd47d43, HIGH: 0xd9584e }

type TurbineSceneObject = {
  beacon: THREE.Mesh
  ring: THREE.Mesh
  blades: THREE.Object3D
  root: THREE.Group
  exterior: THREE.Group
  nacelle: THREE.Object3D
  engineering: THREE.Group
  gearboxBearing: THREE.Object3D
  cadModel: THREE.Object3D | null
  cadLabels: THREE.Group | null
}

const engineeringModelUrl = '/assets/wind-turbine-engineering.glb'
// Turbines follow two connected ridgelines, similar to an aerial mountain
// wind-farm layout. They deliberately avoid a regular grid.
const ridgeLayout: Record<string, [number, number]> = {
  WT01: [-25, -12], WT02: [-9, -8], WT03: [9, -12], WT04: [27, -7],
  WT05: [-18, 14], WT06: [0, 17], WT07: [20, 13], WT08: [6, 38],
}

function terrainHeight(_x: number, _z: number) {
  return 0
}

type CadPart = { id: string; label: string; category: string }

function identifyCadPart(sourceName: string, turbineId: string): CadPart | null {
  const name = sourceName.toLowerCase()
  if (/^wt02_blade_\d+/.test(name)) return { id: `${turbineId}_ROTOR_BLADE`, label: '风轮叶片', category: 'ROTOR' }
  if (name === 'generator-1' || name.includes('kuci歵e generatora') || name.includes('rotor generatora') || name.includes('stator')) return { id: `${turbineId}_GENERATOR`, label: '发电机总成', category: 'GENERATOR' }
  if (name.startsWith('radial ball bearing') || name.startsWith('taper roller bearing')) return { id: `${turbineId}_BEARING`, label: '滚动轴承', category: 'BEARING' }
  if ((name.includes('kuci') && name.includes('le瀉j')) || name.includes('bearing housing')) return { id: `${turbineId}_GEARBOX_BEARING`, label: '传动链轴承座', category: 'GEARBOX_BEARING' }
  if (name.startsWith('spur gear') || name.startsWith('internal spur gear') || name.startsWith('svi planetarni zupcanici')) return { id: `${turbineId}_GEAR`, label: '齿轮传动件', category: 'GEARBOX' }
  if (name.includes('glavno vratilo') && !name.includes('civija') && !name.includes('navrtka') && !name.includes('歳af')) return { id: `${turbineId}_MAIN_SHAFT`, label: '主轴', category: 'DRIVETRAIN' }
  if (name.includes('sve u gondoli') || name.includes('gondol')) return { id: `${turbineId}_NACELLE`, label: '机舱及机舱附件', category: 'NACELLE' }
  if (name.includes('koren stuba') || name.includes('stub')) return { id: `${turbineId}_TOWER`, label: '塔筒及连接件', category: 'TOWER' }
  if (name.includes('haub')) return { id: `${turbineId}_ROTOR_HUB`, label: '轮毂及整流罩连接件', category: 'ROTOR' }
  if (name === 'wt02_rotor' || name.includes('rotor')) return { id: `${turbineId}_ROTOR`, label: '风轮总成', category: 'ROTOR' }
  return null
}

function bindCadPartNames(root: THREE.Object3D, turbineId: string) {
  const counters = new Map<string, number>()
  root.traverse(object => {
    const sourceName = object.name
    const part = identifyCadPart(sourceName, turbineId)
    object.userData.turbineId = turbineId
    object.userData.sourceCadName = sourceName
    object.userData.modelOrigin = 'PROJECT_ENGINEERING_CAD'
    if (!part) return
    const index = (counters.get(part.id) || 0) + 1
    counters.set(part.id, index)
    const normalizedId = `${part.id}_${String(index).padStart(3, '0')}`
    object.name = normalizedId
    object.userData.componentId = normalizedId
    object.userData.componentGroupId = part.id
    object.userData.componentLabel = part.label
    object.userData.componentCategory = part.category
  })
}

function makeRealGearboxBearingGroup(root: THREE.Object3D, turbineId: string) {
  const group = new THREE.Group()
  group.name = `${turbineId}_REAL_GEARBOX_BEARINGS`
  const targets: THREE.Mesh[] = []
  root.traverse(object => {
    const source = String(object.userData.sourceCadName || '').toLowerCase()
    if (!(object instanceof THREE.Mesh) || (!source.includes('bearing') && !source.includes('le瀉j'))) return
    const ancestry: string[] = []
    let parent = object.parent
    while (parent && parent !== root) {
      ancestry.push(String(parent.userData.sourceCadName || parent.name).toLowerCase())
      parent = parent.parent
    }
    const chain = ancestry.join(' > ')
    const insideNacelle = chain.includes('sve u gondoli')
    const excluded = chain.includes('generator') || chain.includes('pitch motor') || source.includes('washer') || source.includes('podlo') || source.includes('歳af')
    if (!insideNacelle || excluded) return
    object.userData.componentId = `${turbineId}_GEARBOX_BEARING_${String(targets.length + 1).padStart(2, '0')}`
    object.userData.componentGroupId = `${turbineId}_GEARBOX_BEARING`
    object.userData.componentLabel = '齿轮箱轴承'
    object.userData.componentCategory = 'GEARBOX_BEARING'
    targets.push(object)
  })
  group.userData.targets = targets
  return group
}

const engineeringColors: Record<string, number> = {
  GENERATOR: 0x16b8c8,
  GEARBOX: 0xe5a83d,
  GEARBOX_BEARING: 0xff493d,
  BEARING: 0xff785f,
  DRIVETRAIN: 0xb9d0d5,
  ROTOR: 0x80939a,
}

function effectiveCadCategory(object: THREE.Object3D, root: THREE.Object3D) {
  if (object === root) return ''
  return object.userData.componentCategory ? String(object.userData.componentCategory) : ''
}

function isCadExterior(object: THREE.Object3D, category: string) {
  const source = String(object.userData.sourceCadName || '').toLowerCase()
  if (category === 'TOWER' || category === 'ROTOR') return true
  if (category === 'NACELLE') return source.includes('poklopac') || source.includes('gondol') || source.includes('haub')
  const mainNacelleShell = source.startsWith('kuci') && (source.endsWith(' 1-1') || source.endsWith(' 2-1'))
  return mainNacelleShell || source.includes('kuci歵e gornje') || source.includes('gornje kuci') || source.startsWith('wt02_blade_') || source.includes('koren stuba') ||
    source.includes('poklopac za gondolu') || source.includes('za haubu prednja') ||
    source.includes('za haubu zadnja') || source.includes('hauba')
}

function setEngineeringCadView(model: THREE.Object3D | null, active: boolean) {
  if (!model) return
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const category = effectiveCadCategory(object, model)
    const highlightedInternal = ['GENERATOR', 'GEARBOX', 'GEARBOX_BEARING', 'BEARING', 'DRIVETRAIN'].includes(category)
    const exterior = isCadExterior(object, category)
    const source = String(object.userData.sourceCadName || '').toLowerCase()
    object.geometry.computeBoundingBox()
    const localSize = object.geometry.boundingBox?.getSize(new THREE.Vector3()) || new THREE.Vector3()
    // The upper nacelle cover is removed for the engineering cutaway; side/lower
    // housings remain as a translucent reference so the real drivetrain stays readable.
    const isUpperNacelleCover = source.includes('kuci歵e gornje') || source.includes('gornje kuci')
    const isMainNacelleShell = isUpperNacelleCover || (source.startsWith('kuci') && Math.max(localSize.x, localSize.y, localSize.z) > 2.2)
    if (object.userData.engineeringOriginalVisible === undefined) object.userData.engineeringOriginalVisible = object.visible
    // Keep the large white top cover out of the normal and cutaway views.
    object.visible = isUpperNacelleCover ? false : (active && isMainNacelleShell ? false : Boolean(object.userData.engineeringOriginalVisible))
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach(material => {
      const stored = material.userData.engineeringOriginal as { color?: number; opacity: number; transparent: boolean; depthWrite: boolean; emissive?: number } | undefined
      if (!stored) {
        const standard = material as THREE.MeshStandardMaterial
        material.userData.engineeringOriginal = {
          color: standard.color?.getHex(), opacity: material.opacity, transparent: material.transparent,
          depthWrite: material.depthWrite, emissive: standard.emissive?.getHex(),
        }
      }
      const original = material.userData.engineeringOriginal
      const standard = material as THREE.MeshStandardMaterial
      if (!active) {
        material.opacity = original.opacity
        material.transparent = original.transparent
        material.depthWrite = original.depthWrite
        if (original.color !== undefined && standard.color) standard.color.setHex(original.color)
        if (original.emissive !== undefined && standard.emissive) standard.emissive.setHex(original.emissive)
        return
      }
      if (highlightedInternal) {
        material.opacity = 1
        material.transparent = false
        material.depthWrite = true
        if (standard.color) standard.color.setHex(engineeringColors[category] || 0xc8d7da)
        if (standard.emissive) standard.emissive.setHex(category === 'GEARBOX_BEARING' ? 0x66120d : 0x071a20)
      } else if (exterior) {
        material.opacity = category === 'TOWER' ? .08 : .045
        material.transparent = true
        material.depthWrite = false
        if (standard.color) standard.color.setHex(0x76a7b1)
        if (standard.emissive) standard.emissive.setHex(0x06171c)
      } else {
        // Unclassified meshes inside the nacelle are still real mechanical
        // parts (supports, housings, couplings and fasteners), not shell.
        material.opacity = 1
        material.transparent = false
        material.depthWrite = true
        if (original.color !== undefined && standard.color) standard.color.setHex(original.color)
        if (standard.emissive) standard.emissive.setHex(0x061216)
      }
    })
  })
}

function makeCadLabels(model: THREE.Object3D) {
  const group = new THREE.Group()
  group.name = 'CAD_ENGINEERING_LABELS'
  const definitions = [
    ['GEARBOX', '齿轮传动', '#ffd36a'],
    ['GEARBOX_BEARING', '齿轮箱轴承', '#ff796e'],
    ['DRIVETRAIN', '主轴', '#d8edf1'],
  ] as const
  definitions.forEach(([category, text, color]) => {
    const points: THREE.Vector3[] = []
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh) || effectiveCadCategory(object, model) !== category) return
      object.updateWorldMatrix(true, false)
      points.push(new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()))
    })
    if (!points.length) return
    const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length)
    model.worldToLocal(center)
    const label = makeLabel(text, color)
    label.position.copy(center).add(new THREE.Vector3(0, .45, 0))
    label.scale.set(.9, .16, 1)
    group.add(label)
  })
  group.visible = false
  return group
}

function getEngineeringBounds(model: THREE.Object3D | null) {
  const bounds = new THREE.Box3()
  if (!model) return bounds
  model.updateWorldMatrix(true, true)
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const category = effectiveCadCategory(object, model)
    if (!['GENERATOR', 'GEARBOX', 'GEARBOX_BEARING', 'BEARING', 'DRIVETRAIN'].includes(category)) return
    bounds.expandByObject(object)
  })
  return bounds
}

function makeBearing(componentId: string, metal: THREE.Material, ring: THREE.Material) {
  const bearing = new THREE.Group()
  bearing.name = componentId
  bearing.userData.componentId = componentId
  const outer = new THREE.Mesh(new THREE.TorusGeometry(.24, .035, 12, 36), ring)
  outer.rotation.y = Math.PI / 2
  outer.userData.componentId = `${componentId}_OUTER_RING`
  const inner = new THREE.Mesh(new THREE.TorusGeometry(.115, .027, 12, 30), ring.clone())
  inner.rotation.y = Math.PI / 2
  inner.userData.componentId = `${componentId}_INNER_RING`
  const cage = new THREE.Mesh(new THREE.TorusGeometry(.177, .012, 8, 30), metal.clone())
  cage.rotation.y = Math.PI / 2
  cage.userData.componentId = `${componentId}_CAGE`
  bearing.add(outer, inner, cage)
  const rollerGeometry = new THREE.CylinderGeometry(.024, .024, .075, 10)
  for (let index = 0; index < 10; index++) {
    const angle = index / 10 * Math.PI * 2
    const roller = new THREE.Mesh(rollerGeometry, ring.clone())
    roller.rotation.z = Math.PI / 2
    roller.position.set(0, Math.cos(angle) * .177, Math.sin(angle) * .177)
    roller.userData.componentId = `${componentId}_ROLLER_${String(index + 1).padStart(2, '0')}`
    bearing.add(roller)
  }
  return bearing
}

function makeGear(name: string, radius: number, material: THREE.Material) {
  const gear = new THREE.Group()
  gear.name = name
  gear.userData.componentId = name
  const core = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, .12, 28), material)
  core.rotation.z = Math.PI / 2
  gear.add(core)
  const toothGeometry = new THREE.BoxGeometry(.13, .055, .042)
  const teeth = Math.max(12, Math.round(radius * 70))
  for (let index = 0; index < teeth; index++) {
    const angle = index / teeth * Math.PI * 2
    const tooth = new THREE.Mesh(toothGeometry, material)
    tooth.position.set(0, Math.cos(angle) * (radius + .027), Math.sin(angle) * (radius + .027))
    tooth.rotation.x = angle
    gear.add(tooth)
  }
  return gear
}

function setBearingState(bearing: THREE.Object3D, active: boolean) {
  const targets = (bearing.userData.targets as THREE.Object3D[] | undefined) || [bearing]
  targets.forEach(target => target.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach(material => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return
      material.color.setHex(active ? 0xd9584e : 0xc5d6cf)
      material.emissive.setHex(active ? 0x5c1715 : 0x1b332f)
      material.emissiveIntensity = active ? .5 : .08
    })
  }))
}

function setFaultPartState(model: THREE.Object3D | null, category: Turbine['fault_category'], level: Turbine['warning_level']) {
  if (!model || !category) return
  const color = level === 'HIGH' ? 0xff3028 : 0xffbd35
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh) || effectiveCadCategory(object, model) !== category) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach(material => {
      const standard = material as THREE.MeshStandardMaterial
      if (standard.color) standard.color.setHex(color)
      if (standard.emissive) standard.emissive.setHex(level === 'HIGH' ? 0x7a0905 : 0x5a3400)
      standard.emissiveIntensity = level === 'HIGH' ? .75 : .45
      material.opacity = 1
      material.transparent = false
      material.depthWrite = true
    })
  })
}

function makeLabel(text: string, color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 420; canvas.height = 72
  const context = canvas.getContext('2d')!
  context.fillStyle = 'rgba(18, 38, 34, 0.88)'
  context.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 12)
  context.fill()
  context.fillStyle = color
  context.font = '600 26px DM Sans, Arial, sans-serif'
  context.textBaseline = 'middle'
  context.fillText(text, 22, canvas.height / 2 + 1)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
  sprite.scale.set(1.3, .23, 1)
  return sprite
}

export default function WindScene({ turbines, selectedId, onSelect, serviced, engineeringView, onOpenEngineering }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelect)
  const onOpenEngineeringRef = useRef(onOpenEngineering)
  const objectsRef = useRef<Map<string, TurbineSceneObject>>(new Map())
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const selectedIdRef = useRef(selectedId)
  const engineeringViewRef = useRef(engineeringView)
  const controlsRef = useRef<OrbitControls | null>(null)
  const presetRef = useRef<(preset: number) => void>(() => {})
  const flyToRef = useRef<(position: THREE.Vector3, target: THREE.Vector3, duration?: number) => void>(() => {})
  const flightRef = useRef<{
    fromPosition: THREE.Vector3; toPosition: THREE.Vector3
    fromTarget: THREE.Vector3; toTarget: THREE.Vector3
    startedAt: number; duration: number
  } | null>(null)
  const viewRef = useRef({
    position: new THREE.Vector3(24, 23, 42),
    target: new THREE.Vector3(0, 3, 0),
  })

  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])
  useEffect(() => { onOpenEngineeringRef.current = onOpenEngineering }, [onOpenEngineering])
  useEffect(() => {
    selectedIdRef.current = selectedId
    engineeringViewRef.current = engineeringView
  }, [selectedId, engineeringView])

  useEffect(() => {
    const host = containerRef.current!
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xdce8e5)
    scene.fog = new THREE.FogExp2(0xdce8e5, 0.007)
    sceneRef.current = scene
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 350)
    const initialPosition = ridgeLayout[selectedIdRef.current] || [0, 0]
    camera.position.set(initialPosition[0] + 3.8, 9.8, initialPosition[1] + 4.6)
    camera.lookAt(initialPosition[0], 8.7, initialPosition[1])
    cameraRef.current = camera
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = .72
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    host.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    controls.screenSpacePanning = true
    controls.minDistance = 1.1
    controls.maxDistance = 115
    controls.maxPolarAngle = Math.PI * .49
    controls.target.set(0, 3, 0)
    controlsRef.current = controls

    const flyTo = (position: THREE.Vector3, target: THREE.Vector3, duration = 1500) => {
      flightRef.current = {
        fromPosition: camera.position.clone(), toPosition: position.clone(),
        fromTarget: controls.target.clone(), toTarget: target.clone(),
        startedAt: performance.now(), duration,
      }
      controls.enabled = false
    }
    flyToRef.current = flyTo

    const applyPreset = (preset: number) => {
      const selected = turbines.find(turbine => turbine.turbine_id === selectedIdRef.current)
      const selectedPosition = selected ? (ridgeLayout[selected.turbine_id] || selected.position) : [0, 0]
      const x = selectedPosition[0]
      const z = selectedPosition[1]
      const y = terrainHeight(x, z)
      const position = new THREE.Vector3()
      const target = new THREE.Vector3()
      if (preset === 1) { position.set(x + 3.8, y + 9.8, z + 4.6); target.set(x, y + 8.7, z) }
      if (preset === 2) { position.set(x + .25, y + 8.9, z - 5.2); target.set(x, y + 8.85, z) }
      if (preset === 3) { position.set(x + 4.1, y + 9.25, z + .7); target.set(x, y + 8.9, z) }
      if (preset === 4) { position.set(46, 28, 66); target.set(0, 4, 8) }
      flyTo(position, target, preset === 4 ? 2200 : 1400)
    }
    presetRef.current = applyPreset
    const keyPreset = (event: KeyboardEvent) => {
      const preset = Number(event.key)
      if (preset >= 1 && preset <= 4) applyPreset(preset)
    }
    window.addEventListener('keydown', keyPreset)

    scene.add(new THREE.HemisphereLight(0xeaf7ff, 0x123849, 2.35))
    const sun = new THREE.DirectionalLight(0xfff5dc, 2.4)
    sun.position.set(-16, 34, 20)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -35; sun.shadow.camera.right = 35
    sun.shadow.camera.top = 35; sun.shadow.camera.bottom = -35
    sun.shadow.bias = -.0003
    scene.add(sun)

    new EXRLoader().load('/assets/environment/DaySkyHDRI070B_2K_HDR.exr', texture => {
      if (disposed) { texture.dispose(); return }
      texture.mapping = THREE.EquirectangularReflectionMapping
      scene.background = texture
      scene.environment = texture
      scene.backgroundRotation.set(0, Math.PI * .08, 0)
      scene.environmentRotation.set(0, Math.PI * .08, 0)
      scene.backgroundIntensity = .82
      scene.environmentIntensity = .7
      scene.fog = new THREE.FogExp2(0xa9cad3, .0065)
    }, undefined, error => console.error('DaySky HDRI environment could not be loaded.', error))

    const seaGeometry = new THREE.PlaneGeometry(420, 420, 180, 180)
    seaGeometry.rotateX(-Math.PI / 2)
    const seaPosition = seaGeometry.getAttribute('position') as THREE.BufferAttribute
    const seaBase = new Float32Array(seaPosition.array as ArrayLike<number>)
    const seaMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x287c91,
      roughness: .24,
      metalness: .05,
      transmission: .08,
      transparent: true,
      opacity: .94,
      clearcoat: .8,
      clearcoatRoughness: .18,
      envMapIntensity: 1.15,
    })
    const sea = new THREE.Mesh(seaGeometry, seaMaterial)
    sea.receiveShadow = true
    scene.add(sea)

    // Soft concentric wake rings make every offshore foundation visibly meet
    // the water plane instead of appearing to float above it.
    Object.values(ridgeLayout).forEach(([x, z], index) => {
      const wake = new THREE.Mesh(
        new THREE.RingGeometry(.95, 1.04, 48),
        new THREE.MeshBasicMaterial({ color: 0xc7f4f6, transparent: true, opacity: .2 + index % 2 * .06, side: THREE.DoubleSide, depthWrite: false }),
      )
      wake.rotation.x = -Math.PI / 2
      wake.position.set(x, .035, z)
      scene.add(wake)
    })


    const towerMat = new THREE.MeshStandardMaterial({ color: 0xf5f7f2, metalness: .25, roughness: .45 })
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xb9c5bf, metalness: .45, roughness: .42 })
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .15, roughness: .43, side: THREE.DoubleSide })
    const gearboxMat = new THREE.MeshStandardMaterial({ color: 0x566862, transparent: true, opacity: .24, depthWrite: false, metalness: .72, roughness: .3 })
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0xb3c2ba, metalness: .8, roughness: .25 })
    const bearingMat = new THREE.MeshStandardMaterial({ color: 0xd9584e, emissive: 0x4b1614, emissiveIntensity: .35, metalness: .45, roughness: .28 })
    const gearMat = new THREE.MeshStandardMaterial({ color: 0xb98d46, metalness: .82, roughness: .24 })
    const generatorMat = new THREE.MeshStandardMaterial({ color: 0x3d6c68, metalness: .65, roughness: .33 })
    const rootMap = objectsRef.current
    turbines.forEach(turbine => {
      const root = new THREE.Group()
      const position = ridgeLayout[turbine.turbine_id] || turbine.position
      root.position.set(position[0], terrainHeight(position[0], position[1]), position[1])
      root.userData.turbineId = turbine.turbine_id
      root.userData.externalBasis = 'project-engineering-cad'
      root.userData.assetSlot = 'public/assets/wind-turbine-engineering.glb'
      const monopile = new THREE.Mesh(
        new THREE.CylinderGeometry(.62, .78, 4.8, 28),
        new THREE.MeshStandardMaterial({ color: 0xdde4e2, roughness: .48, metalness: .28 }),
      )
      monopile.position.y = -2.18
      monopile.castShadow = true
      monopile.userData.turbineId = turbine.turbine_id
      monopile.userData.componentId = `${turbine.turbine_id}_MONOPILE`
      root.add(monopile)
      const transitionPiece = new THREE.Mesh(
        new THREE.CylinderGeometry(.7, .7, .72, 28),
        new THREE.MeshStandardMaterial({ color: 0xe7b83f, roughness: .42, metalness: .22 }),
      )
      transitionPiece.position.y = .18
      transitionPiece.castShadow = true
      transitionPiece.userData.turbineId = turbine.turbine_id
      transitionPiece.userData.componentId = `${turbine.turbine_id}_TRANSITION_PIECE`
      root.add(transitionPiece)
      const exterior = new THREE.Group()
      exterior.name = `${turbine.turbine_id}_PROCEDURAL_FALLBACK`
      root.add(exterior)
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, .24, 32), edgeMat)
      base.position.y = .12; base.receiveShadow = true; exterior.add(base)
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(.35, .64, 8.5, 20), towerMat)
      tower.position.y = 4.4; tower.castShadow = true; tower.receiveShadow = true; exterior.add(tower)
      const nacelle = new THREE.Mesh(new THREE.BoxGeometry(2.2, .85, 1.05), towerMat.clone())
      nacelle.position.set(0, 8.9, .18); nacelle.castShadow = true; exterior.add(nacelle)
      const rear = new THREE.Mesh(new THREE.CylinderGeometry(.36, .45, .8, 16), edgeMat)
      rear.rotation.x = Math.PI / 2; rear.position.set(0, 8.9, 1); exterior.add(rear)
      const blades = new THREE.Group()
      blades.position.set(0, 8.9, -.67)
      const bladeShape = new THREE.Shape()
      bladeShape.moveTo(-.16, .08)
      bladeShape.lineTo(-.26, 3.9)
      bladeShape.quadraticCurveTo(-.12, 5.3, .02, 5.4)
      bladeShape.lineTo(.18, 3.3)
      bladeShape.lineTo(.15, .08)
      const bladeGeo = new THREE.ShapeGeometry(bladeShape)
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(bladeGeo, bladeMat)
        blade.rotation.z = i * Math.PI * 2 / 3
        blade.castShadow = true
        blades.add(blade)
      }
      const hub = new THREE.Mesh(new THREE.SphereGeometry(.43, 20, 14), edgeMat)
      hub.position.z = -.02; blades.add(hub)
      exterior.add(blades)

      const engineering = new THREE.Group()
      engineering.name = `${turbine.turbine_id}_ENGINEERING_CUTAWAY`
      engineering.userData.turbineId = turbine.turbine_id
      engineering.position.set(0, 9.08, 0)

      const bed = new THREE.Mesh(new THREE.BoxGeometry(1.45, .12, .72), shaftMat)
      bed.position.set(0, -.22, 0); bed.userData.componentId = `${turbine.turbine_id}_NACELLE_BED`; engineering.add(bed)
      const gearbox = new THREE.Mesh(new THREE.BoxGeometry(.58, .5, .62), gearboxMat)
      gearbox.position.set(-.22, .02, 0); gearbox.userData.componentId = `${turbine.turbine_id}_GBX`; engineering.add(gearbox)
      const largeGear = makeGear(`${turbine.turbine_id}_GBX_STAGE_1_GEAR`, .16, gearMat.clone())
      largeGear.position.set(-.2, .1, .08); engineering.add(largeGear)
      const pinion = makeGear(`${turbine.turbine_id}_GBX_STAGE_1_PINION`, .1, gearMat.clone())
      pinion.position.set(-.12, -.18, .08); engineering.add(pinion)
      const bearingId = turbine.event_id === 51 ? 'WF_A_EVENT_51_GEARBOX_BEARING' : `${turbine.turbine_id}_GBX_BEARING`
      const gearboxBearing = makeBearing(bearingId, shaftMat.clone(), bearingMat.clone())
      gearboxBearing.position.set(-.53, .02, 0)
      engineering.add(gearboxBearing)
      const mainBearing = makeBearing(`${turbine.turbine_id}_MBR`, shaftMat.clone(), shaftMat.clone())
      mainBearing.position.set(-.78, .02, 0)
      mainBearing.scale.setScalar(.94)
      engineering.add(mainBearing)
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.075, .075, 1.55, 18), shaftMat)
      shaft.rotation.z = Math.PI / 2; shaft.position.set(-.12, .02, 0); shaft.userData.componentId = `${turbine.turbine_id}_ROTOR_SHAFT`; engineering.add(shaft)
      const generator = new THREE.Mesh(new THREE.CylinderGeometry(.27, .27, .62, 24), generatorMat)
      generator.rotation.z = Math.PI / 2; generator.position.set(.43, .02, 0); generator.userData.componentId = `${turbine.turbine_id}_GEN`; engineering.add(generator)
      const generatorCap = new THREE.Mesh(new THREE.CylinderGeometry(.29, .29, .06, 24), edgeMat)
      generatorCap.rotation.z = Math.PI / 2; generatorCap.position.set(.1, .02, 0); generatorCap.userData.componentId = `${turbine.turbine_id}_GEN_CAP`; engineering.add(generatorCap)
      const coupling = new THREE.Mesh(new THREE.CylinderGeometry(.14, .14, .14, 18), gearMat.clone())
      coupling.rotation.z = Math.PI / 2; coupling.position.set(.06, .02, 0); coupling.userData.componentId = `${turbine.turbine_id}_HSS_COUPLING`; engineering.add(coupling)
      for (let index = 0; index < 5; index++) {
        const coolingRib = new THREE.Mesh(new THREE.TorusGeometry(.285, .012, 8, 24), generatorMat.clone())
        coolingRib.rotation.y = Math.PI / 2
        coolingRib.position.set(.2 + index * .115, .02, 0)
        coolingRib.userData.componentId = `${turbine.turbine_id}_GEN_COOLING_RIB_${index + 1}`
        engineering.add(coolingRib)
      }
      const labels = [
        { text: 'GEARBOX', position: [-.3, .6, 0] as [number, number, number], color: '#b8d1c6' },
        { text: turbine.event_id === 51 ? 'GBX BEARING · E51' : 'GBX BEARING', position: [-.48, -.5, 0] as [number, number, number], color: turbine.event_id === 51 ? '#ff9e8d' : '#b8d1c6' },
        { text: 'MAIN BEARING', position: [-.8, -.85, 0] as [number, number, number], color: '#b8d1c6' },
        { text: 'GENERATOR', position: [.48, .6, 0] as [number, number, number], color: '#b8d1c6' },
      ]
      labels.forEach(label => { const sprite = makeLabel(label.text, label.color); sprite.position.set(...label.position); engineering.add(sprite) })
      engineering.visible = false
      root.add(engineering)
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.58, 1.68, 64), new THREE.MeshBasicMaterial({ color: 0x203c38, transparent: true, opacity: .65, side: THREE.DoubleSide }))
      ring.rotation.x = -Math.PI / 2; ring.position.y = .035; root.add(ring)
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(.115, 16, 12), new THREE.MeshStandardMaterial({ color: colors[turbine.warning_level], emissive: colors[turbine.warning_level], emissiveIntensity: .8 }))
      // Keep the state lamp physically tied to the tower base. This remains
      // readable from overview while making turbine ownership unambiguous.
      beacon.position.set(.82, .3, 0); beacon.userData.turbineId = turbine.turbine_id; root.add(beacon)
      scene.add(root)
      rootMap.set(turbine.turbine_id, { beacon, ring, blades, root, exterior, nacelle, engineering, gearboxBearing, cadModel: null, cadLabels: null })
    })

    let disposed = false
    const loader = new GLTFLoader()
    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('/draco/')
    loader.setDRACOLoader(dracoLoader)
    // One decoded CAD template is cloned for all eight turbines. Geometry and
    // textures remain shared; only materials are cloned where state styling is needed.
    loader.load(engineeringModelUrl, gltf => {
      if (disposed) return
      const template = gltf.scene
      template.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(template)
      const size = bounds.getSize(new THREE.Vector3())
      const scale = 10.8 / Math.max(size.x, size.y, size.z)
      rootMap.forEach((object, id) => {
        const imported = template.clone(true)
        imported.name = `${id}_ENGINEERING_CAD_MODEL`
        bindCadPartNames(imported, id)
        imported.scale.setScalar(scale)
        // Source CAD is exported with its tower axis along model Y. After glTF
        // conversion that axis lies horizontally, so stand the complete assembly up.
        imported.rotation.x = Math.PI / 2
        imported.updateMatrixWorld(true)
        const uprightBounds = new THREE.Box3().setFromObject(imported)
        const uprightCenter = uprightBounds.getCenter(new THREE.Vector3())
        imported.position.set(-uprightCenter.x, -uprightBounds.min.y, -uprightCenter.z)
        imported.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return
          child.material = Array.isArray(child.material)
            ? child.material.map(material => material.clone())
            : child.material.clone()
          child.castShadow = true
          child.receiveShadow = true
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          materials.forEach(material => {
            const standard = material as THREE.MeshStandardMaterial
            if (standard.color) standard.color.setHex(0xf4f5f2)
            standard.roughness = .58
            standard.metalness = Math.min(standard.metalness || 0, .3)
          })
        })
        const realBearings = makeRealGearboxBearingGroup(imported, id)
        imported.add(realBearings)
        const cadLabels = makeCadLabels(imported)
        imported.add(cadLabels)
        object.root.add(imported)
        object.exterior.visible = false
        object.engineering.visible = false
        object.gearboxBearing = realBearings
        object.cadModel = imported
        object.cadLabels = cadLabels
        object.nacelle = imported.getObjectByName(`${id}_NACELLE_001`) || imported
        // The marker belongs to the same root and sits beside the real CAD base.
        // Scale its offset to the imported footprint instead of using a world-space guess.
        object.beacon.position.set(Math.max(.55, uprightBounds.getSize(new THREE.Vector3()).x * .42), .3, 0)
        const engineeringActive = engineeringViewRef.current && selectedIdRef.current === id
        setEngineeringCadView(imported, engineeringActive)
        const turbine = turbines.find(item => item.turbine_id === id)
        if (engineeringActive && turbine) setFaultPartState(imported, turbine.fault_category, turbine.warning_level)
        cadLabels.visible = engineeringActive
        setBearingState(realBearings, engineeringActive && id === 'WT02')
        if (engineeringActive) {
          object.root.updateWorldMatrix(true, true)
          const focusBounds = getEngineeringBounds(imported)
          if (!focusBounds.isEmpty()) {
            const focus = focusBounds.getCenter(new THREE.Vector3())
            const focusSize = focusBounds.getSize(new THREE.Vector3())
            const distance = Math.max(1.4, focusSize.length() * 1.8)
            viewRef.current.target.copy(focus)
            viewRef.current.position.copy(focus).add(new THREE.Vector3(distance * .55, distance * .24, distance))
          }
        }
      })
    }, undefined, error => {
      console.error('Engineering CAD wind turbine could not be loaded; using fallback exterior.', error)
    })

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let downX = 0, downY = 0
    const pointerDown = (event: PointerEvent) => { downX = event.clientX; downY = event.clientY }
    const pointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 6) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects([...rootMap.values()].map(o => o.root), true)
      for (const hit of hits) {
        let part: THREE.Object3D | null = hit.object
        let clickedNacelle = false
        while (part) {
          const category = String(part.userData.componentCategory || '')
          const source = String(part.userData.sourceCadName || '').toLowerCase()
          if (category === 'NACELLE' || source.includes('gondol') || source.startsWith('kuci')) clickedNacelle = true
          if (part.userData.turbineId) break
          part = part.parent
        }
        let target: THREE.Object3D | null = hit.object
        while (target && !target.userData.turbineId) target = target.parent
        if (target?.userData.turbineId) {
          const turbineId = target.userData.turbineId as string
          const wasSelected = selectedIdRef.current === turbineId
          onSelectRef.current(turbineId)
          const turbine = turbines.find(item => item.turbine_id === turbineId)
          const position = turbine ? (ridgeLayout[turbineId] || turbine.position) : [0, 0]
          const y = terrainHeight(position[0], position[1])
          flyTo(
            new THREE.Vector3(position[0] + 3.8, y + 9.8, position[1] + 4.6),
            new THREE.Vector3(position[0], y + 8.7, position[1]),
            1800,
          )
          if (wasSelected && clickedNacelle) onOpenEngineeringRef.current()
          break
        }
      }
    }
    renderer.domElement.addEventListener('pointerdown', pointerDown)
    renderer.domElement.addEventListener('pointerup', pointerUp)

    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight
      if (!width || !height) return
      camera.aspect = width / height
      camera.fov = width < 650 ? 47 : 34
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host); resize()
    let frame = 0, raf = 0
    const render = () => {
      frame++
      const flight = flightRef.current
      if (flight) {
        const rawProgress = Math.min(1, (performance.now() - flight.startedAt) / flight.duration)
        const eased = rawProgress < .5
          ? 4 * rawProgress * rawProgress * rawProgress
          : 1 - Math.pow(-2 * rawProgress + 2, 3) / 2
        camera.position.lerpVectors(flight.fromPosition, flight.toPosition, eased)
        controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased)
        if (rawProgress >= 1) {
          flightRef.current = null
          controls.enabled = true
        }
      }
      const time = frame * .018
      for (let index = 0; index < seaPosition.count; index++) {
        const x = seaBase[index * 3]
        const z = seaBase[index * 3 + 2]
        const wave = Math.sin(x * .16 + time) * .075 + Math.cos(z * .13 - time * .82) * .055 + Math.sin((x + z) * .07 + time * .55) * .035
        seaPosition.setY(index, wave)
      }
      seaPosition.needsUpdate = true
      if (frame % 8 === 0) seaGeometry.computeVertexNormals()
      rootMap.forEach(o => {
        if (o.blades.userData.spinAxis === 'y') o.blades.rotation.y += .0035
        else o.blades.rotation.z += .0035
      })
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(render)
    }
    render()
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('pointerup', pointerUp)
      host.removeChild(renderer.domElement)
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach(material => material.dispose())
        }
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose()
          object.material.dispose()
        }
      })
      renderer.dispose()
      controls.dispose()
      flightRef.current = null
      flyToRef.current = () => {}
      window.removeEventListener('keydown', keyPreset)
      controlsRef.current = null
      dracoLoader.dispose()
      rootMap.clear()
      sceneRef.current = null; cameraRef.current = null
    }
  }, [turbines])

  useEffect(() => {
    const selected = turbines.find(turbine => turbine.turbine_id === selectedId)
    const controls = controlsRef.current
    const camera = cameraRef.current
    if (!controls || !camera) return
    if (selected && engineeringView) {
      const selectedObject = objectsRef.current.get(selectedId)
      const focusBounds = getEngineeringBounds(selectedObject?.cadModel || null)
      if (!focusBounds.isEmpty()) {
        const focus = focusBounds.getCenter(new THREE.Vector3())
        const focusSize = focusBounds.getSize(new THREE.Vector3())
        const distance = Math.max(1.4, focusSize.length() * 1.8)
        viewRef.current.target.copy(focus)
        viewRef.current.position.copy(focus).add(new THREE.Vector3(distance * .55, distance * .24, distance))
      }
    } else {
      const selectedPosition = selected ? (ridgeLayout[selected.turbine_id] || selected.position) : [0, 0]
      const y = terrainHeight(selectedPosition[0], selectedPosition[1])
      viewRef.current.position.set(selectedPosition[0] + 3.8, y + 9.8, selectedPosition[1] + 4.6)
      viewRef.current.target.set(selectedPosition[0], y + 8.7, selectedPosition[1])
    }
    flyToRef.current(viewRef.current.position, viewRef.current.target, engineeringView ? 1200 : 1750)
  }, [selectedId, engineeringView, turbines])

  useEffect(() => {
    objectsRef.current.forEach((object, id) => {
      const turbine = turbines.find(t => t.turbine_id === id)
      if (!turbine) return
      const color = id === selectedId && serviced ? colors.NORMAL : colors[turbine.warning_level]
      const material = object.beacon.material as THREE.MeshStandardMaterial
      material.color.setHex(color); material.emissive.setHex(color)
      const ringMaterial = object.ring.material as THREE.MeshBasicMaterial
      ringMaterial.color.setHex(id === selectedId ? 0x173c35 : 0x7d9d91)
      ringMaterial.opacity = id === selectedId ? .9 : .24
      object.ring.scale.setScalar(id === selectedId ? 1.2 : 1)
      object.ring.visible = false
      object.root.visible = !engineeringView || id === selectedId
      object.blades.visible = false
      object.beacon.visible = !(engineeringView && id === selectedId)
      object.engineering.visible = false
      const engineeringActive = engineeringView && id === selectedId
      setEngineeringCadView(object.cadModel, engineeringActive)
      if (engineeringActive) setFaultPartState(object.cadModel, turbine.fault_category, turbine.warning_level)
      if (object.cadLabels) object.cadLabels.visible = engineeringActive
      setBearingState(object.gearboxBearing, turbine.event_id === 51 && id === selectedId)
    })
  }, [selectedId, serviced, turbines, engineeringView])

  return <div className="scene-canvas" ref={containerRef} aria-label="可点击的三维风电场">
    <div className="drone-hud" aria-hidden="true">
      <span className="drone-corner drone-corner-tl" /><span className="drone-corner drone-corner-tr" />
      <span className="drone-corner drone-corner-bl" /><span className="drone-corner drone-corner-br" />
      <div className="drone-reticle"><i /><b /></div>
      <div className="drone-status"><strong>UAV INSPECTION</strong><span>目标 {selectedId}</span><span>安全距离约 45 m</span><span>机舱高度约 100 m</span></div>
      <div className="drone-rec"><i /> REC</div>
    </div>
    <div className="camera-presets" aria-label="预设视角">
      {[['1', '巡检'], ['2', '叶轮'], ['3', '机舱'], ['4', '全场']].map(([key, label]) =>
        <button key={key} onClick={() => presetRef.current(Number(key))}><b>{key}</b>{label}</button>)}
    </div>
  </div>
}
