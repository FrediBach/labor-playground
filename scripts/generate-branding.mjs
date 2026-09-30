import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'

// Vector source keeps the sharing card and favicon easy to update together.
const icon = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><pattern id="holes" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="13" cy="13" r="2" fill="#526457"/></pattern></defs>
<rect width="1200" height="630" fill="#1d2421"/>
<rect x="760" width="440" height="630" fill="url(#holes)"/>
<path d="M820 175h130v130h150M845 455h180V355h75" fill="none" stroke="#d5edb0" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
<g fill="#1d2421" stroke="#d5edb0" stroke-width="7"><circle cx="820" cy="175" r="13"/><circle cx="1100" cy="305" r="13"/><circle cx="845" cy="455" r="13"/><circle cx="1100" cy="355" r="13"/></g>
<rect x="64" y="65" width="62" height="62" rx="14" fill="#d5edb0"/>
<path d="M85 111V81h13a9 9 0 0 1 0 18H85" fill="none" stroke="#1d2421" stroke-width="5"/>
<text x="146" y="103" font-family="Arial, sans-serif" font-size="18" letter-spacing="3" fill="#d5edb0">PATCH. EXPERIMENT. LEARN.</text>
<text x="64" y="285" font-family="Arial, sans-serif" font-size="100" font-weight="700" letter-spacing="-4" fill="#f0f3ed">Pico Labor</text>
<text x="68" y="355" font-family="Arial, sans-serif" font-size="31" fill="#c1cdc3">Your virtual electronics workbench.</text>
<text x="68" y="405" font-family="Arial, sans-serif" font-size="24" fill="#94a69a">Build circuits. Program a Pico. Explore.</text>
<text x="68" y="551" font-family="Arial, sans-serif" font-size="22" fill="#d5edb0">picolabor.com</text>
</svg>`
await writeFile(new URL('../public/og-image.svg', import.meta.url), card + '\n')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const [svg, width, height, name] of [
    [card, 1200, 630, 'og-image.png'],
    [icon, 32, 32, 'favicon-32.png'],
    [icon, 180, 180, 'apple-touch-icon.png'],
  ]) {
    await page.setViewportSize({ width, height })
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${svg}`)
    await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname, omitBackground: true })
  }
} finally {
  await browser.close()
}
