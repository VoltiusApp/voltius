# Generate the brand-gradient background + shadow + rounded-window mask for framing a
# video, reusing the real docs frame.py (single source of truth for the brand look).
# Usage: python3 frame_video.py <video_w> <video_h> <out_dir>   (frame.py must be importable)
import sys, json
from PIL import Image, ImageDraw, ImageFilter
import frame  # sibling copy of docs/tools/screenshots/frame.py

W, H, OUT = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
pad = int(W * frame.PAD_RATIO)
radius = max(10, int(W * 0.013))
cw, ch = W + pad * 2, H + pad * 2

canvas = frame._gradient(cw, ch)  # brand navy->lift gradient + top-left accent glow

# rounded-window mask (drives both the shadow silhouette and the video's alpha)
mask = Image.new("L", (W, H), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, H - 1], radius=radius, fill=255)

# drop shadow — identical params to frame.frame_image()
shadow = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
shaped = Image.new("RGBA", (W, H), (0, 0, 0, 0))
shaped.paste(Image.new("RGBA", (W, H), (0, 0, 0, 150)), (0, 0), mask)
shadow.paste(shaped, (pad, pad + int(pad * 0.18)), shaped)
shadow = shadow.filter(ImageFilter.GaussianBlur(int(pad * 0.4)))
canvas = Image.alpha_composite(canvas, shadow)

canvas.convert("RGB").save(f"{OUT}/frame_bg.png")
mask.save(f"{OUT}/frame_mask.png")
print(json.dumps({"pad": pad, "radius": radius, "cw": cw, "ch": ch, "target_w": 1600}))
