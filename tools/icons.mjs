import sharp from 'sharp'; import fs from 'fs';
const svg=fs.readFileSync('icons/icon.svg');
for (const n of [180,192,512]) await sharp(svg).resize(n,n).png().toFile(`icons/icon-${n}.png`);
// maskable: margem de segurança
await sharp({create:{width:512,height:512,channels:4,background:'#1b2a4a'}}).composite([{input:await sharp(svg).resize(400,400).png().toBuffer(),top:56,left:56}]).png().toFile('icons/icon-maskable-512.png');
