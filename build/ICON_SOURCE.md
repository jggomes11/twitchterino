# Application icon

Source: Twitch's official brand bundle, https://brand.twitch.com/uploads/Twitch-Brand.zip,
asset Twitch Logos/02. Glitch/01. Twitch Purple/glitch_flat_purple.png.
The matching SVG is preserved as twitch-glitch.svg.

The official purple Glitch is scaled proportionally within a transparent 512×512 icon canvas.
No changes to the logo geometry or colors. Windows ICO contains 16, 24, 32, 48, 64, 128 and 256 pixel frames.

Generate the runtime PNG and Windows resource with ImageMagick:

    convert glitch_flat_purple.png -resize 448x448 -gravity center -background none -extent 512x512 icon.png
    convert icon.png -define icon:auto-resize=256,128,64,48,32,24,16 icon.ico

Runtime windows/tray/notifications use build/icon.png; the Windows installer/app executable uses build/icon.ico.
