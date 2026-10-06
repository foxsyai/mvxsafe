// Renders docs/signer-guide.html into public/mvxsafe-for-signers.pdf, the one
// page a board member needs. Run after editing the HTML:  node scripts/make-signer-pdf.js
// puppeteer-core is not a dependency of the app: it is only needed to print this
// one PDF, so the script resolves it from wherever it is installed.
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer-core');
const { resolve } = require('node:path');

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`file://${resolve(__dirname, '../docs/signer-guide.html')}`, {
    waitUntil: 'networkidle0'
  });
  await page.pdf({
    path: resolve(__dirname, '../public/mvxsafe-for-signers.pdf'),
    format: 'A4',
    printBackground: true
  });
  await browser.close();
  console.log('public/mvxsafe-for-signers.pdf written');
})();
