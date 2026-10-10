# 3D Asset Attribution

## Project engineering CAD turbine

- Local file: `wind-turbine-engineering.glb`
- Role: exterior and mechanical assembly used for all eight displayed turbines
- Source: project-provided SolidWorks/STEP assembly converted to GLB
- Naming: original CAD node names are retained in `sourceCadName`; the application adds normalized engineering identifiers for rotor blades, rotor/hub, tower, nacelle, shaft, gears, bearings, and generator parts.
- Evidence boundary: the visible CAD bearing and gearbox parts are engineering-model components. Until the CARE asset-to-component mapping is formally verified, they must not be presented as the officially confirmed physical component represented by `WT02_COMPONENT_01`.

## Environment materials

- `environment/Grass005_2K-JPG_*`: Grass005 2K PBR material supplied by the project user; color, OpenGL normal, roughness, and ambient-occlusion maps are used on the wind-farm lawn.
- `environment/DaySkyHDRI070B_2K_HDR.exr`: DaySkyHDRI070B 2K environment supplied by the project user; used as the visible sky and image-based environment lighting.
