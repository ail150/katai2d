const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', err => console.log('ERROR:', err.message));
  page.on('request', req => console.log('REQ:', req.method(), req.url()));
  page.on('response', res => console.log('RES:', res.status(), res.url()));

  await page.goto('http://127.0.0.1:5174/');
  await page.waitForTimeout(1000);
  
  console.log('Submitting form...');
  await page.getByPlaceholder('Enter server access token').fill('local-development-token');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForTimeout(3000);
  
  await browser.close();
})();
