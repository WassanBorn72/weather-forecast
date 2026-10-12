import { test,expect } from '@playwright/test';
import { demoWeather } from '../../src/domain/demo';
import { LOCATIONS } from '../../src/domain/types';
test('production PWA caches the shell and shows the previous forecast offline with a stale notice',async({page,context})=>{
  // Synthetic network fixture only in the test. It is never saved into the product database.
  const fixture={...demoWeather(LOCATIONS[0]),mode:'live',warnings:['UI test fixture'],models:[]};
  await page.route('**/api/weather?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}));
  await page.goto('/');await expect(page.locator('.hero-temperature')).toBeVisible();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
  const manifest=await page.evaluate(async()=>await(await fetch('/manifest.webmanifest')).json()) as {display:string;icons:{sizes:string}[]};expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((i:{sizes:string})=>i.sizes)).toEqual(['192x192','512x512']);
  const icon=await page.request.get('/icon-192.png');expect(icon.ok()).toBe(true);
  const cached=await page.evaluate(async()=>{const names=await caches.keys();const result:string[]=[];for(const name of names){const requests=await(await caches.open(name)).keys();result.push(...requests.map(r=>new URL(r.url).pathname));}return result;});
  expect(cached).toContain('/');expect(cached.some(path=>path.startsWith('/api/'))).toBe(false);
  await page.unroute('**/api/weather?**');await context.setOffline(true);await page.reload();
  await expect(page.locator('.stale-note')).toContainText('古い予報');await expect(page.locator('.hero-temperature')).toBeVisible();
  await expect(page.getByText('オフラインです。保存した予報は更新されません。')).toBeVisible();
  await context.setOffline(false);
});
