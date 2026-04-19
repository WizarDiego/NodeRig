// ============================================================
// RENDERER + SCENE + CAMERA
// ============================================================
const scene = new THREE.Scene();
const SCENE_BG_SOLID = new THREE.Color(0x131316); // cor solida original
scene.background = SCENE_BG_SOLID;

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(-2, 3, 9);
camera.lookAt(0, 1.5, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);

// ============================================================
// LIGHTING
// ============================================================
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(4, 10, 6);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.bias = -0.001;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x90b0ff, 0.3);
fillLight.position.set(-4, 3, -4);
scene.add(fillLight);

// Apply saved light preference
const savedLight = localStorage.getItem("noderig_light");
if (savedLight !== null) {
    const lv = parseFloat(savedLight);
    dirLight.intensity = lv;
    ambientLight.intensity = lv * 0.5;
}

// ============================================================
// ENVIRONMENT GEOMETRY
// ============================================================
const gridHelper = new THREE.GridHelper(20, 20, 0x333333, 0x1a1a1a);
gridHelper.position.y = -0.01;
scene.add(gridHelper);

const planeGeo = new THREE.PlaneGeometry(20, 20);
const planeMat = new THREE.MeshStandardMaterial({ color: 0x131316, roughness: 1 });
const plane = new THREE.Mesh(planeGeo, planeMat);
plane.rotation.x = -Math.PI / 2;
plane.receiveShadow = true;
scene.add(plane);

// ============================================================
// ORBIT CONTROLS
// ============================================================
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
};

// ============================================================
// GLTF LOADER
// ============================================================
const gltfLoader = new THREE.GLTFLoader();

// ============================================================
// SCENE OBJECT REGISTRY — cada entrada: { id, name, root }
// ============================================================
const sceneRegistry = [];
let activeItem = null;   // objeto do registry que está selecionado

// ============================================================
// SCENE GRAPH UI
// ============================================================
const sceneListEl = document.getElementById("scene-list");

function refreshSceneGraph() {
    sceneListEl.innerHTML = "";

    if (sceneRegistry.length === 0) {
        sceneListEl.innerHTML = '<li class="scene-empty">Nenhum objeto na cena.</li>';
        return;
    }

    sceneRegistry.forEach((item) => {
        const li = document.createElement("li");
        li.className = "scene-item" + (item === activeItem ? " active" : "");
        li.dataset.id = item.id;

        li.innerHTML = `
            <span class="scene-item-icon">◈</span>
            <span class="scene-item-name" title="${item.name}">${item.name}</span>
            <button class="scene-item-remove" title="Remover da cena">✕</button>
        `;

        // Selecionar objeto: click no item ativa drag deste objeto
        li.addEventListener("click", (e) => {
            if (e.target.classList.contains("scene-item-remove")) return;
            activeItem = item;
            refreshSceneGraph();
            showStatus(`Selecionado: ${item.name}`);
        });

        // Remover objeto individual
        li.querySelector(".scene-item-remove").addEventListener("click", () => {
            scene.remove(item.root);
            const idx = sceneRegistry.indexOf(item);
            if (idx !== -1) sceneRegistry.splice(idx, 1);
            if (activeItem === item) activeItem = null;
            refreshSceneGraph();
            showStatus(`${item.name} removido da cena`);
        });

        sceneListEl.appendChild(li);
    });
}

function registerObject(root, name) {
    const item = { id: Date.now() + Math.random(), name, root };
    sceneRegistry.push(item);
    activeItem = item; // auto-seleciona o recém carregado
    refreshSceneGraph();
    return item;
}

// ============================================================
// PRIMITIVE DUMMY (fallback enquanto nenhum GLB for carregado)
// ============================================================
const material = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.2, metalness: 0.1 });

function buildDummy() {
    const character = new THREE.Group();
    character.name = "Manequim";

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.6), material);
    body.position.y = 1; body.castShadow = true; body.receiveShadow = true;
    character.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.44, 32, 32), material);
    head.position.y = 2.35; head.castShadow = true; head.receiveShadow = true;
    character.add(head);

    const armGeo = new THREE.BoxGeometry(0.33, 1.3, 0.33);
    const leftArm = new THREE.Mesh(armGeo, material);
    leftArm.position.set(-0.77, 0.9, 0); leftArm.castShadow = true;
    character.add(leftArm);

    const rightArm = new THREE.Mesh(armGeo, material);
    rightArm.position.set(0.77, 0.9, 0); rightArm.castShadow = true;
    character.add(rightArm);

    const legGeo = new THREE.BoxGeometry(0.38, 1.3, 0.38);
    const leftLeg = new THREE.Mesh(legGeo, material);
    leftLeg.position.set(-0.31, -0.15, 0); leftLeg.castShadow = true;
    character.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, material);
    rightLeg.position.set(0.31, -0.15, 0); rightLeg.castShadow = true;
    character.add(rightLeg);

    return character;
}

