// Rebuilds the app icons using the showroom backend's existing Sharp dependency.
const sharp = require('../../backend/node_modules/sharp');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'assets');
const badge = (background, foreground, transparent = false) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${transparent ? '' : `<rect width="1024" height="1024" rx="220" fill="${background}"/>`}
  <rect x="218" y="194" width="588" height="636" rx="96" fill="none" stroke="${foreground}" stroke-width="30"/>
  <path d="M333 693V336l358 357V336" fill="none" stroke="${foreground}" stroke-width="67" stroke-linecap="square" stroke-linejoin="round"/>
  <path d="M359 763h23m53 0h18m45 0h28m47 0h15m37 0h19m32 0h15" stroke="${foreground}" stroke-width="22"/>
</svg>`);

async function main() {
  await sharp(badge('#102e23', '#fffaf0')).png().toFile(path.join(assets, 'icon.png'));
  await sharp(badge('#102e23', '#fffaf0', true)).png().toFile(path.join(assets, 'android-icon-foreground.png'));
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#102e23' } }).png().toFile(path.join(assets, 'android-icon-background.png'));
  await sharp(badge('#000000', '#ffffff', true)).png().toFile(path.join(assets, 'android-icon-monochrome.png'));
  await sharp(badge('#102e23', '#fffaf0')).resize(64, 64).png().toFile(path.join(assets, 'favicon.png'));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
