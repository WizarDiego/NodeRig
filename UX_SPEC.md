# NodeRig v2: UX & Technical Specification

## 1. Overview
NodeRig is a professional, visually-driven 3D scene manager and pose editor that runs inside a ComfyUI custom node instance. It provides advanced tools for 3D layout, object hierarchy management, and precise skeletal posing for generation pipelines like ControlNet or Image-to-Image.

## 2. Component Hierarchy
- **Main Viewport (Center)**: Full-bleed 3D WebGL Canvas displaying the scene and characters. Features seamless `OrbitControls` navigation.
- **Top-Left Corner**: 
  - Floating Brand Chip (NodeRig).
  - Floating Status Badge ("🦴 Rig Detectado · N bones") if a rigged character is selected.
  - Quick Toggle ("👁 Ocultar/Mostrar Ossos") for toggling the skeleton visualization.
- **Right Panel (Scene Graph)**: Dynamic object hierarchy list. Allows users to view, select, and remove individual 3D objects in the scene.
- **Left Panel (Bone Control)**: When a rigged model is loaded and a joint is clicked, a detailed control panel appears. Features:
  - Bone Dropdown Selector.
  - Mode toggles: Rotate, Translate, Scale.
  - Precision Sliders for X, Y, Z axes.
  - Reset Bone & Reset All buttons.
- **Bottom Dock**: Floating dock with core scene controls:
  - Resolution selector.
  - Light intensity slider.
  - Load 3D / Clear Scene actions.
  - Export controls: Save PC, Save to /input, Send to Memory, Generate (Queue in ComfyUI).

## 3. Pose Editing Workflow
1. **Model Loading:** User loads a GLTF/GLB via the bottom dock.
2. **Auto-Detection:** NodeRig recursively checks the character for `isBone` or `isSkinnedMesh`. If found, a visualization overlay runs on top, displaying joints as spheres and bones as connecting lines.
3. **Selection & Transform:** When the user clicks a joint sphere:
   - A `TransformControls` gizmo attaches to the specific bone.
   - The Bone Control Panel opens to manually sync XYZ values.
   - Using the gizmo automatically updates the sliders, and using the sliders automatically updates the gizmo.
4. **Mesh Deformation:** Actions trigger `skeleton.update()` ensuring the 3D model bends/twists according to skeletal changes in real-time.

## 4. Export & Auto-Hide Behavior
The skeleton overlay (lines, spheres, gizmos) must **never** be rendered in the final exported image (which is fed to KSampler).
- Any interaction with an export button triggers an `event capture phase` listener that temporarily sets `skeletonGroup.visible = false`.
- The renderer generates the base64 PNG.
- The skeleton visibility is immediately restored in the next event loop frame.

## 5. UI Aesthetic Rules
- **Color Palette**: Dark mode. Pitch black or `#121212` background. Deep greys `#1e1e1e`/`rgba(0,0,0,0.4)` for floating panels.
- **Accents**: Cyan (`#00E5FF`) for bone lines, Orange (`#ff8c00`) for joints, bright Green (`#00ff88`) for selected joints. Sliders use RGB (Red for X, Green for Y, Blue for Z) standards.
- **Typography**: Inter (Google Fonts), sans-serif.
- **Micro-animations**: Backdrop blur (glassmorphism), button hover effects, smooth CSS transforms for opening panels.
