import os
import sys
from PIL import Image, ImageFilter

def process_image(img_path, mode="blur", bg_color=(255, 255, 255)):
    if not os.path.exists(img_path):
        print(f"Error: File '{img_path}' does not exist.")
        return

    try:
        with Image.open(img_path) as img:
            orig_w, orig_h = img.size
            print(f"Original image size: {orig_w}x{orig_h}")
            
            target_w = 1080
            target_h = 1920
            
            if mode == "blur":
                print("Processing with blurred background...")
                # Scale background to cover the canvas
                scale_bg = max(target_w / orig_w, target_h / orig_h)
                bg_w = int(orig_w * scale_bg)
                bg_h = int(orig_h * scale_bg)
                bg = img.resize((bg_w, bg_h), Image.Resampling.LANCZOS)
                
                # Crop background to target size
                left = (bg_w - target_w) // 2
                top = (bg_h - target_h) // 2
                bg_cropped = bg.crop((left, top, left + target_w, top + target_h))
                
                # Apply blur
                canvas = bg_cropped.filter(ImageFilter.GaussianBlur(radius=40))
                
                # Center-fit original image
                scale_fit = target_w / orig_w
                fit_w = target_w
                fit_h = int(orig_h * scale_fit)
                img_fit = img.resize((fit_w, fit_h), Image.Resampling.LANCZOS)
                
                paste_y = (target_h - fit_h) // 2
                canvas.paste(img_fit, (0, paste_y))
                
            elif mode == "solid":
                # Auto-sample color from the top-left corner if requested
                if bg_color == "auto":
                    # Sample a few pixels around the edge and average them
                    pixels = [img.getpixel((0, 0)), img.getpixel((orig_w-1, 0)), img.getpixel((0, orig_h-1)), img.getpixel((orig_w-1, orig_h-1))]
                    # Handle RGB / RGBA
                    r = sum(p[0] for p in pixels) // len(pixels)
                    g = sum(p[1] for p in pixels) // len(pixels)
                    b = sum(p[2] for p in pixels) // len(pixels)
                    bg_color = (r, g, b)
                    print(f"Auto-sampled edge color: {bg_color}")
                else:
                    print(f"Processing with solid background color: {bg_color}...")
                
                # Create canvas with selected color
                canvas = Image.new("RGB", (target_w, target_h), bg_color)
                
                # Fit the image to the target width, keeping aspect ratio
                scale_fit = target_w / orig_w
                fit_w = target_w
                fit_h = int(orig_h * scale_fit)
                img_fit = img.resize((fit_w, fit_h), Image.Resampling.LANCZOS)
                
                paste_y = (target_h - fit_h) // 2
                canvas.paste(img_fit, (0, paste_y))
                
            elif mode == "crop":
                print("Processing with scale & crop to fill...")
                # Scale image to cover the canvas, cropping out excess
                scale = max(target_w / orig_w, target_h / orig_h)
                new_w = int(orig_w * scale)
                new_h = int(orig_h * scale)
                img_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
                
                left = (new_w - target_w) // 2
                top = (new_h - target_h) // 2
                canvas = img_resized.crop((left, top, left + target_w, top + target_h))
            
            # Save the result
            file_name, file_ext = os.path.splitext(img_path)
            output_path = f"{file_name}_1080x1920_{mode}{file_ext}"
            canvas.save(output_path, quality=95)
            print(f"Success! Saved output to: {output_path}\n")
            
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scratch/resize_image.py <image_path> [mode] [color]")
        print("Modes: blur (default), solid, crop")
        print("Colors for solid mode: white, black, auto (sampled from corners)")
        
        # If no arguments provided, test it on the first image found
        test_images = ["IMG-20260514-WA0020.jpg", "IMG-20260514-WA0021.jpg", "IMG-20260514-WA0022.jpg"]
        found = False
        for img in test_images:
            if os.path.exists(img):
                print(f"\n--- Automatically running on found image: {img} ---")
                process_image(img, "blur")
                process_image(img, "solid", (255, 255, 255)) # White fill
                process_image(img, "solid", "auto") # Auto-sampled edge color
                found = True
                break
        if not found:
            print("No default test images found in workspace. Please provide image path.")
    else:
        path = sys.argv[1]
        mode = sys.argv[2] if len(sys.argv) > 2 else "blur"
        
        bg = (255, 255, 255)
        if len(sys.argv) > 3:
            color_arg = sys.argv[3].lower()
            if color_arg == "black":
                bg = (0, 0, 0)
            elif color_arg == "auto":
                bg = "auto"
            elif color_arg == "white":
                bg = (255, 255, 255)
                
        process_image(path, mode, bg)
