import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Turbine } from './data'

interface Props {
  turbines: Turbine[]
  selectedId: string
  onSelect: (id: string) => void
  serviced: boolean
  engineeringView: boolean
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
  gearboxBearing: THREE.Group
}

function setOpacity(root: THREE.Object3D, opacity: number) {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach(material => {
      material.transparent = opacity < 1
      material.opacity = opacity
      material.depthWrite = opacity >= 1
    })
  })
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
  bearing.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach(material => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return
      material.color.setHex(active ? 0xd9584e : 0xc5d6cf)
      material.emissive.setHex(active ? 0x5c1715 : 0x1b332f)
      material.emissiveIntensity = active ? .5 : .08
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

export default function WindScene({ turbines, selectedId, onSelect, serviced, engineeringView }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelect)
  const objectsRef = useRef<Map<string, TurbineSceneObject>>(new Map())
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const selectedIdRef = useRef(selectedId)
  const engineeringViewRef = useRef(engineeringView)
  const viewRef = useRef({
    position: new THREE.Vector3(24, 23, 42),
    target: new THREE.Vector3(0, 3, 0),
  })

  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])
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
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 350)
    camera.position.set(24, 23, 42)
    camera.lookAt(0, 3, 0)
    cameraRef.current = camera
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    host.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight(0xffffff, 0x879c97, 2.6))
    const sun = new THREE.DirectionalLight(0xfff5dc, 2.4)
    sun.position.set(-16, 34, 20)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -35; sun.shadow.camera.right = 35
    sun.shadow.camera.top = 35; sun.shadow.camera.bottom = -35
    sun.shadow.bias = -.0003
    scene.add(sun)

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(110, 90), new THREE.MeshStandardMaterial({ color: 0xb9cfc3, roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    const hillMaterial = new THREE.MeshStandardMaterial({ color: 0x91aa98, roughness: 1 })
    const farHillMaterial = new THREE.MeshStandardMaterial({ color: 0x7f9c91, roughness: 1 })
    ;[[-31, -13, 16, 5.5, 10, farHillMaterial], [27, -17, 19, 6.5, 12, farHillMaterial], [-29, 18, 15, 4.5, 9, hillMaterial], [29, 17, 17, 5, 11, hillMaterial]].forEach(([x, z, sx, sy, sz, material]) => {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), material as THREE.Material)
      hill.position.set(x, sy * .42, z); hill.scale.set(sx, sy, sz); hill.receiveShadow = true; scene.add(hill)
    })
    const stationGroup = new THREE.Group(); stationGroup.position.set(24, .2, -3)
    const station = new THREE.Mesh(new THREE.BoxGeometry(4, 1.25, 2.5), new THREE.MeshStandardMaterial({ color: 0x697a73, roughness: .75 }))
    station.castShadow = true; stationGroup.add(station)
    const mastMaterial = new THREE.MeshStandardMaterial({ color: 0xb5c3bb, metalness: .4, roughness: .5 })
    for (let index = 0; index < 3; index++) { const mast = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, 2.1, 8), mastMaterial); mast.position.set(-1.2 + index * 1.2, 1.55, 0); stationGroup.add(mast) }
    scene.add(stationGroup)
    const trackMaterial = new THREE.MeshStandardMaterial({ color: 0x9eafa8, roughness: 1 })
    for (const [x, z, w, h, rotation] of [[0, -2, 44, .58, -.12], [-4, -7, .55, 14, .1], [8, -1, .55, 15, -.2]] as number[][]) {
      const path = new THREE.Mesh(new THREE.PlaneGeometry(w, h), trackMaterial)
      path.rotation.x = -Math.PI / 2; path.rotation.z = rotation; path.position.set(x, .015, z)
      scene.add(path)
    }

    const shrubMat = new THREE.MeshStandardMaterial({ color: 0x91b5a2, roughness: 1 })
    const shrubGeo = new THREE.IcosahedronGeometry(.3, 0)
    for (let i = 0; i < 100; i++) {
      const x = Math.sin(i * 17.21) * 33, z = Math.cos(i * 11.37) * 23
      if (Math.abs(x) < 17 && Math.abs(z) < 8) continue
      const shrub = new THREE.Mesh(shrubGeo, shrubMat)
      shrub.position.set(x, .23, z)
      shrub.scale.set(1 + (i % 4) * .35, .55, 1 + (i % 3) * .25)
      scene.add(shrub)
    }

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
      root.position.set(turbine.position[0], 0, turbine.position[1])
      root.userData.turbineId = turbine.turbine_id
      root.userData.externalBasis = 'digital-bim-wind-turbine'
      root.userData.assetSlot = 'public/assets/digital-bim-wind-turbine.glb'
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
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(.22, 16, 12), new THREE.MeshStandardMaterial({ color: colors[turbine.warning_level], emissive: colors[turbine.warning_level], emissiveIntensity: .55 }))
      beacon.position.set(0, 9.52, 0); root.add(beacon)
      scene.add(root)
      rootMap.set(turbine.turbine_id, { beacon, ring, blades, root, exterior, nacelle, engineering, gearboxBearing })
    })

    let disposed = false
    const loader = new GLTFLoader()
    loader.load('/assets/digital-bim-wind-turbine.glb', gltf => {
      if (disposed) return
      const template = gltf.scene
      template.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(template)
      const scale = .085
      rootMap.forEach((object, id) => {
        const imported = template.clone(true)
        imported.name = `${id}_DIGITAL_BIM_EXTERIOR`
        imported.scale.setScalar(scale)
        imported.position.set(0, -bounds.min.y * scale, 0)
        imported.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return
          child.material = Array.isArray(child.material)
            ? child.material.map(material => material.clone())
            : child.material.clone()
          child.castShadow = true
          child.receiveShadow = true
        })
        object.root.add(imported)
        object.exterior.visible = false
        const importedBlades = imported.getObjectByName('blades') || imported.getObjectByName('rotor')
        if (importedBlades) {
          importedBlades.userData.spinAxis = 'y'
          importedBlades.visible = !(engineeringViewRef.current && selectedIdRef.current === id)
          object.blades = importedBlades
        }
        object.nacelle = imported.getObjectByName('turbine') || imported
        setOpacity(object.nacelle, engineeringViewRef.current && selectedIdRef.current === id ? .16 : 1)
      })
    }, undefined, error => {
      console.error('Digital BIM wind turbine could not be loaded; using fallback exterior.', error)
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
      let target: THREE.Object3D | null = hits[0]?.object || null
      while (target && !target.userData.turbineId) target = target.parent
      if (target?.userData.turbineId) onSelectRef.current(target.userData.turbineId)
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
    const lookTarget = new THREE.Vector3(0, 3, 0)
    const render = () => {
      frame++
      rootMap.forEach(o => {
        if (o.blades.userData.spinAxis === 'y') o.blades.rotation.y += .0035
        else o.blades.rotation.z += .0035
      })
      camera.position.lerp(viewRef.current.position, .065)
      lookTarget.lerp(viewRef.current.target, .065)
      camera.lookAt(lookTarget)
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
      rootMap.clear()
      sceneRef.current = null; cameraRef.current = null
    }
  }, [turbines])

  useEffect(() => {
    const selected = turbines.find(turbine => turbine.turbine_id === selectedId)
    if (selected && engineeringView) {
      viewRef.current.position.set(selected.position[0] + 3.2, 9.8, selected.position[1] + 7.7)
      viewRef.current.target.set(selected.position[0], 8.95, selected.position[1] + .08)
    } else {
      viewRef.current.position.set(24, 23, 42)
      viewRef.current.target.set(0, 3, 0)
    }
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
      object.root.visible = !engineeringView || id === selectedId
      object.blades.visible = !(engineeringView && id === selectedId)
      object.beacon.visible = !(engineeringView && id === selectedId)
      object.engineering.visible = engineeringView && id === selectedId
      setOpacity(object.nacelle, engineeringView && id === selectedId ? .16 : 1)
      setBearingState(object.gearboxBearing, turbine.event_id === 51 && id === selectedId)
    })
  }, [selectedId, serviced, turbines, engineeringView])

  return <div className="scene-canvas" ref={containerRef} aria-label="可点击的三维风电场" />
}
