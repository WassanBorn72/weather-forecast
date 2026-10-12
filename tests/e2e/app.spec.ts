import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/weather?**', route => route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'接続できません。デモを選択してください。'})}));
});
test('API障害を知らせ、明示したデモで予報・比較・精度画面を操作できる', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.getByRole('alert')).toContainText('接続できません');
  await page.getByRole('button', { name: 'デモ', exact: true }).click();
  await expect(page.locator('.demo-banner')).toContainText('合成データ');
  await expect(page.locator('.hero-temperature')).not.toHaveText('—℃');
  await expect(page.locator('.hour-tile')).toHaveCount(24);
  await page.locator('.hour-tile').nth(6).click(); await expect(page.locator('.hour-tile').nth(6)).toHaveClass(/selected/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); expect(overflow).toBe(false);
  await page.screenshot({path:`/tmp/weather-${testInfo.project.name}.png`,fullPage:true});
  await page.getByRole('button',{name:'モデル比較',exact:true}).click(); await expect(page.locator('.model-card')).toHaveCount(4);
  await page.getByLabel('比較する変数').selectOption('probability'); await expect(page.locator('.integration-detail')).toContainText('単純平均');
  await page.getByRole('button',{name:'精度検証',exact:true}).click(); await expect(page.locator('.highlight-row')).toBeVisible();
  await page.getByLabel('気象変数').selectOption('probability'); await expect(page.locator('.calibration')).toBeVisible();
  await page.getByLabel('評価期間').selectOption('7'); await expect(page.locator('.score-heading')).toContainText('過去7日');
  await page.getByLabel('何時間先').selectOption('48'); await expect(page.locator('.score-heading')).toContainText('+48時間');
  expect(errors).toEqual([]);
});
test('緯度・経度による地点指定と欠測精度を表示する',async({page})=>{
  await page.route('**/api/evaluation?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({variable:'temperature',lead:24,days:30,season:null,scores:[],baselines:[],commonCount:0,excluded:0,trainingDays:30,status:'検証待ち',method:'snapshot',cutoff:'2026-10-12T00:00:00Z'})}));
  await page.goto('/');await page.getByRole('button',{name:'地点を指定',exact:true}).click();await page.getByLabel('緯度',{exact:true}).fill('34.69');await page.getByLabel('経度',{exact:true}).fill('135.50');await page.getByRole('button',{name:'この地点を使う'}).click();await expect(page.locator('#location')).toHaveValue('point_34.69_135.5');
  await page.getByRole('button',{name:'精度検証',exact:true}).click();await expect(page.locator('.accuracy-page')).toContainText('比較できる過去予報と実測がありません');
});
