// Встроенный пример и его копия в браузере. Редактор автосохраняет проект, и
// без проверки пользователь вечно видел бы ту версию примера, с которой
// впервые открыл редактор (например, ещё без записей диктора).
import { Project } from './project';

function scenario(project: Project) {
    return project.episodes.map((episode) => ({
        title: episode.title,
        start: episode.start,
        replicas: episode.replicas.map((r) => ({
            text: r.text,
            set: r.set,
            highlight: [...r.highlight].sort(),
            camera: r.camera,
            reveal: r.reveal,
            duration: r.duration,
        })),
    }));
}

// Сохранённую копию пора заменить свежим примером, если пользователь в ней
// ничего не менял (записи и метки не в счёт — их и обновляем), или если она
// ссылается на файлы примера, которых больше нет.
export function isStaleDemo(saved: Project, demo: Project): boolean {
    const demoUrls = new Set(Object.values(demo.assets).map((asset) => asset.url));
    const savedDemoUrls = Object.values(saved.assets)
        .map((asset) => asset.url)
        .filter((url) => url.startsWith('examples/'));
    if (savedDemoUrls.some((url) => !demoUrls.has(url))) return true;
    if (saved.title !== demo.title || saved.description !== demo.description || saved.diagram.code !== demo.diagram.code) return false;
    return JSON.stringify(scenario(saved)) === JSON.stringify(scenario(demo));
}
