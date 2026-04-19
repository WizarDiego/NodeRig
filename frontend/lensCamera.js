// ============================================================
// LENS CAMERA v1.0 — Simulação de Lentes Óticas para o NodeRig
// Módulo independente: sem modificações em app.js
// ============================================================
(function () {
    "use strict";

    // ============================================================
    // ESTADO
    // ============================================================
    var focalLength    = 50;      // mm (padrão: 50mm "nifty fifty")
    var distortionK    = 0.0;     // barrel distortion (0 = nenhum)
    var blurAmount     = 0.0;     // bokeh amount (0–1)
    var vignetteAmount = 0.0;     // vignette (0–1)
    var caAmount       = 0.0;     // chromatic aberration (0–1)
    var lensMode       = "normal";

    var isPostEnabled  = false;
    var renderTarget   = null;
    var postScene      = null;
    var postCamera     = null;
    var postMaterial   = null;
    var _origRender    = null;

    // Presets de focal (mm)
    var FOCAL_PRESETS  = [14, 24, 35, 50, 85, 135, 200];

    // Presets por modo de lente
    var LENS_MODES = {
        normal:  { focal: 50,  distortion: 0.00 },
        angular: { focal: 24,  distortion: 0.10 },
        fisheye: { focal: 14,  distortion: 0.42 }
    };

    // ============================================================
    // CÁLCULOS ÓPTICOS
    // ============================================================

    /**
     * Converte distância focal (mm) em FOV vertical (graus)
     * usando sensor full-frame 35mm (36×24mm).
     */
    function fovFromFocal(mm) {
        var sensorH = 24.0; // mm (altura do sensor)
        return 2.0 * Math.atan(sensorH / (2.0 * mm)) * (180.0 / Math.PI);
    }

    /**
     * Converte valor do slider de blur (0–1) em f-stop equivalente.
     * 0 = f/16 (fechado / nítido), 1 = f/1.2 (aberto / bokeh).
     */
    function blurToFstop(v) {
        var logMin = Math.log(1.2);
        var logMax = Math.log(16.0);
        var logF   = logMax - v * (logMax - logMin);
        return "f/" + Math.exp(logF).toFixed(1);
    }

    // ============================================================
    // SHADERS GLSL
    // ============================================================

    var VERT = [
        "varying vec2 vUv;",
        "void main() {",
        "    vUv = uv;",
        "    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}"
    ].join("\n");

    var FRAG = [
        "uniform sampler2D tDiffuse;",
        "uniform float uDistortion;",
        "uniform float uBlur;",
        "uniform float uVignette;",
        "uniform float uCA;",
        "varying vec2 vUv;",
        "",
        "// Barrel / fisheye distortion",
        "vec2 barrel(vec2 uv, float k) {",
        "    vec2 c = uv * 2.0 - 1.0;",
        "    float r2 = dot(c, c);",
        "    c *= 1.0 + k * r2 + k * 0.15 * r2 * r2;",
        "    return c * 0.5 + 0.5;",
        "}",
        "",
        "void main() {",
        "    vec2 dUv = (uDistortion > 0.001) ? barrel(vUv, uDistortion) : vUv;",
        "",
        "    // Fora dos limites → preto (crop circular do fisheye)",
        "    if (dUv.x < 0.0 || dUv.x > 1.0 || dUv.y < 0.0 || dUv.y > 1.0) {",
        "        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);",
        "        return;",
        "    }",
        "",
        "    // 12-tap Poisson disk bokeh",
        "    float br = uBlur * 0.065;",
        "    vec4 color;",
        "    if (br > 0.0001) {",
        "        color  = texture2D(tDiffuse, dUv + br * vec2(-0.326,-0.406));",
        "        color += texture2D(tDiffuse, dUv + br * vec2(-0.840,-0.074));",
        "        color += texture2D(tDiffuse, dUv + br * vec2(-0.696, 0.457));",
        "        color += texture2D(tDiffuse, dUv + br * vec2(-0.203, 0.621));",
        "        color += texture2D(tDiffuse, dUv + br * vec2( 0.962,-0.195));",
        "        color += texture2D(tDiffuse, dUv + br * vec2( 0.473,-0.480));",
        "        color += texture2D(tDiffuse, dUv + br * vec2( 0.519, 0.767));",
        "        color += texture2D(tDiffuse, dUv + br * vec2( 0.185,-0.893));",
        "        color += texture2D(tDiffuse, dUv + br * vec2( 0.507, 0.064));",
        "        color += texture2D(tDiffuse, dUv + br * vec2( 0.896, 0.412));",
        "        color += texture2D(tDiffuse, dUv + br * vec2(-0.322,-0.933));",
        "        color += texture2D(tDiffuse, dUv + br * vec2(-0.792, 0.716));",
        "        color /= 12.0;",
        "    } else {",
        "        color = texture2D(tDiffuse, dUv);",
        "    }",
        "",
        "    // Aberração cromática — desfasagem radial RGB",
        "    if (uCA > 0.001) {",
        "        vec2 toCenter = 0.5 - dUv;",
        "        float ca = uCA * 0.022;",
        "        color.r = texture2D(tDiffuse, dUv - toCenter * ca).r;",
        "        color.b = texture2D(tDiffuse, dUv + toCenter * ca).b;",
        "    }",
        "",
        "    // Vinheta",
        "    if (uVignette > 0.001) {",
        "        float d = length(vUv * 2.0 - 1.0);",
        "        color.rgb *= 1.0 - smoothstep(0.25, 1.35, d) * uVignette;",
        "    }",
        "",
        "    gl_FragColor = color;",
        "}"
    ].join("\n");

    // ============================================================
    // POST-PROCESS
    // ============================================================

    function getRTSize() {
        return {
            w: renderer.domElement.width  || window.innerWidth,
            h: renderer.domElement.height || window.innerHeight
        };
    }

    function initPostProcess() {
        if (renderTarget) return;
        var sz = getRTSize();

        renderTarget = new THREE.WebGLRenderTarget(sz.w, sz.h, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format:    THREE.RGBAFormat
        });

        postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        postScene  = new THREE.Scene();

        postMaterial = new THREE.ShaderMaterial({
            vertexShader:   VERT,
            fragmentShader: FRAG,
            uniforms: {
                tDiffuse:    { value: renderTarget.texture },
                uDistortion: { value: 0.0 },
                uBlur:       { value: 0.0 },
                uVignette:   { value: 0.0 },
                uCA:         { value: 0.0 }
            },
            depthTest:  false,
            depthWrite: false
        });

        var PlaneGeo = THREE.PlaneGeometry || THREE.PlaneBufferGeometry;
        postScene.add(new THREE.Mesh(new PlaneGeo(2, 2), postMaterial));

        // Intercepta renderer.render — zero-cost quando desativado
        _origRender = renderer.render.bind(renderer);
        renderer.render = function (sc, cam) {
            if (isPostEnabled) {
                renderer.setRenderTarget(renderTarget);
                _origRender(sc, cam);
                renderer.setRenderTarget(null);
                _origRender(postScene, postCamera);
            } else {
                _origRender(sc, cam);
            }
        };
        console.log("[LensCamera] Post-process pronto: " + sz.w + "×" + sz.h);
    }

    function updateRTSize() {
        if (!renderTarget) return;
        var sz = getRTSize();
        renderTarget.setSize(sz.w, sz.h);
    }

    function syncUniforms() {
        if (!postMaterial) return;
        postMaterial.uniforms.uDistortion.value = distortionK;
        postMaterial.uniforms.uBlur.value       = blurAmount;
        postMaterial.uniforms.uVignette.value   = vignetteAmount;
        postMaterial.uniforms.uCA.value         = caAmount;
    }

    function checkPostProcess() {
        isPostEnabled = distortionK > 0.001 || blurAmount > 0.001 ||
                        vignetteAmount > 0.001 || caAmount > 0.001;
        if (isPostEnabled && !renderTarget) initPostProcess();
        if (renderTarget) syncUniforms();
    }

    // ============================================================
    // APLICA FOCAL / MODO
    // ============================================================

    function applyFocalLength(mm) {
        focalLength = Math.max(14, Math.min(200, mm));
        camera.fov  = fovFromFocal(focalLength);
        camera.updateProjectionMatrix();
        refreshUI();
    }

    function applyLensMode(mode) {
        lensMode       = mode;
        var p          = LENS_MODES[mode];
        distortionK    = p.distortion;
        applyFocalLength(p.focal);

        // Sliders
        setSliderVal("lens-focal-slider",      p.focal);
        setSliderVal("lens-distortion-slider", p.distortion);

        // Distortion row: ocultar no modo Normal
        var distRow = document.getElementById("lens-distortion-row");
        if (distRow) distRow.style.display = (mode === "normal") ? "none" : "";

        // Botões de tipo
        ["normal", "angular", "fisheye"].forEach(function (m) {
            toggleClass("lens-type-" + m, "active", m === mode);
        });

        checkPostProcess();
        refreshUI();
    }

    // ============================================================
    // ATUALIZA DISPLAY
    // ============================================================

    function refreshUI() {
        var fov = fovFromFocal(focalLength);

        setText("lens-focal-val",      focalLength + "mm  •  " + fov.toFixed(1) + "°");
        setText("lens-distortion-val", distortionK.toFixed(2));
        setText("lens-blur-val",       blurToFstop(blurAmount) + "  (" + blurAmount.toFixed(2) + ")");
        setText("lens-vignette-val",   vignetteAmount.toFixed(2));
        setText("lens-ca-val",         caAmount.toFixed(2));

        var modeLabel = { normal: "Normal", angular: "Angular", fisheye: "Fisheye" };
        setText("lens-header-info",    focalLength + "mm · " + (modeLabel[lensMode] || ""));

        // Chips de focal
        FOCAL_PRESETS.forEach(function (mm) {
            toggleClass("lens-preset-" + mm, "active", Math.abs(focalLength - mm) < 1);
        });
    }

    // ============================================================
    // RESET
    // ============================================================

    function resetLens() {
        focalLength    = 50;
        distortionK    = 0.0;
        blurAmount     = 0.0;
        vignetteAmount = 0.0;
        caAmount       = 0.0;
        lensMode       = "normal";
        isPostEnabled  = false;

        applyFocalLength(50);

        var sliders = {
            "lens-focal-slider":      50,
            "lens-distortion-slider": 0,
            "lens-blur-slider":       0,
            "lens-vignette-slider":   0,
            "lens-ca-slider":         0
        };
        Object.keys(sliders).forEach(function (id) { setSliderVal(id, sliders[id]); });

        ["normal", "angular", "fisheye"].forEach(function (m) {
            toggleClass("lens-type-" + m, "active", m === "normal");
        });

        var distRow = document.getElementById("lens-distortion-row");
        if (distRow) distRow.style.display = "none";

        if (postMaterial) syncUniforms();
        refreshUI();
        if (typeof showStatus === "function") showStatus("Lente resetada para padrão (50mm)");
    }

    // ============================================================
    // PAINEL DE CONTROLE
    // ============================================================

    function buildPresetChips() {
        return FOCAL_PRESETS.map(function (mm) {
            var active = mm === 50 ? " active" : "";
            return '<button class="lens-preset-btn' + active + '" id="lens-preset-' + mm +
                   '" data-focal="' + mm + '">' + mm + '</button>';
        }).join("");
    }

    function createLensPanel() {
        if (document.getElementById("lens-panel")) return;
        var panel = document.createElement("div");
        panel.id = "lens-panel";
        panel.className = "lens-panel";

        panel.innerHTML =
            // ── Header ──────────────────────────────────────────
            '<div class="lens-header">' +
                '<span class="lens-title">📷 Lente</span>' +
                '<span class="lens-header-info" id="lens-header-info">50mm · Normal</span>' +
            '</div>' +

            // ── Distância Focal ──────────────────────────────────
            '<div class="lens-section">' +
                '<div class="lens-section-label">Distância Focal</div>' +
                '<div class="lens-presets">' + buildPresetChips() + '</div>' +
                '<div class="lens-slider-group">' +
                    '<input type="range" id="lens-focal-slider" class="lens-slider lens-slider-focal"' +
                    '       min="14" max="200" step="1" value="50">' +
                    '<span class="lens-value" id="lens-focal-val">50mm  •  19.0°</span>' +
                '</div>' +
            '</div>' +

            // ── Tipo de Lente ─────────────────────────────────────
            '<div class="lens-section">' +
                '<div class="lens-section-label">Tipo de Lente</div>' +
                '<div class="lens-type-row">' +
                    '<button class="lens-type-btn active" id="lens-type-normal">📷 Normal</button>' +
                    '<button class="lens-type-btn" id="lens-type-angular">◻ Angular</button>' +
                    '<button class="lens-type-btn" id="lens-type-fisheye">◉ Fisheye</button>' +
                '</div>' +
            '</div>' +

            // ── Distorção (oculta no modo Normal) ────────────────
            '<div class="lens-section" id="lens-distortion-row" style="display:none;">' +
                '<div class="lens-slider-group">' +
                    '<div class="lens-slider-header">' +
                        '<span class="lens-slider-label">Distorção Radial</span>' +
                        '<span class="lens-value" id="lens-distortion-val">0.00</span>' +
                    '</div>' +
                    '<input type="range" id="lens-distortion-slider" class="lens-slider lens-slider-blue"' +
                    '       min="0" max="0.8" step="0.01" value="0">' +
                '</div>' +
            '</div>' +

            // ── Bokeh / Abertura ──────────────────────────────────
            '<div class="lens-section">' +
                '<div class="lens-slider-group">' +
                    '<div class="lens-slider-header">' +
                        '<span class="lens-slider-label">Abertura (Bokeh)</span>' +
                        '<span class="lens-value" id="lens-blur-val">f/16 (0.00)</span>' +
                    '</div>' +
                    '<div class="lens-blur-labels"><span>f/16 Sharp</span><span>f/1.2 Aberto</span></div>' +
                    '<input type="range" id="lens-blur-slider" class="lens-slider lens-slider-amber"' +
                    '       min="0" max="1" step="0.01" value="0">' +
                '</div>' +
            '</div>' +

            // ── Vinheta ───────────────────────────────────────────
            '<div class="lens-section">' +
                '<div class="lens-slider-group">' +
                    '<div class="lens-slider-header">' +
                        '<span class="lens-slider-label">Vinheta</span>' +
                        '<span class="lens-value" id="lens-vignette-val">0.00</span>' +
                    '</div>' +
                    '<input type="range" id="lens-vignette-slider" class="lens-slider lens-slider-purple"' +
                    '       min="0" max="1" step="0.01" value="0">' +
                '</div>' +
            '</div>' +

            // ── Aberração Cromática ───────────────────────────────
            '<div class="lens-section">' +
                '<div class="lens-slider-group">' +
                    '<div class="lens-slider-header">' +
                        '<span class="lens-slider-label">Aberração Cromática</span>' +
                        '<span class="lens-value" id="lens-ca-val">0.00</span>' +
                    '</div>' +
                    '<input type="range" id="lens-ca-slider" class="lens-slider lens-slider-ca"' +
                    '       min="0" max="1" step="0.01" value="0">' +
                '</div>' +
            '</div>' +

            // ── Reset ─────────────────────────────────────────────
            '<div class="lens-section lens-section-reset">' +
                '<button class="lens-reset-btn" id="lens-reset-btn">↺ Reset Lente</button>' +
            '</div>';

        document.body.appendChild(panel);
        wireListeners(panel);
    }

    function wireListeners(panel) {
        // Focal presets
        FOCAL_PRESETS.forEach(function (mm) {
            on("lens-preset-" + mm, "click", function () { applyFocalLength(mm); });
        });

        // Focal slider
        on("lens-focal-slider", "input", function () {
            applyFocalLength(parseInt(this.value, 10));
        });

        // Lens type buttons
        ["normal", "angular", "fisheye"].forEach(function (mode) {
            on("lens-type-" + mode, "click", function () { applyLensMode(mode); });
        });

        // Distortion slider
        on("lens-distortion-slider", "input", function () {
            distortionK = parseFloat(this.value);
            setText("lens-distortion-val", distortionK.toFixed(2));
            checkPostProcess();
        });

        // Blur slider
        on("lens-blur-slider", "input", function () {
            blurAmount = parseFloat(this.value);
            checkPostProcess();
            refreshUI();
        });

        // Vignette slider
        on("lens-vignette-slider", "input", function () {
            vignetteAmount = parseFloat(this.value);
            checkPostProcess();
            setText("lens-vignette-val", vignetteAmount.toFixed(2));
        });

        // CA slider
        on("lens-ca-slider", "input", function () {
            caAmount = parseFloat(this.value);
            checkPostProcess();
            setText("lens-ca-val", caAmount.toFixed(2));
        });

        // Reset
        on("lens-reset-btn", "click", resetLens);

        // Bloqueia propagação de eventos para dock/orbit
        panel.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
        panel.addEventListener("mousedown",   function (e) { e.stopPropagation(); });

        // Atualiza RenderTarget quando resolução ou janela mudam
        on("res-selector", "change", function () { setTimeout(updateRTSize, 150); });
        window.addEventListener("resize", function () { setTimeout(updateRTSize, 150); });
    }

    // ============================================================
    // HELPERS DOM
    // ============================================================

    function on(id, evt, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener(evt, fn);
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function setSliderVal(id, val) {
        var el = document.getElementById(id);
        if (el) el.value = val;
    }

    function toggleClass(id, cls, state) {
        var el = document.getElementById(id);
        if (el) el.classList.toggle(cls, state);
    }

    // ============================================================
    // API GLOBAL
    // ============================================================
    window.LensCamera = {
        setFocal:  applyFocalLength,
        setMode:   applyLensMode,
        reset:     resetLens,
        isActive:  function () { return isPostEnabled; },
        getFocal:  function () { return focalLength; },
        getFOV:    function () { return fovFromFocal(focalLength); }
    };

    // ============================================================
    // INICIALIZAÇÃO
    // ============================================================
    function init() {
        createLensPanel();
        applyFocalLength(50); // Padrão: 50mm
        console.log("[LensCamera] Sistema de lentes v1.0 pronto.");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        setTimeout(init, 250); // Após app.js + skeletonRig.js
    }
})();