// ============================================================
// INSERT GLTF INTO SCENE
// ============================================================
function insertGLTFIntoScene(gltf, modelName = "Modelo", isFallback = false) {
    const model = gltf.scene;

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);

    model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) child.material.side = THREE.DoubleSide;
        }
    });

    const rootGroup = new THREE.Group();
    rootGroup.name = modelName;
    rootGroup.add(model);

    const size = box.getSize(new THREE.Vector3());
    rootGroup.position.set(0, size.y / 2, 0);

    scene.add(rootGroup);
    registerObject(rootGroup, modelName);

    if (!isFallback) showStatus(`${modelName} carregado!`);
}

// ============================================================
// INITIAL LOAD — tenta last_loaded.glb → mannequin → dummy
// ============================================================
gltfLoader.load("/noderig_assets/models/last_loaded.glb?t=" + Date.now(), (gltf) => {
    insertGLTFIntoScene(gltf, "last_loaded", true);
    console.log("Modelo anterior restaurado.");
}, undefined, () => {
    gltfLoader.load("/noderig_assets/characters/mannequin.gltf", (gltf) => {
        insertGLTFIntoScene(gltf, "Manequim", true);
    }, undefined, () => {
        // Último fallback: dummy primitivo
        const dummy = buildDummy();
        scene.add(dummy);
        registerObject(dummy, "Manequim");
        console.log("Usando manequim primitivo embutido.");
    });
});

// ============================================================
// USER MODEL UPLOAD
// ============================================================
const modelUploadInput = document.getElementById("model-upload");
const btnLoadModel = document.getElementById("btn-load");

if (btnLoadModel && modelUploadInput) {
    btnLoadModel.addEventListener("click", () => modelUploadInput.click());

    modelUploadInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const ext = file.name.split('.').pop().toLowerCase();
        if (ext !== 'glb' && ext !== 'gltf') {
            showStatus("Por favor suba um arquivo .glb ou .gltf", "error");
            return;
        }

        const modelName = file.name.replace(/\.[^/.]+$/, "");
        const url = URL.createObjectURL(file);
        showStatus("Processando modelo 3D...");

        gltfLoader.load(url, (gltf) => {
            insertGLTFIntoScene(gltf, modelName, false);

            // Salvar no backend para persistir entre sessões
            const formData = new FormData();
            formData.append("file", file);
            fetch("/NodeRing/UploadGLB", { method: "POST", body: formData })
                .then(r => r.json())
                .then(d => { if (d.status === "success") showStatus(`${modelName} salvo permanentemente!`); })
                .catch(err => console.error("Erro ao salvar GLB:", err));

        }, undefined, (error) => {
            console.error(error);
            showStatus("Erro ao ler o arquivo GLB/GLTF", "error");
        });

        // Limpa o input para permitir recarregar o mesmo arquivo
        e.target.value = "";
    });
}

// ============================================================
// MOUSE DRAG — move objeto ATIVO selecionado no scene graph
// Botão esquerdo: Arrastar objeto ativo
// Botão esquerdo sem objeto ativo: Orbit/Rotate (comportamento padrão)
// ============================================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const planeIntersect = new THREE.Vector3();
const dragOffset = new THREE.Vector3();

let isDragging = false;
let dragTarget = null;

window.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;

    // Se nenhum objeto estiver selecionado na lista, deixa o OrbitControls operar normalmente
    if (!activeItem) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Verificar se o click atingiu o objeto ativo
    const intersects = raycaster.intersectObject(activeItem.root, true);

    if (intersects.length > 0) {
        isDragging = true;
        dragTarget = activeItem.root;
        controls.enabled = false;

        dragPlane.setFromNormalAndCoplanarPoint(
            camera.getWorldDirection(dragPlane.normal),
            dragTarget.position
        );

        if (raycaster.ray.intersectPlane(dragPlane, planeIntersect)) {
            dragOffset.copy(planeIntersect).sub(dragTarget.position);
        }
    }
});

window.addEventListener("mouseup", () => {
    isDragging = false;
    dragTarget = null;
    controls.enabled = true;
});

window.addEventListener("mousemove", (e) => {
    if (!isDragging || !dragTarget) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    if (raycaster.ray.intersectPlane(dragPlane, planeIntersect)) {
        dragTarget.position.copy(planeIntersect.sub(dragOffset));
    }
});

// ============================================================
// RESOLUTION + RESIZE
// ============================================================
const resSelector = document.getElementById("res-selector");
let targetWidth = 1024;
let targetHeight = 1024;

