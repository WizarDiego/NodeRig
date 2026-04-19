import server
from aiohttp import web
import sys
import os

# Adds the current directory to path if needed
base_dir = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, base_dir)

from .node import NodeRing

NODE_CLASS_MAPPINGS = {
    "NodeRing": NodeRing
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NodeRing": "NodeRing Output"
}

# Configuração e Criação do Sistema de Estrutura File System da v3 (Asset System)
os.makedirs(os.path.join(base_dir, "input_3d"), exist_ok=True)
os.makedirs(os.path.join(base_dir, "assets", "models"), exist_ok=True)
os.makedirs(os.path.join(base_dir, "assets", "objects"), exist_ok=True)
os.makedirs(os.path.join(base_dir, "assets", "characters"), exist_ok=True)

# Global variable to store the latest base64 pose
NodeRing.latest_pose_b64 = ""

# Setup purely native ComfyUI static route for the frontend files
frontend_path = os.path.join(base_dir, "frontend")
assets_path = os.path.join(base_dir, "assets")

server.PromptServer.instance.app.add_routes([
    web.static('/noderig_ui', frontend_path),
    web.static('/noderig_assets', assets_path)
])

import folder_paths
import base64
import re
from io import BytesIO
from PIL import Image

@server.PromptServer.instance.routes.post("/NodeRing")
async def node_ring_post(request):
    try:
        data = await request.json()
        if "image_base64" in data:
            NodeRing.latest_pose_b64 = data["image_base64"]
            # Opcionalmente recebe a imagem de fundo separada
            if "background_base64" in data:
                NodeRing.latest_bg_b64 = data["background_base64"]
            return web.json_response({"status": "success", "message": "Imagens sincronizadas com Memória do Nó"})
        else:
            return web.json_response({"status": "error", "message": "Faltando image_base64"}, status=400)
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/NodeRing/SaveInput")
async def noderig_save_input(request):
    try:
        data = await request.json()
        image_base64 = data.get("image_base64")
        if not image_base64:
            return web.json_response({"status": "error", "message": "Faltando image_base64"}, status=400)
            
        # Puxamos o path padrao oficial do /input/ do ComfyUI
        input_dir = folder_paths.get_input_directory()
        filepath = os.path.join(input_dir, "noderig_pose.png")
        
        base64_data = re.sub('^data:image/.+;base64,', '', image_base64)
        image_bytes = base64.b64decode(base64_data)
        img = Image.open(BytesIO(image_bytes))
        img.save(filepath)
        
        return web.json_response({"status": "success", "message": "Salvo na pasta /input/ com sucesso!"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/NodeRing/UploadGLB")
async def noderig_upload_glb(request):
    try:
        reader = await request.multipart()
        field = await reader.next()
        if field.name == 'file':
            # Save it permanently to the assets/models folder
            filepath = os.path.join(base_dir, "assets", "models", "last_loaded.glb")
            with open(filepath, 'wb') as f:
                while True:
                    chunk = await field.read_chunk()
                    if not chunk:
                        break
                    f.write(chunk)
            return web.json_response({"status": "success", "message": "Upload GLB processado", "url": "/noderig_assets/models/last_loaded.glb"})
        return web.json_response({"status": "error", "message": "Nenhum arquivo (file) enviado no form"}, status=400)
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/NodeRing/ClearGLB")
async def noderig_clear_glb(request):
    try:
        filepath = os.path.join(base_dir, "assets", "models", "last_loaded.glb")
        if os.path.exists(filepath):
            os.remove(filepath)
        return web.json_response({"status": "success", "message": "Arquivo temporário deletado com sucesso!"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
