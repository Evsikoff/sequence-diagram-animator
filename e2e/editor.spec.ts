import { expect, Page, test } from '@playwright/test';

type Automation = { SDA: { project(): { diagram: { code: string; ids: string[] }; episodes: { replicas: { set: Record<string, string>; highlight: string[]; camera: { mode: string } }[] }[] } } };

const project = (page: Page) => page.evaluate(() => (window as unknown as Automation).SDA.project());
const code = async (page: Page) => (await project(page)).diagram.code;

async function open(page: Page, query = '?fresh') {
    await page.goto(query);
    await page.waitForSelector('.canvas-svg [data-id]', { state: 'attached' });
}

// Центр элемента схемы на экране.
async function center(page: Page, id: string) {
    const box = await page.locator(`.canvas-svg [data-id="${id}"] .sda-hit`).first().boundingBox();
    if (!box) throw new Error(`нет элемента ${id}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('код → схема: новое сообщение появляется, id остальных сохраняются', async ({ page }) => {
    await open(page);
    const before = await project(page);
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n    api-->>user: Готово');
    await expect.poll(async () => (await code(page)).includes('api-->>user: Готово')).toBe(true);
    const after = await project(page);
    expect(after.diagram.ids.slice(0, before.diagram.ids.length)).toEqual(before.diagram.ids);
    expect(after.diagram.ids.length).toBe(before.diagram.ids.length + 1);
    await expect(page.locator(`.canvas-svg [data-id="${after.diagram.ids.at(-1)}"]`)).toHaveCount(1);
});

test('ошибка в коде подсвечивается, схема остаётся прежней', async ({ page }) => {
    await open(page);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n    непонятная строка');
    await expect(page.locator('.badge.bad')).toHaveText('ошибок: 1');
    await expect(page.locator('.cm-error-line')).toHaveCount(1);
    await page.keyboard.press('Backspace'.repeat(1));
    for (let i = 0; i < 'непонятная строка'.length + 4; i++) await page.keyboard.press('Backspace');
    await expect(page.locator('.badge.good')).toBeVisible();
});

test('визуально: участник, стрелка между линиями жизни, правка подписи, отмена', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: '+ Участник' }).click();
    await expect.poll(async () => (await code(page)).includes('participant uchastnik_5 as Участник 5')).toBe(true);

    // Рисуем стрелку от «Приложение» к «Сервер» ниже всех строк.
    const ids = (await project(page)).diagram.ids;
    const user = await center(page, ids[1]);
    const api = await center(page, ids[2]);
    const life = await page.locator(`.canvas-svg [data-id="${ids[1]}:life"]`).boundingBox();
    const y = life!.y + life!.height - 12;
    await page.getByRole('button', { name: '↗ Стрелка' }).click();
    await page.mouse.move(user.x, y);
    await page.mouse.down();
    await page.mouse.move(api.x, y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await code(page)).includes('app->>api: Сообщение')).toBe(true);

    // Двойной щелчок по новому сообщению — правка текста.
    const newId = (await project(page)).diagram.ids.at(-1)!;
    const point = await center(page, newId);
    await page.mouse.dblclick(point.x, point.y);
    await page.locator('.inline-edit').fill('Проверка связи');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await code(page)).includes('app->>api: Проверка связи')).toBe(true);

    await page.getByTitle('Отменить (Ctrl+Z)').click();
    await expect.poll(async () => (await code(page)).includes('app->>api: Сообщение')).toBe(true);
    await page.getByTitle('Повторить (Ctrl+Shift+Z)').click();
    await expect.poll(async () => (await code(page)).includes('Проверка связи')).toBe(true);
});

test('перетаскивание участника меняет порядок в коде', async ({ page }) => {
    await open(page);
    const ids = (await project(page)).diagram.ids;
    const first = await center(page, ids[0]);
    const third = await center(page, ids[2]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(third.x + 40, first.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => {
        const text = await code(page);
        return text.indexOf('actor user') > text.indexOf('participant api');
    }).toBe(true);
});

test('анимация: показ, подсветка и кадр камеры в реплике', async ({ page }) => {
    await open(page, '?example=demo');
    await page.getByRole('tab', { name: 'Анимация' }).click();
    // Вторая реплика первого эпизода.
    await page.locator('.replica-row').nth(1).click();
    const before = (await project(page)).episodes[0].replicas[1];
    // Показать сообщение m3 (по умолчанию оно появляется позже).
    await page.getByRole('button', { name: 'Показать / скрыть' }).click();
    const m3 = await center(page, 'm3');
    await page.mouse.click(m3.x, m3.y);
    await expect.poll(async () => (await project(page)).episodes[0].replicas[1].set.m3).toBe('visible');
    // Подсветить m1.
    await page.getByRole('button', { name: 'Подсветить' }).click();
    const m1 = await center(page, 'm1');
    await page.mouse.click(m1.x, m1.y);
    await expect.poll(async () => (await project(page)).episodes[0].replicas[1].highlight).toEqual([...before.highlight, 'm1']);
    // Кадр камеры рамкой.
    await page.getByRole('button', { name: 'Кадр камеры' }).click();
    const box = (await page.locator('.canvas-svg').boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 380, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await project(page)).episodes[0].replicas[1].camera.mode).toBe('manual');
    await expect(page.locator('.camera-frame rect')).toHaveCount(1);
});

test('предпросмотр: плеер переключает эпизоды', async ({ page }) => {
    await open(page, '?example=demo');
    await page.getByRole('button', { name: '▶ Смотреть' }).click();
    const player = page.locator('.preview-host .sda-player');
    await expect(player).toBeVisible();
    await expect(player).toHaveAttribute('data-episode', '0');
    await page.keyboard.press('ArrowRight');
    await expect(player).toHaveAttribute('data-episode', '1');
    await page.locator('.sda-chapter button').nth(4).click();
    await expect(player).toHaveAttribute('data-episode', '4');
    await page.getByRole('button', { name: 'Закрыть' }).click();
    await expect(player).toHaveCount(0);
});
