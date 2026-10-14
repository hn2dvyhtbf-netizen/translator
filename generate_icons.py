import os
from PIL import Image, ImageDraw, ImageFont

os.makedirs('icons', exist_ok=True)

def create_app_icon(size, filename):
    # 建立具有科技漸層質感的現代化翻譯圖示
    img = Image.new('RGBA', (size, size), (15, 23, 42, 255)) # 深藍底色 slate-900
    draw = ImageDraw.Draw(img)

    # 繪製圓角矩形背景外框
    margin = int(size * 0.08)
    corner_radius = int(size * 0.22)
    draw.rounded_rectangle(
        [(margin, margin), (size - margin, size - margin)],
        radius=corner_radius,
        fill=(30, 41, 59, 255), # slate-800
        outline=(56, 189, 248, 255), # sky-400
        width=int(size * 0.02)
    )

    # 繪製上半部對話框（代表對面旋轉語言）
    top_box = [
        (int(size * 0.2), int(size * 0.2)),
        (int(size * 0.8), int(size * 0.45))
    ]
    draw.rounded_rectangle(top_box, radius=int(size * 0.06), fill=(16, 185, 129, 255)) # emerald-500

    # 繪製下半部對話框（代表使用者中文）
    bot_box = [
        (int(size * 0.2), int(size * 0.55)),
        (int(size * 0.8), int(size * 0.8))
    ]
    draw.rounded_rectangle(bot_box, radius=int(size * 0.06), fill=(59, 130, 246, 255)) # blue-500

    # 繪製中央雙向互換箭頭符號
    center_y = int(size * 0.5)
    center_x = int(size * 0.5)
    arrow_w = int(size * 0.12)
    arrow_h = int(size * 0.04)

    # 上箭頭 (向右)
    draw.polygon([
        (center_x + arrow_w, center_y - arrow_h),
        (center_x + arrow_w // 2, center_y - arrow_h * 2),
        (center_x + arrow_w // 2, center_y)
    ], fill=(245, 158, 11, 255))
    
    # 下箭頭 (向左)
    draw.polygon([
        (center_x - arrow_w, center_y + arrow_h),
        (center_x - arrow_w // 2, center_y),
        (center_x - arrow_w // 2, center_y + arrow_h * 2)
    ], fill=(245, 158, 11, 255))

    img.save(filename, 'PNG')
    print(f"Icon generated: {filename}")

create_app_icon(192, 'icons/icon-192.png')
create_app_icon(512, 'icons/icon-512.png')
