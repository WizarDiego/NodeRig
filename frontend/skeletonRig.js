// ============================================================
// SKELETON RIG v3 — Detecção, Visualização e Controle de Pose
// Extensão modular para o NodeRig
// ============================================================

(function () {
    "use strict";

    // ============================================================
    // ESTADO DO MÓDULO
    // ============================================================
    var skeletonBones = [];
    var selectedBone = null;
    var jointHelpers = [];
    var boneLines = [];
    var skeletonGroup = null;
    var transformCtrl = null;
    var isSkeletonActive = false;
    var currentModel = null;
    var isOverlayVisible = true;
    var currentMode = "rotate";      // "rotate", "translate", "scale"
    var isDraggingGizmo = false;
    var skinnedMeshes = [];          // SkinnedMesh encontrados no modelo
    var originalTransforms = {};     // Pose original dos bones {boneName: {pos, rot, scl}}
    var isIKEnabled = false;         // Estado da Cinemática Inversa
    var jointToBoneMap = new Map();
    var skeletonRaycaster = new THREE.Raycaster();
    var skeletonMouse = new THREE.Vector2();

    var selectedBoneB     = null;        // Segundo bone (par)
    var isBoneLinkEnabled = false;       // Sincronizar transformações A→B
    var isMirrorEnabled   = false;       // Espelhar A→B
    var mirrorAxis        = "YZ";        // Eixos negados no mirror (padrão Blender L/R)
    var uniformScale      = false;       // Escala uniforme X=Y=Z
    var BONE_B_COLOR      = 0xa78bfa;    // Roxo para Bone B

    var currentModelName = "default";
    var savedPairs = {};             // {modelName: [{a, b}, ...]}
    var topZIndex = 100;

    // ============================================================
    // IK STATE
    // ============================================================
    var ikSolver      = null;        // THREE.CCDIKSolver instance
    var ikChains      = [];          // Array de cadeias IK detectadas
    var ikTargets     = [];          // Spheres visuais que o usuário arrasta
    var ikTargetGroup = null;        // Group Three.js que contém os targets
    var ikDragTarget  = null;        // Target sendo arrastado agora
    var ikDragPlane   = new THREE.Plane();
    var ikDragOffset  = new THREE.Vector3();
    var ikDragMouse   = new THREE.Vector2();

    var COLORS = {
        joint: 0xff8c00,
        jointSelected: 0x00ff88,
        bone: 0x00e5ff,
        ikTarget: 0x00cfff
    };

    // ============================================================
    // MÓDULO 1 — DETECÇÃO DE ESQUELETO
    // ============================================================

    function detectSkeleton(object3D) {
        var bones = [];
        var meshes = [];

        object3D.traverse(function (child) {
            if (child.isBone) {
                bones.push(child);
            }
            if (child.isSkinnedMesh) {
                meshes.push(child);
            }
        });

        skinnedMeshes = meshes;

        if (bones.length > 0) {
            console.log("[SkeletonRig] " + bones.length + " bones, " + meshes.length + " skinned meshes detectados.");
        }
        return bones;
    }

    /**
     * Salva a pose original (bind pose) de todos os bones para poder resetar depois.
     * Também salva a boneInverse para garantir que a pose de repouso do skinning está correta.
     */
    function saveOriginalTransforms(bones) {
        originalTransforms = {};
        bones.forEach(function (bone) {
            originalTransforms[bone.uuid] = {
                px: bone.position.x, py: bone.position.y, pz: bone.position.z,
                rx: bone.rotation.x, ry: bone.rotation.y, rz: bone.rotation.z,
                sx: bone.scale.x,    sy: bone.scale.y,    sz: bone.scale.z
            };
        });
        
        // Se há SkinnedMeshes, garantir que o bind pose está configurado corretamente.
        // Isso corrige modelos GLTF que não têm boneMatrices inicializadas.
        skinnedMeshes.forEach(function (mesh) {
            if (mesh.skeleton) {
                mesh.skeleton.calculateInverses();
                mesh.skeleton.update();
            }
        });
    }

    // ============================================================
    // MÓDULO 2 — VISUALIZAÇÃO DO ESQUELETO
    // ============================================================

    function calculateJointRadius(object3D) {
        var box = new THREE.Box3().setFromObject(object3D);
        var size = box.getSize(new THREE.Vector3());
        var maxDim = Math.max(size.x, size.y, size.z);
        return Math.max(0.015, Math.min(0.08, maxDim * 0.015));
    }

    function createSkeletonVisualization(bones, object3D) {
        clearSkeletonVisualization();

        skeletonGroup = new THREE.Group();
        skeletonGroup.name = "__SkeletonRigOverlay__";
        skeletonGroup.renderOrder = 999;

        var jointRadius = calculateJointRadius(object3D);
        var jointGeometry = new THREE.SphereGeometry(jointRadius, 12, 12);
        var jointMaterial = new THREE.MeshBasicMaterial({
            color: COLORS.joint, transparent: true, opacity: 0.85, depthTest: false
        });

        bones.forEach(function (bone) {
            var sphere = new THREE.Mesh(jointGeometry.clone(), jointMaterial.clone());
            sphere.name = "__joint_" + bone.name;
            sphere.userData.isSkelJoint = true;
            sphere.userData.boneName = bone.name;

            var worldPos = new THREE.Vector3();
            bone.getWorldPosition(worldPos);
            sphere.position.copy(worldPos);

            skeletonGroup.add(sphere);
            jointHelpers.push(sphere);
            jointToBoneMap.set(sphere, bone);
        });

        var lineMaterial = new THREE.LineBasicMaterial({
            color: COLORS.bone, transparent: true, opacity: 0.6, depthTest: false
        });

        bones.forEach(function (bone) {
            if (bone.parent && bone.parent.isBone) {
                var geometry = new THREE.BufferGeometry();
                var positions = new Float32Array(6);
                geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
                var line = new THREE.Line(geometry, lineMaterial.clone());
                line.userData.childBone = bone;
                line.userData.parentBone = bone.parent;
                line.frustumCulled = false;
                skeletonGroup.add(line);
                boneLines.push(line);
            }
        });

        scene.add(skeletonGroup);
        isSkeletonActive = true;

        showSkeletonBadge(bones.length);
        createToggleButton();
        createBoneControlPanel();
    }

    function clearSkeletonVisualization() {
        if (skeletonGroup) {
            scene.remove(skeletonGroup);
            skeletonGroup.traverse(function (child) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            skeletonGroup = null;
        }
        jointHelpers = [];
        boneLines = [];
        jointToBoneMap.clear();
        selectedBone       = null;
        selectedBoneB      = null;
        isBoneLinkEnabled  = false;
        isMirrorEnabled    = false;
        uniformScale       = false;
        isSkeletonActive   = false;
        skinnedMeshes      = [];
        originalTransforms = {};

        if (transformCtrl) transformCtrl.detach();

        hideSkeletonBadge();
        hideBoneLabel();
        hideToggleButton();
        hideBoneControlPanel();
        isOverlayVisible = true;
    }

    function updateSkeletonVisualization() {
        if (!isSkeletonActive || !skeletonGroup) return;

        var worldPos = new THREE.Vector3();
        var parentPos = new THREE.Vector3();

        // Atualiza posição dos helpers (esferas) para seguir os bones
        jointHelpers.forEach(function (sphere) {
            var bone = jointToBoneMap.get(sphere);
            if (bone) {
                bone.getWorldPosition(worldPos);
                sphere.position.copy(worldPos);
            }
        });

        // Atualiza as linhas de conexão entre bones
        boneLines.forEach(function (line) {
            var childBone = line.userData.childBone;
            var parentBone = line.userData.parentBone;
            if (childBone && parentBone) {
                childBone.getWorldPosition(worldPos);
                parentBone.getWorldPosition(parentPos);
                var p = line.geometry.attributes.position.array;
                p[0] = parentPos.x; p[1] = parentPos.y; p[2] = parentPos.z;
                p[3] = worldPos.x;  p[4] = worldPos.y;  p[5] = worldPos.z;
        // Sync sliders se bone selecionado e gizmo sendo arrastado
        if (selectedBone && isDraggingGizmo) {
            updateSlidersFromBone();
        }

        // Sincroniza posição visual dos targets IK
        syncIKTargets();

        // Deformação da malha: atualiza o skeleton no loop de renderização
        // Isso garante que o GPU receba as boneMatrices atualizadas a cada frame
        forceSkeletonUpdate();
    }

    // ============================================================
    // MÓDULO — ATUALIZAÇÃO DE MALHA (SKINNED MESH)
    // ============================================================

    /**
     * Faz a deformação real da malha acontecer.
     * Precisa ser chamado no loop de animação e sempre que um bone muda.
     * A ordem correta é:
     *   1. updateMatrixWorld da raiz do esqueleto
     *   2. skeleton.update()  → recalcula Bone Matrices para o GPU
     */
    function forceSkeletonUpdate() {
        skinnedMeshes.forEach(function (mesh) {
            if (!mesh.skeleton) return;
            
            // 1. Propaga as matrizes de mundo pelo grafo de cena inteiro do mesh
            //    Isso garante que rotações de bones pais cheguem aos filhos.
            if (mesh.parent) {
                mesh.parent.updateMatrixWorld(true);
            } else {
                mesh.updateMatrixWorld(true);
            }
 
            // 2. Atualiza as boneMatrices que serão enviadas ao shader de skinning
            mesh.skeleton.update();
        });
    }

    /**
     * Chamado após qualquer mudança manual via sliders/gizmo/reset.
     * Propaga as transformações pela hierarquia dos bones e deforma a malha.
     */
    function propagateBoneChange() {
        if (selectedBone) {
            // Propaga a partir do bone alterado para baixo na hierarquia
            selectedBone.updateMatrixWorld(true);
            
            // Aplica tambem ao Bone B se Link ou Mirror estiver ativo
            if (isBoneLinkEnabled && selectedBoneB) {
                selectedBoneB.updateMatrixWorld(true);
            }
        }
        
        // Atualiza todos os SkinnedMesh (deformação da malha)
        forceSkeletonUpdate();
    }

    /**
     * Algoritmo de Skinning Automático (Auto-Rig).
     * Vincula uma malha estática a um esqueleto baseado na proximidade dos vértices aos segmentos dos ossos.
     */
    function bindStaticMeshToSkeleton(mesh, bones) {
        if (!mesh || !bones || bones.length === 0) return;
        if (mesh.isSkinnedMesh) {
            console.warn("[SkeletonRig] Objeto já é uma SkinnedMesh.");
            return;
        }

        console.log("[SkeletonRig] Iniciando Auto-Rig para: " + mesh.name);

        // Garante que a geometria seja BufferGeometry
        var geometry = mesh.geometry;
        if (!geometry.isBufferGeometry) {
            console.error("[SkeletonRig] Apenas BufferGeometry é suportado.");
            return;
        }

        var position = geometry.attributes.position;
        var vertexCount = position.count;
        var skinIndices = new Uint16Array(vertexCount * 4);
        var skinWeights = new Float32Array(vertexCount * 4);

        var v = new THREE.Vector3();
        var boneStart = new THREE.Vector3();
        var boneEnd = new THREE.Vector3();
        var line = new THREE.Line3();
        var closestPoint = new THREE.Vector3();

        // 1. Mapear ossos para índices
        var boneToIndex = new Map();
        bones.forEach((b, idx) => boneToIndex.set(b, idx));

        // 2. Pré-calcular segmentos dos ossos no espaço local da malha
        var invMeshWorld = mesh.matrixWorld.clone().invert();
        var segments = bones.map(function(bone) {
            bone.getWorldPosition(boneStart);
            // Se tiver filho, o segmento vai até o primeiro filho osso. Se não, é um ponto.
            var childBone = bone.children.find(c => c.isBone);
            if (childBone) {
                childBone.getWorldPosition(boneEnd);
            } else {
                // Se for ponta, cria um pequeno segmento na direção do pai
                boneEnd.copy(boneStart).add(new THREE.Vector3(0, 0.05, 0)); 
            }
            
            return {
                index: boneToIndex.get(bone),
                line: new THREE.Line3(boneStart.applyMatrix4(invMeshWorld), boneEnd.applyMatrix4(invMeshWorld))
            };
        });

        // 3. Processar vértices (Proximidade)
        for (var i = 0; i < vertexCount; i++) {
            v.fromBufferAttribute(position, i);
            
            var minDist = Infinity;
            var bestBoneIdx = 0;

            for (var s = 0; s < segments.length; s++) {
                var seg = segments[s];
                seg.line.closestPointToPoint(v, true, closestPoint);
                var d = v.distanceToSquared(closestPoint);
                if (d < minDist) {
                    minDist = d;
                    bestBoneIdx = seg.index;
                }
            }

            // Atribui influência 100% ao osso mais próximo (Rigid Skinning)
            // Futuramente podemos suavizar entre os 4 mais próximos
            var idx4 = i * 4;
            skinIndices[idx4] = bestBoneIdx;
            skinWeights[idx4] = 1.0;
        }

        // 4. Aplicar Atributos
        geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
        geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));

        // 5. Criar SkinnedMesh
        var skinnedMesh = new THREE.SkinnedMesh(geometry, mesh.material);
        skinnedMesh.name = mesh.name + "_Rigged";
        skinnedMesh.position.copy(mesh.position);
        skinnedMesh.quaternion.copy(mesh.quaternion);
        skinnedMesh.scale.copy(mesh.scale);
        
        var skeleton = new THREE.Skeleton(bones);
        skinnedMesh.add(bones[0].root || bones[0]); // Adiciona a raiz do esqueleto se necessário, ou apenas vincula
        skinnedMesh.bind(skeleton);

        // 6. Substituir na cena
        var parent = mesh.parent;
        if (parent) {
            parent.add(skinnedMesh);
            parent.remove(mesh);
        }

        // Atualiza referências do módulo
        skinnedMeshes.push(skinnedMesh);
        if (typeof showStatus === "function") showStatus("Malha vinculada com sucesso!");
        
        return skinnedMesh;
    }

    // ============================================================
    // MÓDULO — CINEMÁTICA INVERSA (IK) com CCDIKSolver
    // ============================================================

    /**
     * Padrões de nome para detectar effectors (extremidades das cadeias).
     * Suporte a: Blender (.L/.R), Mixamo (LeftHand/RightFoot), etc.
     */
    var IK_EFFECTOR_PATTERNS = [
        // Mãos
        { re: /hand[_\.]?l/i,   label: "Mão Esq.",  chainLen: 3 },
        { re: /hand[_\.]?r/i,   label: "Mão Dir.",  chainLen: 3 },
        { re: /hand\.l$/i,      label: "Mão Esq.",  chainLen: 3 },
        { re: /hand\.r$/i,      label: "Mão Dir.",  chainLen: 3 },
        // Pés
        { re: /foot[_\.]?l/i,   label: "Pé Esq.",   chainLen: 3 },
        { re: /foot[_\.]?r/i,   label: "Pé Dir.",   chainLen: 3 },
        { re: /foot\.l$/i,      label: "Pé Esq.",   chainLen: 3 },
        { re: /foot\.r$/i,      label: "Pé Dir.",   chainLen: 3 },
        // Cabeça
        { re: /^head$/i,         label: "Cabeça",    chainLen: 2 },
    ];

    /**
     * Detecta automaticamente as cadeias IK a partir dos nomes dos bones.
     * Retorna um array de objetos {effectorBone, links[], label}.
     */
    function detectIKChains(bones) {
        var chains = [];
        var usedEffectors = new Set();

        bones.forEach(function(bone) {
            IK_EFFECTOR_PATTERNS.forEach(function(pat) {
                if (pat.re.test(bone.name) && !usedEffectors.has(bone.uuid)) {
                    // Constrói a cadeia subindo na hierarquia
                    var links = [];
                    var curr = bone.parent;
                    for (var i = 0; i < pat.chainLen && curr && curr.isBone; i++) {
                        links.push(curr);
                        curr = curr.parent;
                    }
                    if (links.length > 0) {
                        chains.push({ effector: bone, links: links, label: pat.label });
                        usedEffectors.add(bone.uuid);
                    }
                }
            });
        });
        return chains;
    }

    /**
     * Monta o CCDIKSolver do Three.js a partir das cadeias detectadas.
     * Cria um target visual (esfera azul) para cada cadeia.
     */
    function initIKSolver(bones) {
        // Limpa IK anterior se houver
        disposeIK();

        if (typeof THREE.CCDIKSolver === "undefined") {
            console.warn("[IK] CCDIKSolver não disponível.");
            return;
        }

        // Precisa de pelo menos um SkinnedMesh para o solver funcionar
        if (skinnedMeshes.length === 0) {
            console.warn("[IK] Nenhum SkinnedMesh encontrado. IK desativado.");
            return;
        }

        var mesh = skinnedMeshes[0];
        var skeleton = mesh.skeleton;
        var boneNameToIdx = {};
        skeleton.bones.forEach(function(b, i) { boneNameToIdx[b.name] = i; });

        ikChains = detectIKChains(bones);
        if (ikChains.length === 0) {
            console.warn("[IK] Nenhuma cadeia IK detectada nos nomes dos bones.");
            return;
        }

        ikTargetGroup = new THREE.Group();
        ikTargetGroup.name = "__IKTargets__";
        scene.add(ikTargetGroup);

        var targetGeo = new THREE.SphereGeometry(0.04, 12, 12);

        var iksConfig = [];
        ikChains.forEach(function(chain, ci) {
            var effIdx = boneNameToIdx[chain.effector.name];
            if (effIdx === undefined) return;

            // Cria target visual (esfera azul cyan)
            var targetMat = new THREE.MeshBasicMaterial({
                color: COLORS.ikTarget, transparent: true, opacity: 0.85, depthTest: false
            });
            var targetMesh = new THREE.Mesh(targetGeo.clone(), targetMat);
            targetMesh.name = "__ikTarget_" + ci + "__";
            targetMesh.userData.ikChainIdx = ci;
            targetMesh.renderOrder = 998;

            // Posiciona no local atual do effector
            chain.effector.getWorldPosition(targetMesh.position);
            ikTargetGroup.add(targetMesh);
            ikTargets.push(targetMesh);

            // Configura links para o CCDIKSolver
            var links = chain.links.map(function(lb) {
                var idx = boneNameToIdx[lb.name];
                return { index: idx };
            }).filter(function(l) { return l.index !== undefined; });

            if (links.length > 0) {
                iksConfig.push({
                    target: ikTargets.length - 1,  // Índice do target bone no skeleton
                    effector: effIdx,
                    links: links,
                    iteration: 10,
                    minAngle: 0.0,
                    maxAngle: 1.0
                });
            }
        });

        if (iksConfig.length === 0) {
            console.warn("[IK] Nenhuma configuração IK montada.");
            return;
        }

        // O solver trabalha com bones do skeleton, mas precisamos de bones no skeleton
        // para os targets. Como usamos meshes de cena como targets, usamos nossa solveDynamicIK
        // integrada com o helper de targets visuais.
        // OBS: CCDIKSolver requer que os targets sejam bones no skeleton;
        // como usamos Objects3D externos, mantemos solveDynamicIK + targets visuais.
        ikSolver = { chains: ikChains, targets: ikTargets, active: true };

        console.log("[IK] " + ikChains.length + " cadeias IK montadas: " +
            ikChains.map(function(c){ return c.label; }).join(", "));

        // Configurar arrastar os targets
        setupIKTargetDrag();
    }

    function disposeIK() {
        if (ikTargetGroup) {
            scene.remove(ikTargetGroup);
            ikTargetGroup.traverse(function(c) {
                if (c.geometry) c.geometry.dispose();
                if (c.material) c.material.dispose();
            });
            ikTargetGroup = null;
        }
        ikTargets = [];
        ikChains = [];
        ikSolver = null;
        ikDragTarget = null;
    }

    /**
     * Configura o arrastar dos targets IK com raycaster dedicado.
     */
    function setupIKTargetDrag() {
        var raycaster = new THREE.Raycaster();
        var mouse = new THREE.Vector2();
        var isDragging = false;

        renderer.domElement.addEventListener("pointerdown", function(e) {
            if (!isIKEnabled || !ikTargetGroup || e.button !== 0) return;

            mouse.x = ((e.clientX - renderer.domElement.getBoundingClientRect().left) / renderer.domElement.getBoundingClientRect().width) * 2 - 1;
            mouse.y = -((e.clientY - renderer.domElement.getBoundingClientRect().top) / renderer.domElement.getBoundingClientRect().height) * 2 + 1;

            raycaster.setFromCamera(mouse, camera);
            var hits = raycaster.intersectObjects(ikTargets, false);
            if (hits.length > 0) {
                ikDragTarget = hits[0].object;
                isDragging = true;
                isDraggingGizmo = true; // Inibe orbit
                controls.enabled = false;

                // Plano de drag na profundidade atual do target
                ikDragPlane.setFromNormalAndCoplanarPoint(
                    camera.getWorldDirection(new THREE.Vector3()),
                    ikDragTarget.position
                );
                e.stopPropagation();
            }
        });

        renderer.domElement.addEventListener("pointermove", function(e) {
            if (!isDragging || !ikDragTarget) return;

            mouse.x = ((e.clientX - renderer.domElement.getBoundingClientRect().left) / renderer.domElement.getBoundingClientRect().width) * 2 - 1;
            mouse.y = -((e.clientY - renderer.domElement.getBoundingClientRect().top) / renderer.domElement.getBoundingClientRect().height) * 2 + 1;

            raycaster.setFromCamera(mouse, camera);
            var pt = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(ikDragPlane, pt)) {
                ikDragTarget.position.copy(pt);

                // Resolve IK para a cadeia correspondente
                var ci = ikDragTarget.userData.ikChainIdx;
                if (ci !== undefined && ikChains[ci]) {
                    solveDynamicIK(ikChains[ci].effector, pt, ikChains[ci].links.length, 12);
                    propagateBoneChange();
                    updateSlidersFromBone();
                }
            }
        });

        window.addEventListener("pointerup", function() {
            if (isDragging) {
                isDragging = false;
                ikDragTarget = null;
                controls.enabled = true;
                isDraggingGizmo = false;
            }
        });
    }

    /**
     * Atualiza posição dos targets IK no loop (segue o osso quando não está em drag).
     */
    function syncIKTargets() {
        if (!isIKEnabled || !ikTargetGroup) return;
        ikChains.forEach(function(chain, ci) {
            var target = ikTargets[ci];
            if (target && target !== ikDragTarget) {
                // Quando não está sendo arrastado, o target segue o effector
                chain.effector.getWorldPosition(target.position);
            }
        });
    }

    /**
     * Ativa ou desativa o modo IK.
     */
    function setIKEnabled(state) {
        isIKEnabled = state;
        if (state) {
            if (ikChains.length === 0 && skeletonBones.length > 0) {
                initIKSolver(skeletonBones);
            }
            if (ikTargetGroup) ikTargetGroup.visible = true;
            if (transformCtrl) transformCtrl.setMode("translate");
            if (typeof showStatus === "function") {
                showStatus("IK Ativo — " + ikChains.length + " alvo(s) detectado(s)");
            }

            // Mostrar instrução para o usuário
            console.log("[IK] Arraste as esferas azuis para mover os membros.");
        } else {
            if (ikTargetGroup) ikTargetGroup.visible = false;
            if (transformCtrl && currentMode) transformCtrl.setMode(currentMode);
            if (typeof showStatus === "function") showStatus("IK Desativado");
        }
    }

    function solveDynamicIK(effectorBone, targetPosition, chainLength, iterations) {
        if (!effectorBone || !effectorBone.parent) return;
        
        chainLength = chainLength || 2;
        iterations = iterations || 5;

        var chain = [];
        var curr = effectorBone.parent;
        for (var i = 0; i < chainLength; i++) {
            if (!curr || !curr.isBone) break;
            chain.push(curr);
            curr = curr.parent;
        }
        if (chain.length === 0) return;

        var effectorPos = new THREE.Vector3();
        var jointPos = new THREE.Vector3();
        var vEffector = new THREE.Vector3();
        var vTarget = new THREE.Vector3();
        var axis = new THREE.Vector3();
        var q = new THREE.Quaternion();

        for (var itr = 0; itr < iterations; itr++) {
            for (var i = 0; i < chain.length; i++) {
                var joint = chain[i];
                joint.updateMatrixWorld(true);
                effectorBone.updateMatrixWorld(true);

                effectorPos.setFromMatrixPosition(effectorBone.matrixWorld);
                jointPos.setFromMatrixPosition(joint.matrixWorld);

                vEffector.subVectors(effectorPos, jointPos).normalize();
                vTarget.subVectors(targetPosition, jointPos).normalize();

                var angle = vEffector.angleTo(vTarget);
                if (angle > 0.0001) {
                    axis.crossVectors(vEffector, vTarget).normalize();
                    var invRot = joint.parent
                        ? joint.parent.matrixWorld.clone().extractRotation(joint.parent.matrixWorld).invert()
                        : new THREE.Matrix4();
                    axis.transformDirection(invRot);
                    var step = Math.min(angle, 0.5);
                    q.setFromAxisAngle(axis, step);
                    joint.quaternion.multiplyQuaternions(q, joint.quaternion);
                    joint.updateMatrixWorld(true);
                }
            }
        }
    }

    // ============================================================
    // MÓDULO 3 — SELEÇÃO DE BONE
    // ============================================================

    function handleJointSelection(event) {
        if (!isSkeletonActive || jointHelpers.length === 0) return false;
        if (!isOverlayVisible) return false;

        var rect = renderer.domElement.getBoundingClientRect();
        skeletonMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        skeletonMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        skeletonRaycaster.setFromCamera(skeletonMouse, camera);
        var intersects = skeletonRaycaster.intersectObjects(jointHelpers, false);

        if (intersects.length > 0) {
            var hitSphere = intersects[0].object;
            var bone = jointToBoneMap.get(hitSphere);
            if (bone) {
                if (event.shiftKey) {
                    selectBoneB(bone);
                    if (typeof showStatus === "function") showStatus("Bone B selecionado: " + bone.name);
                } else {
                    selectBone(bone, hitSphere);
                }
                return true;
            }
        }
        return false;
    }

    function selectBone(bone, sphere) {
        // Reset visual do joint anterior (Bone A)
        if (selectedBone) {
            jointHelpers.forEach(function (jh) {
                if (jointToBoneMap.get(jh) === selectedBone) {
                    jh.material.color.setHex(COLORS.joint);
                }
            });
        }

        selectedBone = bone;

        // Encontra a esfera se não foi passada
        if (!sphere) {
            jointHelpers.forEach(function (jh) {
                if (jointToBoneMap.get(jh) === bone) sphere = jh;
            });
        }

        if (sphere) sphere.material.color.setHex(COLORS.jointSelected);

        // Re-aplica cor do Bone B (pode ter sido resetada acima se coincidiu)
        if (selectedBoneB && selectedBoneB !== bone) {
            jointHelpers.forEach(function (jh) {
                if (jointToBoneMap.get(jh) === selectedBoneB) {
                    jh.material.color.setHex(BONE_B_COLOR);
                }
            });
        }

        // Attach TransformControls — apenas Bone A
        if (transformCtrl) {
            transformCtrl.attach(bone);
            transformCtrl.setMode(currentMode);
        }

        showBoneLabel(bone.name);
        showBoneControlPanel();
        updateSlidersFromBone();
        updateBoneSelector();

        console.log("[SkeletonRig] Bone A selecionado: " + bone.name);
    }

    /**
     * Seleciona um bone pelo nome (usado pelo dropdown).
     */
    function selectBoneByName(boneName) {
        for (var i = 0; i < skeletonBones.length; i++) {
            if (skeletonBones[i].name === boneName) {
                selectBone(skeletonBones[i], null);
                return;
            }
        }
    }

    function deselectBone() {
        if (selectedBone) {
            jointHelpers.forEach(function (jh) {
                if (jointToBoneMap.get(jh) === selectedBone) {
                    jh.material.color.setHex(COLORS.joint);
                }
            });
            selectedBone = null;
        }
        // Tambem remove o Bone B
        if (selectedBoneB) {
            jointHelpers.forEach(function (jh) {
                if (jointToBoneMap.get(jh) === selectedBoneB) {
                    jh.material.color.setHex(COLORS.joint);
                }
            });
            selectedBoneB = null;
        }
        isBoneLinkEnabled = false;
        isMirrorEnabled   = false;
        if (transformCtrl) transformCtrl.detach();
        hideBoneLabel();
        hideBoneControlPanel();
    }

    // ============================================================
    // MÓDULO 4 — TransformControls
    // ============================================================

    function initTransformControls() {
        if (typeof THREE.TransformControls === "undefined") {
            console.warn("[SkeletonRig] TransformControls não disponível.");
            return;
        }

        transformCtrl = new THREE.TransformControls(camera, renderer.domElement);
        transformCtrl.setMode("rotate");
        transformCtrl.setSize(0.75);
        transformCtrl.setSpace("local");
        scene.add(transformCtrl);

        transformCtrl.addEventListener("dragging-changed", function (event) {
            isDraggingGizmo = event.value;
            controls.enabled = !event.value;
        });

        transformCtrl.addEventListener("change", function () {
            if (selectedBone && isDraggingGizmo) {
                if (isIKEnabled && currentMode === "translate") {
                    // Tenta resgatar a translação atual solicitada pelo gizmo
                    var targetPos = new THREE.Vector3();
                    selectedBone.getWorldPosition(targetPos);
                    
                    // IK: O osso alvo (ex: mão) não deve esticar (deslocar da origem mãe). 
                    // Reverte a translação local para a pose de repouso antes do solve.
                    var orig = originalTransforms[selectedBone.uuid];
                    if (orig) {
                        selectedBone.position.set(orig.px, orig.py, orig.pz);
                    } else {
                        selectedBone.position.set(0, 0, 0);
                    }
                    selectedBone.updateMatrixWorld(true);
                    
                    // Aplica IK dinâmico nos parentes
                    solveDynamicIK(selectedBone, targetPos, 2, 8);
                }
                
                updateSlidersFromBone();
                propagateBoneChange();
            }
        });

        console.log("[SkeletonRig] TransformControls inicializado.");
    }

    function setMode(mode) {
        currentMode = mode;
        if (transformCtrl) transformCtrl.setMode(mode);
        updateModeButtons();
        updateSlidersFromBone();
    }

    // ============================================================
    // MÓDULO 5 — SISTEMA DE EVENTOS
    // ============================================================

    function onSkeletonMouseDown(event) {
        if (event.button !== 0) return;
        
        // Bloqueia se clicou em elementos de UI
        if (event.target.closest(".dock, .scene-panel, .modal-overlay, .skeleton-badge, .bone-label, .skeleton-toggle, .bone-control-panel, .camera-hud")) {
            return;
        }
        
        if (!isSkeletonActive || !isOverlayVisible) return;

        // Se o gizmo está ativo, checa se clicamos nele primeiro para não trocar seleção acidentalmente
        if (transformCtrl && transformCtrl.object) {
            var rect = renderer.domElement.getBoundingClientRect();
            skeletonMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            skeletonMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            skeletonRaycaster.setFromCamera(skeletonMouse, camera);
            
            // Intersectamos os filhos do transformCtrl para ver se clicou nas setas/aros
            var gizmoHits = skeletonRaycaster.intersectObjects(transformCtrl.children, true);
            if (gizmoHits.length > 0) {
                // Estamos interagindo com o gizmo, não mexe na seleção por clique
                return;
            }
        }

        // Se chegamos aqui, ou não há gizmo ou clicamos fora dele
        var handled = handleJointSelection(event);
        if (!handled && !event.shiftKey) {
            // Se clicar no vazio e sem Shift, deseleciona Bone A (e oculta painel)
            deselectBone();
        }
    }

    function setupEventListeners() {
        // Usamos pointerdown direto, sem timeout, para garantir resposta imediata.
        // A lógica de intersecção do Gizmo acima cuida de não conflitar.
        renderer.domElement.addEventListener("pointerdown", function (event) {
            if (event.button !== 0) return;
            if (!isSkeletonActive || !isOverlayVisible) return;
            
            // Pequeno delay para permitir que o TransformControls capture se for o caso
            // mas reduzido para sentir "direto"
            setTimeout(function() {
                if (!isDraggingGizmo) onSkeletonMouseDown(event);
            }, 30);
        });

        // Garantia de reset para evitar que o gizmo trave a seleção
        window.addEventListener("pointerup", function() {
            isDraggingGizmo = false;
        });
    }

    // ============================================================
    // MÓDULO 6 — INTEGRAÇÃO
    // ============================================================

    function hookIntoModelLoading() {
        var originalInsertGLTF = window.insertGLTFIntoScene;
        if (typeof originalInsertGLTF !== "function") {
            setupSceneObserver();
            return;
        }
        window.insertGLTFIntoScene = function (gltf, modelName, isFallback) {
            originalInsertGLTF.call(this, gltf, modelName, isFallback);
            processModelForSkeleton(gltf.scene);
        };
    }

    function setupSceneObserver() {
        var lastCheckedCount = 0;
        setInterval(function () {
            if (typeof sceneRegistry !== "undefined" && sceneRegistry.length !== lastCheckedCount) {
                lastCheckedCount = sceneRegistry.length;
                if (sceneRegistry.length > 0) {
                    processModelForSkeleton(sceneRegistry[sceneRegistry.length - 1].root);
                }
            }
        }, 1000);
    }

    function processModelForSkeleton(object3D) {
        var bones = detectSkeleton(object3D);
        if (bones.length > 0) {
            skeletonBones = bones;
            currentModel = object3D;
            currentModelName = object3D.name || "UnknownModel";
            saveOriginalTransforms(bones);
            createSkeletonVisualization(bones, object3D);
            if (!transformCtrl) initTransformControls();

            // Carrega pares salvos para este modelo
            loadSavedPairs();

            // Informa se o modelo suporta deformação ou não
            var hasSkinning = skinnedMeshes.length > 0;
            var msg = "Rig detectado: " + bones.length + " bones";
            if (hasSkinning) {
                msg += " | " + skinnedMeshes.length + " malha(s) com skinning ✓";
            } else {
                msg += " | Sem skinning (mesh estática)";
            }
            console.log("[SkeletonRig] " + msg);
            if (typeof showStatus === "function") showStatus(msg);
        }
    }

    function hookIntoClearScene() {
        var btn = document.getElementById("btn-confirm-clear");
        if (btn) {
            btn.addEventListener("click", function () {
                clearSkeletonVisualization();
                skeletonBones = [];
                currentModel = null;
                if (transformCtrl) transformCtrl.detach();
            });
        }
    }

    function hookIntoObjectRemoval() {
        var list = document.getElementById("scene-list");
        if (list) {
            list.addEventListener("click", function (event) {
                if (event.target.classList.contains("scene-item-remove")) {
                    setTimeout(function () {
                        if (currentModel && !currentModel.parent) {
                            clearSkeletonVisualization();
                            skeletonBones = [];
                            currentModel = null;
                        }
                    }, 100);
                }
            });
        }
    }

    // ============================================================
    // UI — Badge + Label
    // ============================================================

    function showSkeletonBadge(count) {
        var b = document.getElementById("skeleton-badge");
        if (!b) {
            b = document.createElement("div");
            b.id = "skeleton-badge";
            b.className = "skeleton-badge";
            document.body.appendChild(b);
        }
        b.innerHTML = '<span class="skeleton-badge-icon">\uD83E\uDDB4</span>' +
            '<span class="skeleton-badge-text">Rig Detectado \u00B7 ' + count + ' bones</span>';
        b.classList.add("active");
    }

    function hideSkeletonBadge() {
        var b = document.getElementById("skeleton-badge");
        if (b) b.classList.remove("active");
    }

    function formatBoneName(name) {
        return name
            .replace(/^mixamorig:?/i, "")
            .replace(/_/g, " ")
            .replace(/([A-Z])/g, " $1")
            .trim();
    }

    function showBoneLabel(name) {
        var l = document.getElementById("bone-label");
        if (!l) {
            l = document.createElement("div");
            l.id = "bone-label";
            l.className = "bone-label";
            document.body.appendChild(l);
        }
        l.textContent = formatBoneName(name) || name;
        l.classList.add("active");
    }

    function hideBoneLabel() {
        var l = document.getElementById("bone-label");
        if (l) l.classList.remove("active");
    }

    // ============================================================
    // PAINEL DE CONTROLE DO BONE
    // ============================================================

    function createBoneControlPanel() {
        if (document.getElementById("bone-control-panel")) return;

        var panel = document.createElement("div");
        panel.id = "bone-control-panel";
        panel.className = "bone-control-panel";

        panel.innerHTML =
            // Header
            '<div class="bcp-header">' +
                '<span class="bcp-title">Controle do Bone</span>' +
                '<span class="bcp-bone-name" id="bcp-bone-name">\u2014</span>' +
            '</div>' +

            // Bone A selector
            '<div class="bcp-selector-row">' +
                '<span class="bcp-bone-badge bcp-bone-badge-a">A</span>' +
                '<select class="bcp-bone-select" id="bcp-bone-select"></select>' +
                '<button class="bcp-save-pair-btn" id="bcp-save-pair-btn" title="Salvar par Bone A + Bone B no esqueleto atual">\uD83D\uDCBE Salvar Par</button>' +
            '</div>' +
            
            // Lista de Pares Salvos
            '<div class="bcp-pairs-section" id="bcp-pairs-section" style="display:none;">' +
                '<div class="bcp-pairs-header">' +
                    '<span class="bcp-pairs-title">Pares Salvos</span>' +
                '</div>' +
                '<div class="bcp-pairs-list" id="bcp-pairs-list"></div>' +
            '</div>' +

            // Bone B selector
            '<div class="bcp-selector-row">' +
                '<span class="bcp-bone-badge bcp-bone-badge-b">B</span>' +
                '<select class="bcp-bone-select bcp-bone-select-b" id="bcp-bone-select-b"><option value="">\u2014 Nenhum \u2014</option></select>' +
            '</div>' +

            // Link / Mirror row
            '<div class="bcp-link-row">' +
                '<button class="bcp-link-btn" id="bcp-link-btn">\uD83D\uDD13 Link: OFF</button>' +
                '<button class="bcp-mirror-btn" id="bcp-mirror-btn">\uD83D\uDD00 Mirror: OFF</button>' +
                '<select class="bcp-mirror-axis" id="bcp-mirror-axis">' +
                    '<option value="YZ">YZ</option>' +
                    '<option value="Y">Y</option>' +
                    '<option value="Z">Z</option>' +
                    '<option value="X">X</option>' +
                    '<option value="XY">XY</option>' +
                    '<option value="XZ">XZ</option>' +
                '</select>' +
            '</div>' +

            // Botões de Modo
            '<div class="bcp-mode-row">' +
                '<button class="bcp-mode-btn active" id="bcp-mode-rotate" title="Rota\u00E7\u00E3o">' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6"/><path d="M21.34 13.72A10 10 0 1 1 18.57 4.34L21.5 2"/></svg>' +
                    ' Rotacionar' +
                '</button>' +
                '<button class="bcp-mode-btn" id="bcp-mode-translate" title="Movimento">' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>' +
                    ' Mover' +
                '</button>' +
                '<button class="bcp-mode-btn" id="bcp-mode-scale" title="Escala">' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>' +
                    ' Escala' +
                '</button>' +
            '</div>' +

            // Escala Uniforme (visível apenas no modo Scale)
            '<div class="bcp-uniform-row" id="bcp-uniform-row">' +
                '<input type="checkbox" class="bcp-uniform-checkbox" id="bcp-uniform-scale">' +
                '<label class="bcp-uniform-label" for="bcp-uniform-scale">Escala Uniforme (X=Y=Z)</label>' +
            '</div>' +

            // Slider X
            '<div class="bcp-slider-group">' +
                '<div class="bcp-slider-header">' +
                    '<span class="bcp-axis bcp-axis-x">X</span>' +
                    '<span class="bcp-value" id="bcp-val-x">0.0\u00B0</span>' +
                '</div>' +
                '<input type="range" class="bcp-slider bcp-slider-x" id="bcp-slider-x" min="-180" max="180" step="0.5" value="0">' +
            '</div>' +

            // Slider Y
            '<div class="bcp-slider-group">' +
                '<div class="bcp-slider-header">' +
                    '<span class="bcp-axis bcp-axis-y">Y</span>' +
                    '<span class="bcp-value" id="bcp-val-y">0.0\u00B0</span>' +
                '</div>' +
                '<input type="range" class="bcp-slider bcp-slider-y" id="bcp-slider-y" min="-180" max="180" step="0.5" value="0">' +
            '</div>' +

            // Slider Z
            '<div class="bcp-slider-group">' +
                '<div class="bcp-slider-header">' +
                    '<span class="bcp-axis bcp-axis-z">Z</span>' +
                    '<span class="bcp-value" id="bcp-val-z">0.0\u00B0</span>' +
                '</div>' +
                '<input type="range" class="bcp-slider bcp-slider-z" id="bcp-slider-z" min="-180" max="180" step="0.5" value="0">' +
            '</div>' +

            // Botões de Ação
            '<div class="bcp-action-row">' +
                '<button class="bcp-reset-btn" id="bcp-reset-btn" title="Resetar Bone A">' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>' +
                    ' Reset A' +
                '</button>' +
                '<button class="bcp-reset-btn bcp-reset-b" id="bcp-reset-b-btn" title="Resetar Bone B">' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>' +
                    ' Reset B' +
                '</button>' +
                '<button class="bcp-reset-btn bcp-reset-all" id="bcp-reset-all-btn" title="Resetar Todos os Bones">' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>' +
                    ' Reset Tudo' +
                '</button>' +
                '<button class="bcp-reset-btn" id="bcp-ik-toggle" title="Ativar/Desativar Cinem\u00E1tica Inversa (IK)" style="background:var(--bg-lighter);">' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v7"/><path d="M12 15v7"/><path d="M2 12h7"/><path d="M15 12h7"/></svg>' +
                    ' IK: OFF' +
                '</button>' +
                '<button class="bcp-reset-btn" id="bcp-bind-mesh" title="Vincular Malha Selecionada ao Esqueleto Ativo (Auto-Rig)" style="background:rgba(109,40,217,0.15); border-color:var(--accent);">' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.2 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.2L12 21l1.9-5.8a2 2 0 0 1 1.2-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.2L12 3Z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/></svg>' +
                    ' Vincular' +
                '</button>' +
                '<button class="bcp-random-btn" id="bcp-random-btn" title="Pose Aleat\u00F3ria no Bone Selecionado">\uD83C\uDFB2 Aleat\u00F3rio</button>' +
            '</div>';

        document.body.appendChild(panel);

        // --- Event Listeners ---
        var sx = document.getElementById("bcp-slider-x");
        var sy = document.getElementById("bcp-slider-y");
        var sz = document.getElementById("bcp-slider-z");

        // Handler com suporte a Escala Uniforme — sincroniza os 3 eixos ao eixo alterado
        function makeSliderHandler(triggerId) {
            return function () {
                if (uniformScale && currentMode === "scale") {
                    var val = parseFloat(document.getElementById(triggerId).value);
                    sx.value = val; sy.value = val; sz.value = val;
                }
                applySliderValues();
            };
        }

        sx.addEventListener("input", makeSliderHandler("bcp-slider-x"));
        sy.addEventListener("input", makeSliderHandler("bcp-slider-y"));
        sz.addEventListener("input", makeSliderHandler("bcp-slider-z"));

        // Bloqueia orbit/drag ao mexer nos sliders
        [sx, sy, sz].forEach(function (sl) {
            sl.addEventListener("mousedown", function () { controls.enabled = false; });
            sl.addEventListener("mouseup",   function () { controls.enabled = true; });
            sl.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
        });

        // Botões de modo
        document.getElementById("bcp-mode-rotate").addEventListener("click", function () { setMode("rotate"); });
        document.getElementById("bcp-mode-translate").addEventListener("click", function () { setMode("translate"); });
        document.getElementById("bcp-mode-scale").addEventListener("click", function () { setMode("scale"); });

        // Reset bone individual
        document.getElementById("bcp-reset-btn").addEventListener("click", function () {
            resetSelectedBone();
        });

        // Reset todos os bones
        document.getElementById("bcp-reset-all-btn").addEventListener("click", function () {
            resetAllBones();
        });

        // Toggle IK Btn
        var ikToggleBtn = document.getElementById("bcp-ik-toggle");
        if (ikToggleBtn) {
            ikToggleBtn.addEventListener("click", function () {
                var newState = !isIKEnabled;
                setIKEnabled(newState);
                ikToggleBtn.style.color = isIKEnabled ? "#00ff88" : "";
                ikToggleBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v7"/><path d="M12 15v7"/><path d="M2 12h7"/><path d="M15 12h7"/></svg> ' +
                                        (isIKEnabled ? 'IK: ON' : 'IK: OFF');
            });
        }

        // Vínculo (Bind) de Malha Estática
        var btnBind = document.getElementById("bcp-bind-mesh");
        if (btnBind) {
            btnBind.addEventListener("click", function () {
                if (typeof activeItem === "undefined" || !activeItem) {
                    if (typeof showStatus === "function") showStatus("Selecione um objeto na lista primeiro", "error");
                    return;
                }
                
                // Tenta encontrar uma malha estática no objeto selecionado
                var targetMesh = null;
                activeItem.root.traverse(function(child) {
                    if (child.isMesh && !child.isSkinnedMesh && !child.userData.isSkelJoint) {
                        targetMesh = child;
                    }
                });

                if (targetMesh && skeletonBones.length > 0) {
                    bindStaticMeshToSkeleton(targetMesh, skeletonBones);
                } else {
                    if (typeof showStatus === "function") 
                        showStatus(skeletonBones.length === 0 ? "Nenhum esqueleto detectado" : "Objeto já está vinculado ou é inválido", "error");
                }
            });
        }

        // Seletor Bone A
        document.getElementById("bcp-bone-select").addEventListener("change", function (e) {
            if (e.target.value) selectBoneByName(e.target.value);
        });

        // Seletor Bone B
        document.getElementById("bcp-bone-select-b").addEventListener("change", function (e) {
            selectBoneBByName(e.target.value);
        });

        // Salvar Par
        var savePairBtn = document.getElementById("bcp-save-pair-btn");
        if (savePairBtn) {
            savePairBtn.addEventListener("click", function () {
                saveCurrentPair();
            });
        }

        // Link toggle
        var linkBtn = document.getElementById("bcp-link-btn");
        linkBtn.addEventListener("click", function () {
            isBoneLinkEnabled = !isBoneLinkEnabled;
            linkBtn.classList.toggle("active", isBoneLinkEnabled);
            linkBtn.innerHTML = (isBoneLinkEnabled ? "\uD83D\uDD17 Link: ON" : "\uD83D\uDD13 Link: OFF");
            if (typeof showStatus === "function") showStatus("Link " + (isBoneLinkEnabled ? "Ativado" : "Desativado"));
        });

        // Mirror toggle
        var mirrorBtn = document.getElementById("bcp-mirror-btn");
        mirrorBtn.addEventListener("click", function () {
            isMirrorEnabled = !isMirrorEnabled;
            mirrorBtn.classList.toggle("active", isMirrorEnabled);
            mirrorBtn.innerHTML = (isMirrorEnabled ? "\uD83D\uDD00 Mirror: ON" : "\uD83D\uDD00 Mirror: OFF");
            var axisEl = document.getElementById("bcp-mirror-axis");
            if (axisEl) axisEl.classList.toggle("enabled", isMirrorEnabled);
            if (typeof showStatus === "function") showStatus("Mirror " + (isMirrorEnabled ? "Ativado (Eixo: " + mirrorAxis + ")" : "Desativado"));
        });

        // Mirror axis selector
        document.getElementById("bcp-mirror-axis").addEventListener("change", function (e) {
            mirrorAxis = e.target.value;
            if (typeof showStatus === "function") showStatus("Eixo de Espelho: " + mirrorAxis);
        });

        // Reset bone B
        document.getElementById("bcp-reset-b-btn").addEventListener("click", function () {
            resetBoneB();
        });

        // Pose Aleatória
        document.getElementById("bcp-random-btn").addEventListener("click", function () {
            randomizeBone();
        });

        // Uniform Scale checkbox
        document.getElementById("bcp-uniform-scale").addEventListener("change", function () {
            uniformScale = this.checked;
            if (uniformScale && currentMode === "scale") {
                var val = parseFloat(document.getElementById("bcp-slider-x").value);
                document.getElementById("bcp-slider-y").value = val;
                document.getElementById("bcp-slider-z").value = val;
                applySliderValues();
            }
        });

        // Impedir propagação de cliques no painel
        panel.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
        panel.addEventListener("mousedown", function (e) { e.stopPropagation(); });

        document.body.appendChild(panel);
    }

    /**
     * Popula ambos os dropdowns (A e B) com todos os bones disponíveis.
     */
    function populateBoneSelector() {
        var select  = document.getElementById("bcp-bone-select");
        var selectB = document.getElementById("bcp-bone-select-b");
        if (!select) return;

        select.innerHTML  = "";
        if (selectB) selectB.innerHTML = "<option value=''>\u2014 Nenhum \u2014</option>";

        skeletonBones.forEach(function (bone) {
            var label = formatBoneName(bone.name) || bone.name;
            var opt = document.createElement("option");
            opt.value = bone.name;
            opt.textContent = label;
            select.appendChild(opt);
            if (selectB) {
                var optB = document.createElement("option");
                optB.value = bone.name;
                optB.textContent = label;
                selectB.appendChild(optB);
            }
        });
    }

    /**
     * Atualiza ambos os dropdowns para refletir os bones selecionados.
     */
    function updateBoneSelector() {
        var select  = document.getElementById("bcp-bone-select");
        var selectB = document.getElementById("bcp-bone-select-b");
        if (select && selectedBone)   select.value  = selectedBone.name;
        if (selectB && selectedBoneB) selectB.value = selectedBoneB.name;
        else if (selectB && !selectedBoneB) selectB.value = "";
    }

    function showBoneControlPanel() {
        var panel = document.getElementById("bone-control-panel");
        if (panel) {
            panel.classList.add("active");
            var nameEl = document.getElementById("bcp-bone-name");
            if (nameEl && selectedBone) {
                nameEl.textContent = formatBoneName(selectedBone.name) || selectedBone.name;
            }
            populateBoneSelector();
            updateBoneSelector();
        }
        updateModeButtons();
    }

    function hideBoneControlPanel() {
        var panel = document.getElementById("bone-control-panel");
        if (panel) panel.classList.remove("active");
    }

    function updateModeButtons() {
        var btnR = document.getElementById("bcp-mode-rotate");
        var btnT = document.getElementById("bcp-mode-translate");
        var btnS = document.getElementById("bcp-mode-scale");
        if (!btnR) return;

        if (btnR) btnR.classList.toggle("active", currentMode === "rotate");
        if (btnT) btnT.classList.toggle("active", currentMode === "translate");
        if (btnS) btnS.classList.toggle("active", currentMode === "scale");

        // Mostrar/ocultar row de Escala Uniforme
        var uniformRow = document.getElementById("bcp-uniform-row");
        if (uniformRow) uniformRow.classList.toggle("visible", currentMode === "scale");

        updateSlidersFromBone();
    }

    // ============================================================
    // SLIDERS — Leitura e Aplicação
    // ============================================================

    function applySliderValues() {
        if (!selectedBone) return;

        var sx = document.getElementById("bcp-slider-x");
        var sy = document.getElementById("bcp-slider-y");
        var sz = document.getElementById("bcp-slider-z");
        var lx = document.getElementById("bcp-val-x");
        var ly = document.getElementById("bcp-val-y");
        var lz = document.getElementById("bcp-val-z");
        if (!sx) return;

        var vx = parseFloat(sx.value);
        var vy = parseFloat(sy.value);
        var vz = parseFloat(sz.value);

        if (currentMode === "rotate") {
            var d2r = Math.PI / 180;
            selectedBone.rotation.x = vx * d2r;
            selectedBone.rotation.y = vy * d2r;
            selectedBone.rotation.z = vz * d2r;
            if (lx) lx.textContent = vx.toFixed(1) + "\u00B0";
            if (ly) ly.textContent = vy.toFixed(1) + "\u00B0";
            if (lz) lz.textContent = vz.toFixed(1) + "\u00B0";
        } else if (currentMode === "translate") {
            selectedBone.position.x = vx;
            selectedBone.position.y = vy;
            selectedBone.position.z = vz;
            if (lx) lx.textContent = vx.toFixed(3);
            if (ly) ly.textContent = vy.toFixed(3);
            if (lz) lz.textContent = vz.toFixed(3);
        } else if (currentMode === "scale") {
            selectedBone.scale.x = vx;
            selectedBone.scale.y = vy;
            selectedBone.scale.z = vz;
            if (lx) lx.textContent = vx.toFixed(2);
            if (ly) ly.textContent = vy.toFixed(2);
            if (lz) lz.textContent = vz.toFixed(2);
        }

        // Aplica ao Bone B se o Link estiver ativo
        if (isBoneLinkEnabled && selectedBoneB) {
            applyToSecondaryBone(vx, vy, vz);
        }

        propagateBoneChange();
    }

    /**
     * Traz o elemento para frente incrementando o z-index.
     */
    function bringToFront(el) {
        if (!el) return;
        topZIndex++;
        el.style.zIndex = topZIndex;
    }

    function initStackingManagement() {
        // Event delegation no body para capturar cliques em qualquer painel flutuante
        document.body.addEventListener("pointerdown", function(e) {
            var panel = e.target.closest(".bone-control-panel, .scene-panel, .dock, .camera-hud, .skeleton-badge, .skeleton-toggle");
            if (panel) {
                bringToFront(panel);
            }
        }, { capture: true });
    }

    // ============================================================
    // MÓDULO — DUAL BONE: Seleção, Mirror, Pares Salvos
    // ============================================================

    function loadSavedPairs() {
        var raw = localStorage.getItem("noderig_saved_pairs");
        if (raw) {
            try {
                savedPairs = JSON.parse(raw);
            } catch(e) {
                savedPairs = {};
            }
        }
        renderSavedPairs();
    }

    function saveCurrentPair() {
        if (!selectedBone || !selectedBoneB) {
            if (typeof showStatus === "function") showStatus("Selecione os dois ossos (A e B) primeiro", "error");
            return;
        }

        if (!savedPairs[currentModelName]) savedPairs[currentModelName] = [];
        
        // Evita duplicatas
        var exists = savedPairs[currentModelName].some(p => p.a === selectedBone.name && p.b === selectedBoneB.name);
        if (exists) {
            if (typeof showStatus === "function") showStatus("Este par já está salvo");
            return;
        }

        savedPairs[currentModelName].push({
            a: selectedBone.name,
            b: selectedBoneB.name
        });

        localStorage.setItem("noderig_saved_pairs", JSON.stringify(savedPairs));
        renderSavedPairs();
        if (typeof showStatus === "function") showStatus("Par salvo com sucesso!");
    }

    function deleteSavedPair(index) {
        if (savedPairs[currentModelName]) {
            savedPairs[currentModelName].splice(index, 1);
            localStorage.setItem("noderig_saved_pairs", JSON.stringify(savedPairs));
            renderSavedPairs();
        }
    }

    function renderSavedPairs() {
        var section = document.getElementById("bcp-pairs-section");
        var list = document.getElementById("bcp-pairs-list");
        if (!list || !section) return;

        var modelPairs = savedPairs[currentModelName] || [];
        if (modelPairs.length === 0) {
            section.style.display = "none";
            return;
        }

        section.style.display = "block";
        list.innerHTML = "";

        modelPairs.forEach((pair, idx) => {
            var item = document.createElement("div");
            item.className = "bcp-pair-item";
            
            var label = document.createElement("span");
            label.className = "bcp-pair-label";
            label.textContent = formatBoneName(pair.a) + " \u2194 " + formatBoneName(pair.b);
            label.title = pair.a + " + " + pair.b;
            label.onclick = function() {
                selectBoneByName(pair.a);
                selectBoneBByName(pair.b);
                // Ativa Link/Mirror automaticamente ao selecionar par salvo
                isMirrorEnabled = true;
                var mirrorBtn = document.getElementById("bcp-mirror-btn");
                if (mirrorBtn) {
                    mirrorBtn.classList.add("active");
                    mirrorBtn.innerHTML = "\uD83D\uDD00 Mirror: ON";
                    var axisEl = document.getElementById("bcp-mirror-axis");
                    if (axisEl) axisEl.classList.add("enabled");
                }
            };

            var delBtn = document.createElement("button");
            delBtn.className = "bcp-pair-del";
            delBtn.innerHTML = "\u2715";
            delBtn.title = "Excluir Par";
            delBtn.onclick = function(e) {
                e.stopPropagation();
                deleteSavedPair(idx);
            };

            item.appendChild(label);
            item.appendChild(delBtn);
            list.appendChild(item);
        });
    }

    /**
     * Seleciona o Bone B (par) — colore de roxo, sem afetar o gizmo.
     */
    function selectBoneB(bone) {
        // Reset cor do B anterior
        if (selectedBoneB) {
            jointHelpers.forEach(function (jh) {
                if (jointToBoneMap.get(jh) === selectedBoneB && selectedBoneB !== selectedBone) {
                    jh.material.color.setHex(COLORS.joint);
                }
            });
        }
        selectedBoneB = bone;
        if (bone) {
            jointHelpers.forEach(function (jh) {
                if (jointToBoneMap.get(jh) === bone && bone !== selectedBone) {
                    jh.material.color.setHex(BONE_B_COLOR);
                }
            });
        }
        updateBoneSelector();
    }

    /**
     * Seleciona o Bone B pelo nome (usado pelo dropdown B).
     */
    function selectBoneBByName(boneName) {
        if (!boneName) { selectBoneB(null); return; }
        for (var i = 0; i < skeletonBones.length; i++) {
            if (skeletonBones[i].name === boneName) { selectBoneB(skeletonBones[i]); return; }
        }
        selectBoneB(null);
    }

    /**
     * Auto-detecta o par simétrico L↔R do bone A selecionado.
     * Suporta padrões: .L/.R  _L/_R  Left/Right  l_/r_
     */
    function autoDetectPair() {
        if (!selectedBone) {
            if (typeof showStatus === "function") showStatus("Selecione o Bone A primeiro", "error");
            return;
        }
        var name = selectedBone.name;
        var pairName = null;

        if      (name.endsWith(".L"))         pairName = name.slice(0, -2) + ".R";
        else if (name.endsWith(".R"))         pairName = name.slice(0, -2) + ".L";
        else if (/_[Ll]$/.test(name))         pairName = name.slice(0, -2) + "_R";
        else if (/_[Rr]$/.test(name))         pairName = name.slice(0, -2) + "_L";
        else if (/[Ll]eft/.test(name))        pairName = name.replace(/[Ll]eft/,  function (m) { return m[0] === "L" ? "Right" : "right"; });
        else if (/[Rr]ight/.test(name))       pairName = name.replace(/[Rr]ight/, function (m) { return m[0] === "R" ? "Left"  : "left"; });
        else if (/^[Ll]_/.test(name))         pairName = "R_" + name.slice(2);
        else if (/^[Rr]_/.test(name))         pairName = "L_" + name.slice(2);

        if (pairName) {
            var found = skeletonBones.find(function (b) { return b.name === pairName; });
            if (found) {
                selectBoneB(found);
                if (typeof showStatus === "function") showStatus("Par detectado: " + pairName);
                return;
            }
        }
        if (typeof showStatus === "function") showStatus("Par n\u00E3o encontrado para: " + (formatBoneName(name) || name), "error");
    }

    /**
     * Aplica as transformações dos sliders ao Bone B,
     * com suporte a Mirror (negatição de eixos configurada).
     */
    function applyToSecondaryBone(vx, vy, vz) {
        if (!selectedBoneB || !selectedBone) return;

        var mx = 1, my = 1, mz = 1;
        if (isMirrorEnabled) {
            if (mirrorAxis.indexOf("X") !== -1) mx = -1;
            if (mirrorAxis.indexOf("Y") !== -1) my = -1;
            if (mirrorAxis.indexOf("Z") !== -1) mz = -1;
        }

        if (currentMode === "rotate") {
            var d2r = Math.PI / 180;
            selectedBoneB.rotation.x = vx * d2r * mx;
            selectedBoneB.rotation.y = vy * d2r * my;
            selectedBoneB.rotation.z = vz * d2r * mz;
        } else if (currentMode === "translate") {
            selectedBoneB.position.x = vx * mx;
            selectedBoneB.position.y = vy * my;
            selectedBoneB.position.z = vz * mz;
        } else if (currentMode === "scale") {
            selectedBoneB.scale.x = vx;
            selectedBoneB.scale.y = vy;
            selectedBoneB.scale.z = vz;
        }
        selectedBoneB.updateMatrixWorld(true);
    }

    /**
     * Gera uma pose aleatória para o Bone A (e B se linkado).
     * Modo Rotate: rotações em [-45°, +45°] por eixo.
     * Modo Scale:  escala uniforme em [0.5, 2.0].
     */
    function randomizeBone() {
        if (!selectedBone) {
            if (typeof showStatus === "function") showStatus("Selecione o Bone A primeiro", "error");
            return;
        }
        var genRand = function (range) { return (Math.random() * 2 - 1) * range; };

        if (currentMode === "rotate") {
            var rx = genRand(45), ry = genRand(45), rz = genRand(45);
            var d2r = Math.PI / 180;
            selectedBone.rotation.x = rx * d2r;
            selectedBone.rotation.y = ry * d2r;
            selectedBone.rotation.z = rz * d2r;
            if (isBoneLinkEnabled && selectedBoneB) {
                applyToSecondaryBone(rx, ry, rz);
            }
        } else if (currentMode === "translate") {
            var tx = genRand(0.3), ty = genRand(0.3), tz = genRand(0.3);
            selectedBone.position.x = tx;
            selectedBone.position.y = ty;
            selectedBone.position.z = tz;
            if (isBoneLinkEnabled && selectedBoneB) {
                applyToSecondaryBone(tx, ty, tz);
            }
        } else if (currentMode === "scale") {
            var s = 0.5 + Math.random() * 1.5;
            selectedBone.scale.setScalar(s);
            if (isBoneLinkEnabled && selectedBoneB) selectedBoneB.scale.setScalar(s);
        }

        propagateBoneChange();
        updateSlidersFromBone();
        if (typeof showStatus === "function") showStatus("Pose aleat\u00F3ria aplicada");
    }

    /**
     * Reseta o Bone B para a pose original salva.
     */
    function resetBoneB() {
        if (!selectedBoneB) {
            if (typeof showStatus === "function") showStatus("Nenhum Bone B selecionado", "error");
            return;
        }
        var orig = originalTransforms[selectedBoneB.uuid];
        if (orig) {
            selectedBoneB.position.set(orig.px, orig.py, orig.pz);
            selectedBoneB.rotation.set(orig.rx, orig.ry, orig.rz);
            selectedBoneB.scale.set(orig.sx, orig.sy, orig.sz);
        } else {
            selectedBoneB.position.set(0, 0, 0);
            selectedBoneB.rotation.set(0, 0, 0);
            selectedBoneB.scale.set(1, 1, 1);
        }
        selectedBoneB.updateMatrixWorld(true);
        propagateBoneChange();
        if (typeof showStatus === "function") showStatus("Bone B resetado");
    }

    function updateSlidersFromBone() {
        if (!selectedBone) return;

        var sx = document.getElementById("bcp-slider-x");
        var sy = document.getElementById("bcp-slider-y");
        var sz = document.getElementById("bcp-slider-z");
        var lx = document.getElementById("bcp-val-x");
        var ly = document.getElementById("bcp-val-y");
        var lz = document.getElementById("bcp-val-z");
        if (!sx) return;

        if (currentMode === "rotate") {
            var r2d = 180 / Math.PI;
            var rx = selectedBone.rotation.x * r2d;
            var ry = selectedBone.rotation.y * r2d;
            var rz = selectedBone.rotation.z * r2d;
            sx.min = -180; sx.max = 180; sx.step = 0.5;
            sy.min = -180; sy.max = 180; sy.step = 0.5;
            sz.min = -180; sz.max = 180; sz.step = 0.5;
            sx.value = rx; sy.value = ry; sz.value = rz;
            if (lx) lx.textContent = rx.toFixed(1) + "\u00B0";
            if (ly) ly.textContent = ry.toFixed(1) + "\u00B0";
            if (lz) lz.textContent = rz.toFixed(1) + "\u00B0";
        } else if (currentMode === "translate") {
            sx.min = -2; sx.max = 2; sx.step = 0.005;
            sy.min = -2; sy.max = 2; sy.step = 0.005;
            sz.min = -2; sz.max = 2; sz.step = 0.005;
            sx.value = selectedBone.position.x;
            sy.value = selectedBone.position.y;
            sz.value = selectedBone.position.z;
            if (lx) lx.textContent = selectedBone.position.x.toFixed(3);
            if (ly) ly.textContent = selectedBone.position.y.toFixed(3);
            if (lz) lz.textContent = selectedBone.position.z.toFixed(3);
        } else if (currentMode === "scale") {
            sx.min = 0.01; sx.max = 3; sx.step = 0.01;
            sy.min = 0.01; sy.max = 3; sy.step = 0.01;
            sz.min = 0.01; sz.max = 3; sz.step = 0.01;
            sx.value = selectedBone.scale.x;
            sy.value = selectedBone.scale.y;
            sz.value = selectedBone.scale.z;
            if (lx) lx.textContent = selectedBone.scale.x.toFixed(2);
            if (ly) ly.textContent = selectedBone.scale.y.toFixed(2);
            if (lz) lz.textContent = selectedBone.scale.z.toFixed(2);
        }
    }

    // ============================================================
    // RESET — Restaurar pose original
    // ============================================================

    function resetSelectedBone() {
        if (!selectedBone) return;
        var orig = originalTransforms[selectedBone.uuid];
        if (orig) {
            selectedBone.position.set(orig.px, orig.py, orig.pz);
            selectedBone.rotation.set(orig.rx, orig.ry, orig.rz);
            selectedBone.scale.set(orig.sx, orig.sy, orig.sz);
        } else {
            selectedBone.position.set(0, 0, 0);
            selectedBone.rotation.set(0, 0, 0);
            selectedBone.scale.set(1, 1, 1);
        }
        propagateBoneChange();
        updateSlidersFromBone();
        if (typeof showStatus === "function") showStatus("Bone resetado");
    }

    function resetAllBones() {
        skeletonBones.forEach(function (bone) {
            var orig = originalTransforms[bone.uuid];
            if (orig) {
                bone.position.set(orig.px, orig.py, orig.pz);
                bone.rotation.set(orig.rx, orig.ry, orig.rz);
                bone.scale.set(orig.sx, orig.sy, orig.sz);
            }
        });
        propagateBoneChange();
        updateSlidersFromBone();
        if (typeof showStatus === "function") showStatus("Todos os bones resetados");
    }

    // ============================================================
    // VISIBILIDADE DO OVERLAY
    // ============================================================

    function hideOverlay() {
        if (skeletonGroup) skeletonGroup.visible = false;
        if (transformCtrl) transformCtrl.visible = false;
        isOverlayVisible = false;
        updateToggleButton();
    }

    function showOverlay() {
        if (skeletonGroup) skeletonGroup.visible = true;
        if (transformCtrl) transformCtrl.visible = true;
        isOverlayVisible = true;
        updateToggleButton();
    }

    function toggleOverlay() {
        if (isOverlayVisible) hideOverlay(); else showOverlay();
    }

    // ============================================================
    // AUTO-HIDE NOS EXPORTS
    // ============================================================

    function hookIntoExportButtons() {
        ["btn-export", "btn-save-input", "btn-send-memory"].forEach(function (id) {
            var btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener("click", function () {
                if (!isSkeletonActive) return;
                if (skeletonGroup) skeletonGroup.visible = false;
                if (transformCtrl) transformCtrl.visible = false;
                setTimeout(function () {
                    if (isOverlayVisible) {
                        if (skeletonGroup) skeletonGroup.visible = true;
                        if (transformCtrl) transformCtrl.visible = true;
                    }
                }, 0);
            }, true);
        });
    }

    // ============================================================
    // BOTÃO TOGGLE
    // ============================================================

    function createToggleButton() {
        var btn = document.getElementById("skeleton-toggle");
        if (!btn) {
            btn = document.createElement("button");
            btn.id = "skeleton-toggle";
            btn.className = "skeleton-toggle";
            document.body.appendChild(btn);
            btn.addEventListener("click", function () {
                toggleOverlay();
                if (typeof showStatus === "function")
                    showStatus(isOverlayVisible ? "Esqueleto vis\u00EDvel" : "Esqueleto oculto");
            });
        }
        updateToggleButton();
        btn.classList.add("active");
    }

    function updateToggleButton() {
        var btn = document.getElementById("skeleton-toggle");
        if (!btn) return;
        if (isOverlayVisible) {
            btn.innerHTML = '<span class="toggle-icon">\uD83D\uDC41</span>';
            btn.title = "Ocultar Visualização de Ossos";
            btn.classList.remove("hidden-state");
        } else {
            btn.innerHTML = '<span class="toggle-icon">\uD83D\uDC41\u200D\uD83D\uDDE8</span>';
            btn.title = "Mostrar Visualização de Ossos";
            btn.classList.add("hidden-state");
        }
    }

    function hideToggleButton() {
        var btn = document.getElementById("skeleton-toggle");
        if (btn) btn.classList.remove("active");
    }

    // ============================================================
    // AJUSTE DE LAYOUT (ESPAÇAMENTO VERTICAL)
    // ============================================================

    var currentSpacingMode = 0; // 0: Normal, 1: Amplo
    
    function createLayoutControls() {
        if (document.getElementById("layout-adjuster")) return;
        
        var container = document.createElement("div");
        container.id = "layout-adjuster";
        container.className = "layout-adjuster";
        
        var btnV = document.createElement("button");
        btnV.className = "layout-adjust-btn";
        btnV.innerHTML = '<span class="layout-adjust-icon">\u2195</span>';
        btnV.title = "Ajustar Espaçamento Vertical";
        
        btnV.addEventListener("click", function() {
            currentSpacingMode = (currentSpacingMode + 1) % 2;
            applyLayoutSpacing();
        });
        
        container.appendChild(btnV);
        document.body.appendChild(container);
    }

    function applyLayoutSpacing() {
        var root = document.documentElement;
        if (currentSpacingMode === 1) {
            root.style.setProperty("--bcp-vertical-spacing", "18px");
            if (typeof showStatus === "function") showStatus("Modo: Espaçamento Amplo");
        } else {
            root.style.setProperty("--bcp-vertical-spacing", "12px");
            if (typeof showStatus === "function") showStatus("Modo: Espaçamento Normal");
        }
    }

    // ============================================================
    // API GLOBAL
    // ============================================================
    window.SkeletonRig = {
        hide: hideOverlay,
        show: showOverlay,
        toggle: toggleOverlay,
        setMode: setMode,
        resetAll: resetAllBones,
        isVisible: function () { return isOverlayVisible; },
        isActive: function () { return isSkeletonActive; }
    };

    // ============================================================
    // LOOP DE ANIMAÇÃO
    // ============================================================

    function injectIntoRenderLoop() {
        // Ao invés de substituir o requestAnimationFrame global,
        // usamos um loop dedicado que roda em paralelo ao loop do Three.js.
        // Isso evita condições de corrida com o renderer principal.
        (function skelLoop() {
            window.requestAnimationFrame(skelLoop);
            updateSkeletonVisualization();
        })();
    }

    // ============================================================
    // INICIALIZAÇÃO
    // ============================================================

    function init() {
        console.log("[SkeletonRig] M\u00F3dulo v3 inicializado.");
        injectIntoRenderLoop();
        hookIntoModelLoading();
        hookIntoClearScene();
        hookIntoObjectRemoval();
        hookIntoExportButtons();
        setupEventListeners();
        initStackingManagement();
        createLayoutControls();

        if (typeof sceneRegistry !== "undefined") {
            setTimeout(function () {
                sceneRegistry.forEach(function (item) {
                    var bones = detectSkeleton(item.root);
                    if (bones.length > 0) processModelForSkeleton(item.root);
                });
            }, 500);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        setTimeout(init, 100);
    }

})();
