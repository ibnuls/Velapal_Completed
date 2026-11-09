const path = require('path');
const { chromium, expect } = require(path.join(__dirname, '../../apps/web/node_modules/@playwright/test'));
(async () => {
  const [base, caseId, screenshot] = process.argv.slice(2);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const page = await browser.newPage({viewport: {width: 1440, height: 1080}});
  const failures = [];
  page.on('pageerror', e => failures.push(e.message));
  try {
    await page.goto(base + '/login');
    await page.getByRole('textbox', {name: 'Email', exact: true}).fill('customer@velapal.demo');
    await page.getByRole('textbox', {name: 'Password', exact: true}).fill('correct-horse-battery-staple');
    await page.getByRole('button', {name: 'Sign in', exact: true}).click();
    await page.waitForURL('**/workspace/**', {timeout: 30000});
    await page.goto(base + '/workspace/cases/' + caseId);
    await page.getByRole('button', {name: 'Mediation & consent', exact: true}).click();
    const create = page.getByRole('button', {name: 'Create proposal', exact: true});
    await expect(create).toBeEnabled({timeout: 20000});
    await page.getByRole('checkbox', {name: /I reviewed assessment/}).check();
    await expect(page.getByRole('button', {name: 'Record mediation decision', exact: true})).toBeEnabled();
    await expect(page.getByText('Consent/proposal drafting unavailable until backend supplies', {exact: false})).toHaveCount(0);
    if (failures.length) throw new Error('Browser page errors: ' + failures.join('; '));
    await page.screenshot({path: screenshot, fullPage: true});
    console.log('API-mode UI verified: exact backend assessment, consent binding and source digest enable controls.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exit(1); });
