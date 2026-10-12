// Run against an isolated, rebuilt native Monocode instance with local-only CDP enabled.
// This deliberately does not mock Tauri IPC or load the app in a normal Chromium tab.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const endpoint = process.env.MONOCODE_SMOKE_CDP;
if (!endpoint || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(endpoint)) {
  throw new Error('Set MONOCODE_SMOKE_CDP to a local isolated WebView2 debugging endpoint.');
}
const output = 'test-results/browser-native-smoke';
await mkdir(output, { recursive: true });
const requests = [];
const server = http.createServer((request, response) => {
  requests.push(request.url);
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: '/second' });
    response.end();
    return;
  }
  const second = request.url === '/second';
  const label = second ? 'second' : request.url === '/device' ? 'device' : 'first';
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>Monocode smoke ${label}</title>
    <main style="font:24px sans-serif;background:#e6f4ea;color:#123;padding:30px">
    <h1 id="native-proof">Native Monocode Browser: ${second ? 'second' : 'first'}</h1>
    <a href="/redirect">Follow redirect</a><input aria-label="Page text input"></main>
    ${request.url === '/delayed' ? '<script>setTimeout(() => location.href="/second", 3000)</script>' : ''}`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const evidence = {
  startedAt: new Date().toISOString(),
  endpoint, fixture: origin, checks: [], status: 'partial',
  googleSearchRequested: process.env.MONOCODE_SMOKE_GOOGLE === '1',
  smokeProcessId: process.env.MONOCODE_SMOKE_PID ?? null,
};
const record = name => { evidence.checks.push(name); console.log(`PASS: ${name}`); };
try {
  browser = await chromium.connectOverCDP(endpoint);
  const pages = () => browser.contexts().flatMap(context => context.pages());
  const shell = pages().find(page => /^(https?:\/\/(tauri\.localhost|localhost:1420)|tauri:\/\/localhost)/.test(page.url()));
  assert(shell, 'Native Tauri shell must be discoverable; do not substitute a web-only app.');
  assert(await shell.evaluate(() => Boolean(window.__TAURI_INTERNALS__)), 'Native IPC must be present.');
  const appName = await shell.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:app|name'));
  assert.equal(appName, 'Monocode Browser Smoke', 'Refuse to automate the normal user app or profile.');
  evidence.appName = appName;
  const onboarding = shell.getByRole('dialog', { name: 'Meet Monos', exact: true });
  if (await onboarding.isVisible()) await onboarding.getByRole('button', { name: 'Not now', exact: true }).click();
  if (!(await shell.getByLabel('Right Panel Surfaces', { exact: true }).isVisible())) {
    await shell.getByRole('button', { name: 'Toggle Right Panel', exact: true }).click();
  }
  await shell.evaluate(() => { document.activeElement?.blur(); });
  await shell.keyboard.press('b');
  const surface = shell.getByTestId('browser-surface');
  await surface.waitFor({ state: 'visible' });
  record('B opens Browser in the native right panel');
  const address = surface.getByPlaceholder('google.com o buscar en la web...');
  const existingChild = pages().find(page => page !== shell && /^http:\/\/127\.0\.0\.1:\d+\//.test(page.url()));
  const childReady = existingChild ? Promise.resolve(existingChild) : Promise.any(browser.contexts().map(context =>
    context.waitForEvent('page', { timeout: 20000 }).then(async page => {
      await page.waitForURL(`${origin}/**`, { timeout: 20000 });
      return page;
    }),
  ));
  // Register before navigation so fast native creation cannot lose its page event.
  void childReady.catch(() => {});
  const enterAddress = async (input, value) => {
    // Popovers restore focus asynchronously. Click first, then explicitly replace text
    // through the same keys a user uses, rather than racing controlled-input focus.
    await input.click();
    await input.press('ControlOrMeta+A');
    await input.press('Backspace');
    await input.pressSequentially(value);
    await input.press('Enter');
  };
  await enterAddress(address, `${origin}/first`);
  // Wait on actual native child-page creation, not on the mocked shell viewport.
  const child = pages().find(page => page.url().startsWith(origin)) ?? await childReady;
  await child.waitForURL(`${origin}/first`, { timeout: 20000 });
  await child.locator('#native-proof').waitFor();
  assert.match(await child.locator('#native-proof').textContent(), /first/);
  await child.screenshot({ path: `${output}/native-page.png` });
  await shell.screenshot({ path: `${output}/shell.png` });
  if (process.env.MONOCODE_SMOKE_PID) {
    try {
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-File', 'scripts/capture-browser-smoke.ps1', '-SmokeProcessId', process.env.MONOCODE_SMOKE_PID]);
      evidence.nativeCapture = 'test-results/browser-native-smoke/native-window.png (requires visual readback)';
    } catch (error) {
      evidence.nativeCaptureUnavailable = String(error);
      console.error('Native visual capture unavailable:', String(error));
    }
  }
  record('Local fixture renders in a distinct native child WebView2');
  const ipcAttempt = await child.evaluate(async () => {
    if (!window.__TAURI_INTERNALS__?.invoke) return { denied: true, reason: 'No remote IPC bridge' };
    try { await window.__TAURI_INTERNALS__.invoke('browser_hide'); return { denied: false }; }
    catch (error) { return { denied: true, reason: String(error) }; }
  });
  assert(ipcAttempt.denied, 'Remote fixture must not be authorized to invoke native browser commands.');
  record('Remote page cannot invoke native Browser IPC');
  await child.getByRole('textbox', { name: 'Page text input' }).fill('preserve native history state');
  await child.getByRole('link', { name: 'Follow redirect' }).click();
  await child.waitForURL(`${origin}/second`);
  await shell.waitForFunction(() => document.querySelector('[data-testid="browser-surface"] input')?.value.includes('/second'));
  record('Link and redirect update the shell URL');
  await surface.getByRole('button', { name: 'Atrás', exact: true }).click();
  await child.waitForURL(`${origin}/first`);
  assert.equal(await child.getByRole('textbox', { name: 'Page text input' }).inputValue(), 'preserve native history state', 'Back must retain native document history state, not reload the old URL.');
  record('Back preserves native page form state');
  await surface.getByRole('button', { name: 'Adelante', exact: true }).click();
  await child.waitForURL(`${origin}/second`);
  record('Back and forward navigate the native page');
  const beforeReload = requests.filter(url => url === '/second').length;
  const reloaded = child.waitForResponse(response => response.url() === `${origin}/second` && response.status() === 200);
  await surface.getByRole('button', { name: 'Recargar', exact: true }).click();
  await reloaded;
  await child.waitForLoadState('load');
  assert(requests.filter(url => url === '/second').length > beforeReload);
  record('Reload requests the native page again');
  // Exercise the real model menu without changing provider/catalog IDs.
  const modelTrigger = shell.locator('button[aria-keyshortcuts$="."][aria-haspopup]').first();
  assert(await modelTrigger.count(), 'An existing model selector must remain available.');
  const modelLabel = await modelTrigger.getAttribute('aria-label');
  await modelTrigger.click();
  await shell.locator('[data-model-picker]').first().waitFor({ state: 'visible' });
  await shell.evaluate(() => document.activeElement?.blur());
  await shell.keyboard.press('b');
  assert(await shell.locator('[data-model-picker]').first().isVisible(), 'B must yield while model picker owns input.');
  evidence.modelPickerNativeVisibility = await child.evaluate(() => document.visibilityState);
  if (process.env.MONOCODE_SMOKE_PID) {
    try {
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-File', 'scripts/capture-browser-smoke.ps1', '-SmokeProcessId', process.env.MONOCODE_SMOKE_PID, '-CaptureName', 'native-model-overlay.png']);
      evidence.modelPickerCapture = 'test-results/browser-native-smoke/native-model-overlay.png (requires visual readback)';
    } catch (error) { evidence.modelPickerCaptureUnavailable = String(error); }
  }
  await shell.keyboard.press('Escape');
  await shell.locator('[data-model-picker]').first().waitFor({ state: 'hidden' });
  assert.equal(await modelTrigger.getAttribute('aria-label'), modelLabel, 'Catalog selection must remain unchanged.');
  record('Existing model picker opens and owns B without changing selected model');
  // A background tab must retain a redirect while a different browser tab is active.
  await enterAddress(address, `${origin}/delayed`);
  await child.waitForURL(`${origin}/delayed`);
  await shell.getByRole('button', { name: 'Abrir una superficie', exact: true }).click();
  await shell.getByTestId('open-surface-view').getByRole('button', { name: /^Browser\s+B$/ }).click();
  const secondAddress = shell.getByTestId('browser-surface').getByPlaceholder('google.com o buscar en la web...');
  await enterAddress(secondAddress, `${origin}/other`);
  await child.waitForURL(`${origin}/second`);
  await shell.waitForFunction(() => [...document.querySelectorAll('aside[aria-label="Right Panel Surfaces"] span')].some(span => span.textContent === 'Monocode smoke second'));
  assert.match(await secondAddress.inputValue(), /\/other$/, 'Background event must not overwrite active tab URL.');
  const delayedRequests = requests.filter(url => url === '/delayed').length;
  await shell.getByText('Monocode smoke second', { exact: true }).click();
  await shell.waitForFunction(() => document.querySelector('[data-testid="browser-surface"] input')?.value.includes('/second'));
  assert.equal(child.url(), `${origin}/second`);
  assert.equal(requests.filter(url => url === '/delayed').length, delayedRequests, 'Reactivation must not navigate back to the stale URL.');
  record('Inactive tab redirect is retained without overwriting the active Browser');
  // Exercise panel resizing via the shipped splitter and fullscreen control.
  const beforeGeometry = requests.filter(url => url === '/second').length;
  const splitter = shell.getByTitle('Arrastrar para redimensionar el panel', { exact: true });
  const bounds = await splitter.boundingBox();
  assert(bounds);
  await shell.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await shell.mouse.down();
  await shell.mouse.move(bounds.x - 80, bounds.y + bounds.height / 2, { steps: 10 });
  await shell.mouse.up();
  await shell.getByRole('button', { name: 'Pantalla completa', exact: true }).click();
  await shell.getByRole('button', { name: 'Restaurar a panel derecho', exact: true }).click();
  await shell.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(requests.filter(url => url === '/second').length, beforeGeometry, 'Geometry updates must not issue HTTP page requests.');
  record('Resize and dock/fullscreen do not navigate the page');
  // Capture invalid scheme rejection through the visible toolbar.
  await enterAddress(address, 'javascript:alert(1)');
  await surface.getByRole('alert').waitFor();
  assert.equal(child.url(), `${origin}/second`);
  record('Unsupported scheme is rejected without navigation');
  // Device is a constrained viewport preview, not a promised mobile emulator.
  await shell.getByRole('button', { name: 'Abrir una superficie', exact: true }).click();
  await shell.getByTestId('open-surface-view').getByRole('button', { name: /^Device\s+M$/ }).click();
  const deviceReady = Promise.any(browser.contexts().map(context => context.waitForEvent('page', { timeout: 20000 }).then(async page => {
    await page.waitForURL(`${origin}/device`, { timeout: 20000 }); return page;
  })));
  void deviceReady.catch(() => {});
  const deviceAddress = shell.getByTestId('browser-surface').getByPlaceholder('google.com o buscar en la web...');
  await enterAddress(deviceAddress, `${origin}/device`);
  const device = pages().find(page => page.url() === `${origin}/device`) ?? await deviceReady;
  await device.locator('#native-proof').waitFor();
  await device.waitForFunction(() => innerWidth > 100, null, { timeout: 10000 });
  const initialDeviceWidth = await device.evaluate(() => innerWidth);
  await shell.getByLabel('Right Panel Surfaces', { exact: true }).locator('select').selectOption('0.7');
  await device.waitForFunction(previousWidth => innerWidth < previousWidth, initialDeviceWidth, { timeout: 10000 });
  record('Device scale changes update actual native viewport without artificial resize');
  if (process.env.MONOCODE_SMOKE_PID) {
    try {
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-File', 'scripts/capture-browser-smoke.ps1', '-SmokeProcessId', process.env.MONOCODE_SMOKE_PID, '-CaptureName', 'native-device.png']);
      evidence.deviceCapture = 'test-results/browser-native-smoke/native-device.png (requires visual readback)';
    } catch (error) { evidence.deviceCaptureUnavailable = String(error); }
  }
  await shell.waitForFunction(() => [...document.querySelectorAll('aside[aria-label="Right Panel Surfaces"] span')].some(span => span.textContent === 'Monocode smoke device'));
  const deviceClosed = device.waitForEvent('close', { timeout: 10000 });
  await shell.getByRole('button', { name: 'Cerrar pestaña Monocode smoke device', exact: true }).click();
  await deviceClosed;
  record('Closing a Device tab destroys its native child WebView');
  if (process.env.MONOCODE_SMOKE_GOOGLE === '1') {
    await shell.getByText('Monocode smoke second', { exact: true }).click();
    await enterAddress(address, 'google.com');
    await child.waitForURL(/^https:\/\/(www\.)?google\.com\//, { timeout: 30000 });
    await child.waitForFunction(() => document.title.includes('Google') && document.body.innerText.length > 20, null, { timeout: 30000 });
    record('google.com loads HTTPS Google in the native Browser');
    const searchQuery = 'site:tauri.app WebView2';
    const searchResponse = child.waitForResponse(response => {
      const url = new URL(response.url());
      return /^(www\.)?google\.com$/.test(url.hostname) && url.pathname === '/search' && url.searchParams.get('q') === searchQuery && response.request().isNavigationRequest();
    }, { timeout: 30000 });
    // Search through the shipped toolbar, not by navigating the child via CDP.
    await enterAddress(address, searchQuery);
    const response = await searchResponse;
    assert.equal(response.status(), 200, 'Google search must return a successful document, not a network failure.');
    await child.waitForURL(url => /^(www\.)?google\.com$/.test(url.hostname) && url.pathname === '/search' && url.searchParams.get('q') === searchQuery, { timeout: 30000 });
    await child.waitForLoadState('domcontentloaded');
    assert(!/\/sorry\//.test(child.url()), 'A Google challenge is not a successful search.');
    const results = child.locator('a').filter({ has: child.locator('h3') });
    await results.first().waitFor({ state: 'visible', timeout: 30000 });
    assert((await results.count()) > 0, 'The native search page must contain actual result links.');
    await shell.waitForFunction(query => {
      const value = document.querySelector('[data-testid="browser-surface"] input')?.value;
      if (!value) return false;
      try { return new URL(value).searchParams.get('q') === query; } catch { return false; }
    }, searchQuery);
    evidence.search = { query: searchQuery, url: child.url(), status: response.status(), resultLinks: await results.count() };
    record('Free text in the address bar renders Google search results inside the native Browser');
    if (process.env.MONOCODE_SMOKE_PID) {
      try {
        await promisify(execFile)('powershell.exe', ['-NoProfile', '-File', 'scripts/capture-browser-smoke.ps1', '-SmokeProcessId', process.env.MONOCODE_SMOKE_PID, '-CaptureName', 'native-google.png']);
        evidence.googleCapture = 'test-results/browser-native-smoke/native-google.png (requires visual readback)';
      } catch (error) { evidence.googleCaptureUnavailable = String(error); }
    }
  }
  await shell.getByRole('button', { name: 'Cerrar Right Panel', exact: true }).click();
  await shell.evaluate(() => document.activeElement?.blur());
  await shell.keyboard.press('b');
  assert(!(await shell.getByLabel('Right Panel Surfaces', { exact: true }).isVisible()), 'Bare B must not open a closed panel.');
  record('B does not open the Browser while the right panel is closed');
  evidence.status = 'passed';
} catch (error) {
  evidence.error = String(error?.stack ?? error);
  console.error(evidence.error);
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/evidence.json`, JSON.stringify({ ...evidence, finishedAt: new Date().toISOString(), requests }, null, 2));
  // Only attach this harness to the isolated smoke instance, never the user's app.
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
