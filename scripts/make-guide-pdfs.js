// Renders the one-page guides in docs/ into the PDFs the How it works page offers,
// one per job: creating a safe, proposing, signing. Run after editing any of them:
//   PUPPETEER_PATH=<a puppeteer-core> node scripts/make-guide-pdfs.js
// puppeteer-core is not a dependency of the app: it is only needed to print these
// PDFs, so the script resolves it from wherever it is installed.
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer-core');
const { resolve } = require('node:path');

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

// The signer's file keeps its name: it has been emailed since October 2026.
const GUIDES = [
  ['creator-guide.html', 'mvxsafe-create-a-safe.pdf'],
  ['proposer-guide.html', 'mvxsafe-propose.pdf'],
  ['signer-guide.html', 'mvxsafe-for-signers.pdf']
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  for (const [source, pdf] of GUIDES) {
    await page.goto(`file://${resolve(__dirname, '../docs', source)}`, {
      waitUntil: 'networkidle0'
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
