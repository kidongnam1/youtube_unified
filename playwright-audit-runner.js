const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleErrors = [];
  const requestFailures = [];
  const httpErrors = [];
  const clickFailures = [];
  const visitedTabs = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('requestfailed', (request) => {
    requestFailures.push({
      url: request.url(),
      method: request.method(),
      error: request.failure()?.errorText || 'unknown',
    });
  });

  page.on('response', (response) => {
    if (response.status() >= 400) {
      httpErrors.push({
        status: response.status(),
        url: response.url(),
      });
    }
  });

  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });

  const navs = [
    { button: '스토리보드 생성', view: '#view-create', dataView: 'create' },
    { button: '영상 자동화', view: '#view-automation', dataView: 'automation' },
    { button: '자막 추출', view: '#view-subtitles', dataView: 'subtitles' },
    { button: '저장된 프로젝트', view: '#view-projects', dataView: 'projects' },
    { button: 'API 설정', view: '#view-settings', dataView: 'settings' },
  ];

  for (const nav of navs) {
    await page.locator(`.nav-button[data-view="${nav.dataView}"]`).click();
    await page.locator(`${nav.view}.active`).first().waitFor({ state: 'visible', timeout: 3000 });
    visitedTabs.push(nav.button);
  }

  const clickTargets = [
    { nav: '스토리보드 생성', selector: '#splitBtn', label: '대본만 씬 분할' },
    { nav: '스토리보드 생성', selector: '#clearBtn', label: '비우기' },
    { nav: '영상 자동화', selector: '#toggleAdvancedAuto', label: '고급 설정 표시' },
    { nav: '자막 추출', selector: '#copySubtitleBtn', label: '클립보드 복사' },
    { nav: '저장된 프로젝트', selector: '#refreshProjectsBtn', label: '새로고침' },
    { nav: 'API 설정', selector: '#saveSettingsBtn', label: '설정 저장' },
  ];

  for (const t of clickTargets) {
    const navDataView = navs.find((n) => n.button === t.nav)?.dataView;
    if (navDataView) {
      await page.locator(`.nav-button[data-view="${navDataView}"]`).click();
    }
    try {
      const target = page.locator(t.selector).first();
      await target.waitFor({ state: 'visible', timeout: 2500 });
      await target.click({ timeout: 2500 });
      await page.waitForTimeout(350);
    } catch (error) {
      clickFailures.push({
        nav: t.nav,
        label: t.label,
        selector: t.selector,
        reason: String(error),
      });
    }
  }

  const summary = {
    target: 'http://127.0.0.1:3000/',
    visitedTabs,
    consoleErrorCount: consoleErrors.length,
    requestFailureCount: requestFailures.length,
    httpErrorCount: httpErrors.length,
    clickFailureCount: clickFailures.length,
    consoleErrors,
    requestFailures,
    httpErrors,
    clickFailures,
  };

  console.log('[PLAYWRIGHT_AUDIT_SUMMARY]');
  console.log(JSON.stringify(summary, null, 2));

  await browser.close();
}

run().catch((error) => {
  console.error('[PLAYWRIGHT_AUDIT_FATAL]');
  console.error(error);
  process.exit(1);
});
