// Generate simple PNG icons from SVG for PWA
// Run: node scripts/generate-icons.js

const fs = require('fs');
const path = require('path');

// Simple 1-pixel PNG generator (solid color with text overlay isn't possible without canvas,
// so we'll create a minimal valid PNG with the Hungarian flag colors)

function createMinimalPNG(size) {
  // Create a simple PNG with green background (Hungarian green #1a7a4c)
  // This is a minimal valid PNG file
  const { createCanvas } = (() => {
    try { return require('canvas'); } catch { return {}; }
  })();

  if (createCanvas) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#1a7a4c';
    ctx.fillRect(0, 0, size, size);

    // White "HU" text
    ctx.fillStyle = 'white';
    ctx.font = `bold ${Math.floor(size * 0.35)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HU', size / 2, size / 2);

    return canvas.toBuffer('image/png');
  }

  // Fallback: create a 1x1 green PNG and let the browser scale it
  // Minimal valid PNG (green pixel)
  const png = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xD7, 0x63, 0x90, 0xE1, 0x96, 0x00,
    0x00, 0x00, 0x04, 0x00, 0x01, 0xF6, 0x17, 0x8E,
    0xAA, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
    0x44, 0xAE, 0x42, 0x60, 0x82,
  ]);
  return png;
}

const iconsDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [192, 512]) {
  const buf = createMinimalPNG(size);
  fs.writeFileSync(path.join(iconsDir, `icon-${size}.png`), buf);
  console.log(`Created icon-${size}.png`);
}
