// Renders the PWA icon set from web/public/pwa/*.svg. Run: node web/scripts/icons.mjs
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const dir = new URL('../public/pwa/', import.meta.url)
const render = (svg, size, out, background) => {
  const png = new Resvg(readFileSync(new URL(svg, dir), 'utf8'), { fitTo: { mode: 'width', value: size }, ...(background ? { background } : {}) }).render().asPng()
  writeFileSync(new URL(out, dir), png)
}
render('icon.svg', 192, 'icon-192.png')
render('icon.svg', 512, 'icon-512.png')
render('icon.svg', 180, 'apple-touch-icon.png', '#1e1b4b')
render('icon-maskable.svg', 192, 'icon-maskable-192.png')
render('icon-maskable.svg', 512, 'icon-maskable-512.png')
render('badge.svg', 96, 'badge-96.png')
copyFileSync(new URL('icon-512.png', dir), new URL('../../../Apps/Aube/icon.png', dir))
console.log('icons written')
