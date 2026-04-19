import base64
import re
from io import BytesIO
import numpy as np
import torch
from PIL import Image

class NodeRing:
    
    # Store the latest strings here so they can be accessed
    latest_pose_b64 = ""
    latest_bg_b64 = ""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flip_horizontal": ("BOOLEAN", {
                    "default": False,
                    "label_on": "↔ Flipado",
                    "label_off": "Normal"
                }),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("pose_image", "background_image")
    FUNCTION = "process"
    CATEGORY = "NodeRig"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def decode_image(self, b64_str, flip=False):
        if not b64_str:
            empty_image = np.zeros((512, 512, 3), dtype=np.float32)
            return torch.from_numpy(empty_image)[None,]
        
        base64_data = re.sub('^data:image/.+;base64,', '', b64_str)
        image_data = base64.b64decode(base64_data)
        img = Image.open(BytesIO(image_data))
        
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        if flip:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
            
        image_np = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(image_np)[None,]

    def process(self, flip_horizontal=False):
        # 1. Decode Main Render (Pose)
        pose_tensor = self.decode_image(NodeRing.latest_pose_b64, flip_horizontal)
        
        # 2. Decode Background (No flip usually, or follow flip if user wants)
        # Assuming background should ALSO flip if the whole scene is flipped
        bg_tensor = self.decode_image(NodeRing.latest_bg_b64, flip_horizontal)
        
        return (pose_tensor, bg_tensor)
