import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const FLAGS = [
  { name: 'checkout-v2', key: 'checkout-v2', enabled: true, activation: { rollOut: 40 } },
];

const FIXTURE = '/test/e2e/fixtures/fixture.html';

async function mockClientApi(page: Page) {
  await page.route('**/api/client/evaluate', async (route) => {
    await route.fulfill({ json: { toggles: FLAGS } });
  });
}

test('client mode: anonymousId is created and sent in POST /api/client/evaluate', async ({ page }) => {
  let postBody: string | null = null;
  await page.route('**/api/client/evaluate', async (route) => {
    postBody = route.request().postData();
    await route.fulfill({ json: { toggles: FLAGS } });
  });

  await page.goto(FIXTURE);
  await page.waitForFunction(() => localStorage.getItem('mozhno_anon_id'));

  const anonId = await page.evaluate(() => localStorage.getItem('mozhno_anon_id'));
  expect(anonId).toBeTruthy();
  expect(postBody).toBeTruthy();
  expect(JSON.parse(postBody!).context.anonymousId).toBe(anonId);
});

test('reload: anonymousId and result stay stable (sticky)', async ({ page }) => {
  await mockClientApi(page);
  await page.goto(FIXTURE);
  await page.waitForFunction(() => window.__mozhno.ready);

  const anon1 = await page.evaluate(() => localStorage.getItem('mozhno_anon_id'));
  const r1 = await page.evaluate(() => window.__mozhno.client.isEnabled('checkout-v2'));

  await page.reload();
  await page.waitForFunction(() => window.__mozhno.ready);

  const anon2 = await page.evaluate(() => localStorage.getItem('mozhno_anon_id'));
  const r2 = await page.evaluate(() => window.__mozhno.client.isEnabled('checkout-v2'));

  expect(anon2).toBe(anon1);
  expect(r2).toBe(r1);
});

test('stickyAnonId=false: anonymousId is not sent, warn is logged', async ({ page }) => {
  let postBody: string | null = null;
  const warnings: string[] = [];
  page.on('console', (m) => {
    const text = m.text();
    if (text.includes('stickyAnonId')) warnings.push(text);
  });
  await page.route('**/api/client/evaluate', async (route) => {
    postBody = route.request().postData();
    await route.fulfill({ json: { toggles: FLAGS } });
  });

  await page.goto(FIXTURE + '?sticky=false');
  await page.waitForFunction(() => window.__mozhno.ready);
  // calling isEnabled without identifiers triggers the warning
  await page.evaluate(() => window.__mozhno.client.isEnabled('checkout-v2'));

  expect(JSON.parse(postBody!).context.anonymousId).toBeUndefined();
  expect(await page.evaluate(() => localStorage.getItem('mozhno_anon_id'))).toBeNull();
  expect(warnings.join('\n')).toContain('stickyAnonId');
});

test('server mode: local evaluation matches spec buckets (65/72)', async ({ page }) => {
  await page.route('**/api/client/features', async (route) => {
    await route.fulfill({ json: FLAGS });
  });
  await page.goto(FIXTURE + '?mode=server');
  await page.waitForFunction(() => window.__mozhno.ready);

  // bucket('checkout-v2user-1')=28 -> 28<40 true; bucket('checkout-v2anon-1')=49 -> 49<40 false
  await expect.poll(() => page.evaluate(() => ({
    user1: window.__mozhno.client.isEnabled('checkout-v2', { userId: 'user-1' }),
    anon1: window.__mozhno.client.isEnabled('checkout-v2', { anonymousId: 'anon-1' }),
  }))).toEqual({ user1: true, anon1: false });
});

test('server mode: refetch sends If-None-Match (ETag)', async ({ page }) => {
  const ifNoneMatch: string[] = [];
  await page.route('**/api/client/features', async (route) => {
    const req = route.request();
    ifNoneMatch.push(req.headers()['if-none-match'] || '');
    await route.fulfill({ status: 200, headers: { ETag: '"v1"' }, json: FLAGS });
  });

  await page.goto(FIXTURE + '?mode=server&refresh=1');
  await page.waitForFunction(() => window.__mozhno.ready);
  await page.waitForTimeout(1500); // wait for the interval refetch

  expect(ifNoneMatch.length).toBeGreaterThanOrEqual(2);
  expect(ifNoneMatch[0]).toBe('');
  expect(ifNoneMatch.slice(1).every((h) => h === '"v1"')).toBe(true);
});

test('incognito context: separate anonymousId', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await mockClientApi(page1);
  await page1.goto(FIXTURE);
  await page1.waitForFunction(() => localStorage.getItem('mozhno_anon_id'));
  const anonA = await page1.evaluate(() => localStorage.getItem('mozhno_anon_id'));
  await ctx1.close();

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await mockClientApi(page2);
  await page2.goto(FIXTURE);
  await page2.waitForFunction(() => localStorage.getItem('mozhno_anon_id'));
  const anonB = await page2.evaluate(() => localStorage.getItem('mozhno_anon_id'));
  await ctx2.close();

  expect(anonB).not.toBe(anonA);
});

test('server mode: ready and update events fire', async ({ page }) => {
  await page.route('**/api/client/features', async (route) => {
    await route.fulfill({ json: FLAGS });
  });
  await page.goto(FIXTURE + '?mode=server');
  await page.waitForFunction(() => window.__mozhno.ready);

  const log = await page.evaluate(() => window.__mozhno.log.join('\n'));
  expect(log).toContain('[ready]');
  expect(log).toContain('[update]');
});

test('two clients in one tab share the same anonymousId', async ({ page }) => {
  await mockClientApi(page);
  await page.goto(FIXTURE);
  await page.waitForFunction(() => window.__mozhno.ready);

  const result = await page.evaluate(async (flagKey) => {
    const { MozhnoClient } = await import('/dist/mozhno-client.mjs');
    const second = new MozhnoClient({
      url: 'http://localhost:4173',
      clientKey: 'test-key',
      appName: 'e2e-2',
      mode: 'client',
    });
    await new Promise<void>((resolve) => {
      second.on('ready', () => resolve());
      second.start();
    });
    return {
      anon1: localStorage.getItem('mozhno_anon_id'),
      anon2: localStorage.getItem('mozhno_anon_id'),
      r1: window.__mozhno.client.isEnabled(flagKey),
      r2: second.isEnabled(flagKey),
    };
  }, 'checkout-v2');

  expect(result.anon2).toBe(result.anon1);
  expect(result.r2).toBe(result.r1);
});

test('unreachable server: error event fires and ready does not', async ({ page }) => {
  // simulate a dead server: every request aborts -> all retries fail -> 'error' only
  await page.route('**/api/client/features', (route) => route.abort('connectionfailed'));
  await page.goto(FIXTURE + '?mode=server');
  await page.waitForFunction(() => window.__mozhno.log.join('\n').includes('[error]'), null, { timeout: 15000 });

  const log = await page.evaluate(() => window.__mozhno.log.join('\n'));
  expect(log).toContain('[error]');
  expect(log).not.toContain('[ready]');
});