function updateResolution() {
    if (resSelector) {
        const [w, h] = resSelector.value.split("x").map(Number);
        targetWidth = w;
        targetHeight = h;
    }

    camera.aspect = targetWidth / targetHeight;
    camera.updateProjectionMatrix();

    const scale = Math.min(window.innerWidth / targetWidth, window.innerHeight / targetHeight) * 0.95;

    renderer.setSize(targetWidth, targetHeight);

    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.width  = `${targetWidth  * scale}px`;
    renderer.domElement.style.height = `${targetHeight * scale}px`;
    renderer.domElement.style.left   = `${(window.innerWidth  - targetWidth  * scale) / 2}px`;
    renderer.domElement.style.top    = `${(window.innerHeight - targetHeight * scale) / 2}px`;
}

if (resSelector) resSelector.addEventListener("change", updateResolution);
window.addEventListener("resize", updateResolution);
updateResolution();

// ============================================================
// LIGHT SLIDER
// ============================================================
const lightSlider = document.getElementById("light-intensity");
const lightValEl  = document.getElementById("light-val");

if (lightSlider) {
    if (savedLight !== null) {
        lightSlider.value = savedLight;
        if (lightValEl) lightValEl.innerText = parseFloat(savedLight).toFixed(1);
    }

    lightSlider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        dirLight.intensity  = val;
        ambientLight.intensity = val * 0.5;
        localStorage.setItem("noderig_light", val);
        if (lightValEl) lightValEl.innerText = val.toFixed(1);
    });
}

// ============================================================
// STATUS TOAST
// ============================================================
const statusMsg = document.getElementById("status-message");
function showStatus(msg, type = "success") {
    statusMsg.innerText = msg;
    statusMsg.className = `status ${type} show`;
    setTimeout(() => { statusMsg.className = `status ${type}`; }, 3500);
}

// ============================================================
// EXPORT HELPER — respeita o toggle de fundo na exportação
// ============================================================
function renderForExport() {
    if (bgExportEnabled) {
        // Incluir fundo na saída
        renderer.render(scene, camera);
    } else {
        // Fundo somente visual — exporta com cor sólida
        const savedBg = scene.background;
        scene.background = SCENE_BG_SOLID;
        renderer.render(scene, camera);
        scene.background = savedBg;
    }
}


// ============================================================
// SAVE /input
// ============================================================
const btnSaveInput = document.getElementById("btn-save-input");
if (btnSaveInput) {
    btnSaveInput.addEventListener("click", async () => {
        const orig = btnSaveInput.innerHTML;
        btnSaveInput.textContent = "Salvando...";
        renderForExport();
        const dataURL = renderer.domElement.toDataURL("image/png");
        try {
            const res = await fetch("/NodeRing/SaveInput", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image_base64: dataURL })
            });
            if (res.ok) showStatus("Salvo na pasta /input!");
            else throw Error();
        } catch { showStatus("Erro ao salvar no /input", "error"); }
        finally { btnSaveInput.innerHTML = orig; }
    });
}

// ============================================================
// SEND TO NODE MEMORY
// ============================================================
const btnSendMemory = document.getElementById("btn-send-memory");
if (btnSendMemory) {
    btnSendMemory.addEventListener("click", async () => {
        const orig = btnSendMemory.innerHTML;
        btnSendMemory.textContent = "Enviando...";
        renderForExport();
        const dataURL = renderer.domElement.toDataURL("image/png");
        try {
            const res = await fetch("/NodeRing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    image_base64: dataURL,
                    background_base64: currentBgBase64 
                })
            });
            if (res.ok) showStatus("Enviado para Memória do Nó!");
            else throw Error();
        } catch { showStatus("Erro ao atualizar nó", "error"); }
        finally { btnSendMemory.innerHTML = orig; }
    });
}

/**
 * Sincronização rápida apenas do fundo
 */
async function syncBgWithBackend() {
    if (!currentBgBase64) return;
    try {
        await fetch("/NodeRing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                image_base64: renderer.domElement.toDataURL("image/png"), // Envia o frame atual também
                background_base64: currentBgBase64 
            })
        });
    } catch (e) {
        console.error("Erro ao sincronizar fundo:", e);
    }
}

// ============================================================
// GENERATE (Queue)
// ============================================================
const btnGenerate = document.getElementById("btn-generate");
if (btnGenerate) {
    btnGenerate.addEventListener("click", () => {
        if (btnSendMemory) btnSendMemory.click();
        setTimeout(() => {
            if (window.parent?.app?.queuePrompt) {
                window.parent.app.queuePrompt(0, 1);
                showStatus("Processamento Iniciado (Queue)!");
            } else {
                showStatus("ComfyUI não detectado no contexto.", "error");
            }
        }, 300);
    });
}

// ============================================================
// CLEAR SCENE MODAL
// ============================================================
const btnClear        = document.getElementById("btn-clear");
const modal           = document.getElementById("clear-modal");
const btnCancel       = document.getElementById("btn-cancel");
const btnConfirmClear = document.getElementById("btn-confirm-clear");

