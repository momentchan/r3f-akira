import { chromium } from 'playwright';
const url = process.argv[2] || 'https://localhost:5175/';
const out = process.argv[3] || 'shot.png';
const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--ignore-certificate-errors'],
});
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForTimeout(6000);
await page.screenshot({ path: out });
console.log('SAVED', out);
if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 10).join('\n'));
await browser.close();
