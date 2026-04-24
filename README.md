# NodeRig v4.3 — 3D Pose Editor for ComfyUI - Brazil edition


**NodeRig** is a full 3D pose and skeleton editor integrated directly into **ComfyUI** as a custom node. It runs inside an `iframe` within the ComfyUI interface and communicates with the AI pipeline, sending pose renders as images to downstream nodes.

![NodeRig Banner](assets/banner.png)

---

## ✨ Features

### 🌐 3D Scene
- WebGL viewport powered by **Three.js** with shadows and anti-aliasing
- **OrbitControls**: Rotate (Left), Dolly (Scroll), Pan (Right)
- Load **GLB / GLTF** models via dock upload; model is persisted between sessions
- **Scene Hierarchy Panel**: list, select, and remove scene objects
- **Background Plate**: load PNG/JPG as backdrop; optional inclusion in exports
- **Light Intensity Slider**: persisted in `localStorage`
- **Resolution Selector**: 1024×1024, 720×960, 1024×720
- **Camera HUD**: distance bar with color-coded proximity indicator

### 🦴 Skeleton & Bone Control
- **Auto-Detection**: automatically finds all `Bone` and `SkinnedMesh` objects on model load
- **Joint Visualization**: orange spheres (joints) + cyan lines (bones) overlaid on the model
- **Click to Select Bone A** (green highlight)
- **Shift + Click to Select Bone B** (purple highlight)
- **TransformControls Gizmo** attached to selected bone
- **Control Panel** with scrollable layout and three modes:
  - 🔄 **Rotate** — X/Y/Z sliders in degrees (−180° to +180°)
  - ↔️ **Translate** — X/Y/Z position sliders
  - ⬛ **Scale** — X/Y/Z or uniform scale
- **Link A→B**: mirror slider values from Bone A to Bone B in real time
- **Mirror Axis**: negate selected axes (YZ, X, Y, Z, XY, XZ) when syncing
- **Reset A / Reset B / Reset All**: restore original bind pose
- **Random Pose**: apply random rotations/scales to selected bone
- **IK Mode**: toggle Inverse Kinematics solver (Three.js CCD)
- **Bind Mesh**: auto-rig a static mesh to the detected skeleton
- **Saved Pairs**: save A+B combos persistently in `localStorage` (per model)
  - Click a saved pair to instantly restore both selections + enable Mirror
  - Delete pairs with the ✕ button

### 📷 Camera & Lens Effects
- **Focal Length**: simulate lenses from 20mm to 200mm
- **Barrel Distortion**: wide-angle / fisheye look
- **Bokeh / DOF**: simulated depth-of-field blur
- **Vignette**: edge darkening
- **Chromatic Aberration**: RGB channel shift on the borders
- **Reset**: restore all lens parameters to defaults

### 🎨 UI & Layout
- **Glassmorphism** design with blur, gradients, and subtle borders
- **Bring to Front**: clicking any panel automatically raises its z-index
- **Vertical Spacing Toggle (↕)**: bottom-right icon switches between Normal and Spacious modes
- **Status Toast**: smooth contextual feedback messages

### 🔌 ComfyUI Integration

The **NodeRing Output** node has **two outputs**:

| Output | Description |
|---|---|
| `pose_image` | Full scene render (model + lighting) |
| `background_image` | Background plate only (clean, no 3D model) |

- **Flip Horizontal**: toggle to mirror the render
- **IS_CHANGED**: forces re-evaluation on every queue run
- **Send Memory**: sends the current render to the node via POST
- **Save to /input**: exports the pose as `noderig_pose.png` to ComfyUI's input folder

---

## 📦 Installation

1. Clone this repository into your ComfyUI custom nodes folder:
   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/YOUR_USERNAME/NodeRig.git
   ```

2. Restart ComfyUI.

3. The **NodeRig Output** node will appear in the `NodeRig` category.

---

## 🔗 Data Flow

```
[3D Editor (iframe)] ──(render PNG)──► [POST /NodeRing] ──► NodeRing.latest_pose_b64
[3D Editor (iframe)] ──(bg base64)──► [POST /NodeRing] ──► NodeRing.latest_bg_b64
                                                                      │
                                                        [ComfyUI Queue Prompt]
                                                                      │
                                              ┌───────────────────────┴────────────────────┐
                                        [pose_image]                              [background_image]
                                              │                                             │
                                  (ControlNet / IPAdapter)                    (Florence-2 / CLIP Vision)
```

---

## 🗂️ Project Structure

```
NodeRig/
├── node.py            # ComfyUI node class — outputs, image decoding
├── __init__.py        # HTTP server routes (REST API)
├── web/
│   └── NodeRingUI.js  # ComfyUI LiteGraph integration (iframe injection)
├── frontend/
│   ├── index.html     # UI layout
│   ├── app.js         # 3D scene, OrbitControls, model loading, exports
│   ├── skeletonRig.js # Bone detection, selection, pose controls, saved pairs
│   ├── lensCamera.js  # Camera simulation and lens effects
│   └── style.css      # Glassmorphism design system
└── assets/
    ├── models/        # Persisted GLB/GLTF files
    └── characters/    # Built-in character presets
```

---

## 🛠️ Dependencies

- [Three.js r128](https://threejs.org/) — 3D rendering engine
- [Python 3.x](https://www.python.org/) + Pillow, NumPy, PyTorch (via ComfyUI)
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)

---

## 📄 License

MIT License — feel free to use, modify, and distribute.
