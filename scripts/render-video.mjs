#!/usr/bin/env node
// Рендер видео без интерфейса: тот же экспорт, что в редакторе, в headless Chromium.
//
//   npm run build
//   npm run render -- проект.json ролик.mp4 [--width 1920] [--height 1080] [--fps 30]
//                     [--episodes 1,2,3] [--no-subtitles] [--webm]
//
// Вход — проект (.json / .sda.json) или код Mermaid (.mmd). Относительные пути
// записей ищутся рядом с проектом, затем в public/.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').match(/^--(width|height|fps|episodes)$/));
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};
const [input, output] = positional;
if (!input || !output) {
    console.error('Использование: npm run render -- проект.json ролик.mp4 [--width 1920 --height 1080 --fps 30 --episodes 1,2 --no-subtitles --webm]');
    process.exit(1);
}
if (!existsSync('dist/index.html')) {
    console.error('Сначала соберите редактор: npm run build');
    process.exit(1);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
const text = readFileSync(input, 'utf8');
let project = null;
if (input.endsWith('.json')) {
    project = JSON.parse(text);
    for (const asset of Object.values(project.assets ?? {})) {
        if (asset.url.startsWith('data:')) continue;
        const candidates = [resolve(dirname(input), asset.url), resolve('public', asset.url)];
        const file = candidates.find((f) => existsSync(f));
        if (!file) {
            console.warn(`Нет файла записи ${asset.url} — в видео будет тишина`);
            continue;
        }
        asset.url = `data:${asset.type || 'audio/mpeg'};base64,${readFileSync(file).toString('base64')}`;
    }
}

const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join('dist', path === '/' ? 'index.html' : path);
    if (!file.startsWith('dist') || !existsSync(file)) {
        res.writeHead(404).end();
        return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}/?fresh`;

const browser = await chromium.launch();
try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('Ошибка страницы:', e.message));
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.SDA));
    await page.waitForSelector('.canvas-svg', { state: 'attached' });
    if (project) await page.evaluate((p) => window.SDA.load(p), project);
    else await page.evaluate((code) => window.SDA.load({ format: 'sequence-diagram-animator', diagram: { code, ids: [] }, title: 'Диаграмма' }), text);
    const options = {
        width: option('width') ? Number(option('width')) : undefined,
        height: option('height') ? Number(option('height')) : undefined,
        fps: option('fps') ? Number(option('fps')) : undefined,
        subtitles: flag('no-subtitles') ? false : undefined,
        format: flag('webm') || output.endsWith('.webm') ? 'webm' : 'mp4',
        episodes: option('episodes') ? option('episodes').split(',').map((n) => Number(n) - 1) : undefined,
    };
    const started = Date.now();
    console.log('Рендерим…');
    const result = await page.evaluate((o) => window.SDA.renderVideo(o), options);
    writeFileSync(output, Buffer.from(result.base64, 'base64'));
    console.log(`Готово: ${output} — ${result.duration.toFixed(1)} с видео, ${result.mime}, за ${((Date.now() - started) / 1000).toFixed(1)} с`);
} finally {
    await browser.close();
    server.close();
}