if (btnClear  && modal) btnClear.addEventListener("click",  () => modal.classList.add("active"));
if (btnCancel && modal) btnCancel.addEventListener("click", () => modal.classList.remove("active"));

if (btnConfirmClear && modal) {
    btnConfirmClear.addEventListener("click", () => {
        modal.classList.remove("active");

        sceneRegistry.forEach(item => scene.remove(item.root));
        sceneRegistry.length = 0;
        activeItem = null;

        isDragging = false;
        dragTarget = null;
        controls.enabled = true;

        refreshSceneGraph();

        fetch("/NodeRing/ClearGLB", { method: "POST" }).catch(() => {});
        showStatus("Cena limpa com sucesso!");
    });
}

// ============================================================
// BACKGROUND PLATE — imagem de fundo com opção de exportação
// ============================================================
const bgUploadInput      = document.getElementById("bg-upload");
const btnBgLoad          = document.getElementById("btn-bg-load");
const btnBgRemove        = document.getElementById("btn-bg-remove");
const btnBgExportToggle  = document.getElementById("btn-bg-export-toggle");

let bgExportEnabled = false; // false = somente visual, true = inclui na exportação
let currentBgBase64 = "";   // Base64 do fundo para saída separada

if (btnBgLoad && bgUploadInput) {
    btnBgLoad.addEventListener("click", () => bgUploadInput.click());

    bgUploadInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Converter para Base64 para sincronizar com o nó
        const reader = new FileReader();
        reader.onload = (re) => {
            currentBgBase64 = re.target.result;
            // Sincroniza imediatamente com o servidor para o output secundário do nó
            syncBgWithBackend();
        };
        reader.readAsDataURL(file);

        const url = URL.createObjectURL(file);
        const loader = new THREE.TextureLoader();
        loader.load(url, (texture) => {
            scene.background = texture;
            if (btnBgRemove)       btnBgRemove.style.display       = "";
            if (btnBgExportToggle) btnBgExportToggle.style.display = "";
            btnBgLoad.style.opacity = "0.65";
            showStatus(`Fundo '${file.name}' carregado.`);
        }, undefined, () => {
            showStatus("Erro ao carregar a imagem de fundo.", "error");
        });

        e.target.value = "";
    });
}

if (btnBgExportToggle) {
    btnBgExportToggle.addEventListener("click", () => {
        bgExportEnabled = !bgExportEnabled;
        if (bgExportEnabled) {
            btnBgExportToggle.classList.add("bg-export-toggle--on");
            btnBgExportToggle.title = "Fundo INCLUÍDO na exportação — clique para desativar";
            showStatus("Fundo será INCLUÍDO na exportação!");
        } else {
            btnBgExportToggle.classList.remove("bg-export-toggle--on");
            btnBgExportToggle.title = "Incluir fundo na exportação para o ComfyUI";
            showStatus("Fundo voltou a ser somente guia visual.");
        }
    });
}

if (btnBgRemove) {
    btnBgRemove.addEventListener("click", () => {
        scene.background = SCENE_BG_SOLID;
        currentBgBase64 = ""; // Limpa a referência do fundo
        syncBgWithBackend(); // Sincroniza a remoção (enviará string vazia)
        
        if (btnBgLoad)          btnBgLoad.style.opacity          = "";
        if (btnBgRemove)        btnBgRemove.style.display        = "none";
        if (btnBgExportToggle)  btnBgExportToggle.style.display  = "none";
        // Resetar o toggle ao remover o fundo
        bgExportEnabled = false;
        btnBgExportToggle.classList.remove("bg-export-toggle--on");
        showStatus("Fundo removido.");
    });
}

// ============================================================
// CAMERA DISTANCE HUD
// ============================================================
const hudDistVal = document.getElementById("hud-dist-val");
const hudFill    = document.getElementById("hud-fill");
const HUD_MAX_DIST = 30; // unidades Three.js (metros de cena)

function updateHUD() {
    if (!hudDistVal || !hudFill) return;
    const dist = camera.position.distanceTo(controls.target);
    hudDistVal.textContent = dist.toFixed(2);
    const pct = Math.min((dist / HUD_MAX_DIST) * 100, 100);
    hudFill.style.width = pct + "%";

    // Cor da barra: verde → âmbar → vermelho conforme a distância
    if (pct < 40)       hudFill.style.background = "linear-gradient(90deg, #34d399, #6ee7b7)";
    else if (pct < 75)  hudFill.style.background = "linear-gradient(90deg, #fbbf24, #f59e0b)";
    else                hudFill.style.background = "linear-gradient(90deg, #f87171, #ef4444)";
}

// ============================================================
// ANIMATION LOOP
// ============================================================
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    updateHUD();
    renderer.render(scene, camera);
}
animate();
console.log("NodeRig Editor v4.2 Initialized");
