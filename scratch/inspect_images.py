import os
from PIL import Image

images = ["IMG-20260514-WA0020.jpg", "IMG-20260514-WA0021.jpg", "IMG-20260514-WA0022.jpg"]

for img_name in images:
    if os.path.exists(img_name):
        try:
            with Image.open(img_name) as img:
                print(f"{img_name}: {img.size} (format: {img.format}, mode: {img.mode})")
        except Exception as e:
            print(f"Error reading {img_name}: {e}")
    else:
        print(f"{img_name} does not exist")
