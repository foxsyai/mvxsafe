// Renders the one-page guides in docs/ into the PDFs the How it works page offers,
// one per job: creating a safe, proposing, signing. Run after editing any of them:
//   node scripts/make-guide-pdfs.js
// It prints through Playwright, already a dev dependency, with the installed
// Chrome (CHROME_PATH for another). It used puppeteer-core from another project
// until 5 Nov 2026; the same page printed both ways gives the same text and look.
const { chromium } = require('@playwright/test');
const { resolve } = require('node:path');

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

// The signer's file keeps its name: it has been emailed since October 2026.
const GUIDES = [
  ['creator-guide.html', 'mvxsafe-create-a-safe.pdf'],
  ['proposer-guide.html', 'mvxsafe-propose.pdf'],
  ['signer-guide.html', 'mvxsafe-for-signers.pdf']
];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage();
  for (const [source, pdf] of GUIDES) {
    await page.goto(`file://${resolve(__dirname, '../docs', source)}`, {
      waitUntil: 'networkidle'
    });
    await page.pdf({
      path: resolve(__dirname, '../public', pdf),
      format: 'A4',
      printBackground: true
    });
    console.log(`public/${pdf} written`);
  }
  await browser.close();
})();
