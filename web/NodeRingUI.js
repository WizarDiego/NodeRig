import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "NodeRig.3DViewer",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // Find our python class name
        if (nodeData.name === "NodeRing") {
            // Keep the original onNodeCreated if any
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

                // Create an iframe to embed our natively hosted frontend
                const iframe = document.createElement("iframe");
                
                // Point to the native aiohttp static route we registered in __init__.py
                // Use a relative path from ComfyUI root and a timestamp to bust cache
                iframe.src = "/noderig_ui/index.html?t=" + Date.now();
                Object.assign(iframe.style, {
                    width: "100%",
                    height: "100%",
                    border: "none",
                    borderRadius: "8px",
                });

                // Add the widget as a DOM widget in LiteGraph
                const widget = this.addDOMWidget("NodeRingViewer", "iframe", iframe, {
                    serialize: false,
                    hideOnZoom: false,
                });

                // Establish exactly how large the node will be by default
                widget.computeSize = function() {
                    return [600, 600]; // Larger, better 3D posing window
                };
                
                // Force node dimension resize to accommodate without clipping
                this.setSize([600, 650]);

                return r;
            };
        }
    }
});
