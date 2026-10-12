import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

type Files = { path: string; base64: string }[];

test('web-приложение: экспорт открывается с file:// и переключает эпизоды', async ({ page, browser }) => {
    await page.goto('?example=demo');
    await page.waitForSelector('.canvas-svg [data-id]', { state: 'attached' });
    const files = await page.evaluate(() => (window as unknown as { SDA: { exportWebApp(): Promise<Files> } }).SDA.exportWebApp());
    const dir = mkdtempSync(join(tmpdir(), 'sda-webapp-'));
    for (const file of files) {
        mkdirSync(dirname(join(dir, file.path)), { recursive: true });
        writeFileSync(join(dir, file.path), Buffer.from(file.base64, 'base64'));
    }
    expect(files.map((f) => f.path)).toEqual(expect.arrayContaining(['index.html', 'project.json', 'player.js', '.github/workflows/pages.yml']));

    const app = await browser.newPage();
    const errors: string[] = [];
    app.on('pageerror', (e) => errors.push(e.message));
    await app.goto(`file://${join(dir, 'index.html')}`);
    const player = app.locator('.sda-player');
    await expect(player).toHaveAttribute('data-episode', '0');
    await expect(app.locator('.sda-chapter')).toHaveCount(6);
    await app.locator('.sda-overlay').click();
    await expect(player).toHaveAttribute('data-state', /playing|loading/);
    // Стрелки появляются по ходу речи.
    await expect.poll(async () => app.locator('.sda-svg [data-id="m1"]').count(), { timeout: 15_000 }).toBe(1);
    await app.getByRole('button', { name: 'Вперёд' }).click();
    await expect(player).toHaveAttribute('data-episode', '1');
    await app.keyboard.press('ArrowRight');
    await expect(player).toHaveAttribute('data-episode', '2');
    await app.getByRole('button', { name: 'Назад' }).click();
    await expect(player).toHaveAttribute('data-episode', '1');
    expect(new URL(app.url()).searchParams.get('episode')).toBe('2');
    expect(errors).toEqual([]);
});

test('видео: экспорт эпизода из диалога', async ({ page }) => {
    await page.goto('?example=demo');
    await page.waitForSelector('.canvas-svg [data-id]', { state: 'attached' });
    await page.getByRole('button', { name: 'Экспорт ▾' }).click();
    await page.getByRole('button', { name: 'Видео (MP4 / WebM)…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Экспорт в видео' });
    await dialog.locator('select').nth(0).selectOption('current');
    await dialog.locator('select').nth(1).selectOption({ label: '1280 × 720 (HD)' });
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Создать видео' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/episode-1\.(mp4|webm)$/);
    await expect(dialog.locator('.result video')).toHaveCount(1);
    await expect(dialog.locator('.result')).toContainText(/\d:\d\d, [\d.]+ МБ/);
});
