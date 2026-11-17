from PIL import Image, ImageDraw

S = 512
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

# rounded warm background with vertical gradient
grad = Image.new('RGB', (1, S))
for y in range(S):
    t = y / (S - 1)
    grad.putpixel((0, y), (int(255 * (1 - t) + 240 * t), int(214 * (1 - t) + 140 * t), int(186 * (1 - t) + 104 * t)))
grad = grad.resize((S, S))
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=112, fill=255)
img.paste(grad, (0, 0), mask)
d = ImageDraw.Draw(img)

# soft white card
d.rounded_rectangle([86, 78, 426, 434], radius=54, fill=(255, 253, 250, 255))
# top binder dots
for cx in (166, 256, 346):
    d.rounded_rectangle([cx - 13, 108, cx + 13, 134], radius=10, fill=(246, 200, 178, 255))
# divider
d.rounded_rectangle([118, 152, 394, 166], radius=7, fill=(255, 226, 212, 255))

colors = [
    (229, 244, 198, 90, 122, 31),
    (215, 236, 251, 42, 106, 147),
    (232, 221, 248, 101, 67, 154),
    (251, 216, 228, 164, 66, 95),
    (252, 240, 188, 138, 106, 16),
    (209, 239, 226, 42, 122, 95),
]
x0, y0, w, h, gx, gy = 118, 186, 126, 68, 16, 14
for i, (r, g, b, fr, fg, fb) in enumerate(colors):
    col = i % 2
    row = i // 2
    x = x0 + col * (w + gx)
    y = y0 + row * (h + gy)
    d.rounded_rectangle([x, y, x + w, y + h], radius=20, fill=(r, g, b, 255))
    d.rounded_rectangle([x + 18, y + 19, x + 78, y + 28], radius=5, fill=(fr, fg, fb, 190))
    d.rounded_rectangle([x + 18, y + 40, x + 58, y + 49], radius=5, fill=(fr, fg, fb, 110))

img.save('icon-512.png')
img.resize((192, 192), Image.LANCZOS).save('icon-192.png')
img.resize((180, 180), Image.LANCZOS).save('apple-touch-icon.png')
print('ok')
