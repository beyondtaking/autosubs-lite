# App Icons

The PNG files here are placeholder icons (green squares).
Replace them with real icons before distribution:

| File | Size | Usage |
|---|---|---|
| 32x32.png | 32×32 | Windows taskbar |
| 128x128.png | 128×128 | macOS, Linux |
| 128x128@2x.png | 256×256 | macOS Retina |
| icon.icns | multi-size | macOS app bundle |
| icon.ico | multi-size | Windows installer |

## Generating from a source image

With ImageMagick:
```bash
convert icon-1024.png -resize 32x32   32x32.png
convert icon-1024.png -resize 128x128 128x128.png
convert icon-1024.png -resize 256x256 128x128@2x.png

# macOS .icns
mkdir icon.iconset
convert icon-1024.png -resize 16x16   icon.iconset/icon_16x16.png
convert icon-1024.png -resize 32x32   icon.iconset/icon_16x16@2x.png
convert icon-1024.png -resize 128x128 icon.iconset/icon_128x128.png
convert icon-1024.png -resize 256x256 icon.iconset/icon_128x128@2x.png
convert icon-1024.png -resize 512x512 icon.iconset/icon_256x256@2x.png
iconutil -c icns icon.iconset

# Windows .ico
convert icon-1024.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```
