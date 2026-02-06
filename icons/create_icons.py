from PIL import Image, ImageDraw, ImageFont

def create_icon(size, filename):
    # Create image with gradient-like background
    img = Image.new('RGBA', (size, size), (102, 126, 234, 255))
    draw = ImageDraw.Draw(img)
    
    # Draw a robot emoji representation
    center = size // 2
    
    # Robot head (rounded rectangle approximation)
    head_size = int(size * 0.6)
    head_x = center - head_size // 2
    head_y = int(size * 0.15)
    draw.rounded_rectangle(
        [head_x, head_y, head_x + head_size, head_y + head_size],
        radius=size//8,
        fill=(30, 30, 60, 255)
    )
    
    # Eyes
    eye_size = int(size * 0.12)
    eye_y = head_y + int(head_size * 0.35)
    left_eye_x = center - int(head_size * 0.2)
    right_eye_x = center + int(head_size * 0.2) - eye_size
    
    draw.ellipse([left_eye_x, eye_y, left_eye_x + eye_size, eye_y + eye_size], fill=(72, 187, 120, 255))
    draw.ellipse([right_eye_x, eye_y, right_eye_x + eye_size, eye_y + eye_size], fill=(72, 187, 120, 255))
    
    # Mouth
    mouth_y = head_y + int(head_size * 0.65)
    mouth_width = int(head_size * 0.4)
    draw.rectangle(
        [center - mouth_width//2, mouth_y, center + mouth_width//2, mouth_y + size//16],
        fill=(72, 187, 120, 255)
    )
    
    # Antenna
    antenna_height = int(size * 0.1)
    draw.line([center, head_y, center, head_y - antenna_height], fill=(200, 200, 200, 255), width=max(2, size//24))
    draw.ellipse([center - size//16, head_y - antenna_height - size//16, center + size//16, head_y - antenna_height + size//16], fill=(72, 187, 120, 255))
    
    img.save(filename)
    print(f"Created {filename}")

try:
    create_icon(48, 'icon48.png')
    create_icon(128, 'icon128.png')
    print("Icons created successfully!")
except Exception as e:
    print(f"Error: {e}")
