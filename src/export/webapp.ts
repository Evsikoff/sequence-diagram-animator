// Экспорт в web-приложение: статический сайт с плеером, который можно
// открыть локально, выложить на GitHub Pages или в любой хостинг.
//
//   index.html          страница с плеером и списком эпизодов
//   presentation.js     проект (window.SDA_PROJECT) — работает и с file://
//   project.json        тот же проект — его можно снова открыть в редакторе
//   diagram.mmd         код диаграммы в Mermaid
//   player.js/.css      плеер (несжатый код)
//   fonts/, audio/      шрифты и записи диктора
//   .github/workflows/pages.yml — публикация на GitHub Pages
import { Project } from '../core/project';
import { escapeXml } from '../core/render';

export interface ExportFile {
    path: string;
    data: string | Uint8Array;
}

export interface WebAppOptions {
    branch?: string; // ветка, из которой публикуется GitHub Pages
    // Читает файл редактора (плеер, шрифты) по пути относительно корня редактора.
    readStatic: (path: string) => Promise<Uint8Array>;
    // Читает запись по URL ассета (data:, blob:, относительный).
    readAsset: (url: string) => Promise<Uint8Array>;
}

export const FONT_FILES = [
    'fonts.css',
    'inter-cyrillic-400-normal.woff2',
    'inter-cyrillic-600-normal.woff2',
    'inter-latin-400-normal.woff2',
    'inter-latin-600-normal.woff2',
    'jetbrains-mono-cyrillic-400-normal.woff2',
    'jetbrains-mono-latin-400-normal.woff2',
    'LICENSE-Inter.txt',
    'LICENSE-JetBrainsMono.txt',
];

const EXTENSIONS: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
};

// Латиница, цифры и дефисы: «Связка профиля» → svyazka-profilya.
export function slugify(text: string, fallback = 'file'): string {
    return (
        translit(text.normalize('NFC'))
            .replace(/[^A-Za-z0-9_-]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase()
            .slice(0, 60) || fallback
    );
}

// Имя файла без кириллицы и пробелов — для URL на любом хостинге.
export function safeFileName(name: string, type: string, taken: Set<string>): string {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    let ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : EXTENSIONS[type] ?? 'bin';
    if (!/^[a-z0-9]{1,5}$/.test(ext)) ext = EXTENSIONS[type] ?? 'bin';
    const slug = slugify(base, 'audio');
    let candidate = `${slug}.${ext}`;
    for (let i = 2; taken.has(candidate); i++) candidate = `${slug}-${i}.${ext}`;
    taken.add(candidate);
    return candidate;
}

const TRANSLIT: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function translit(text: string): string {
    return [...text].map((c) => {
        const lower = c.toLowerCase();
        return lower in TRANSLIT ? TRANSLIT[lower] : c;
    }).join('');
}

// Ассеты, на которые ссылаются эпизоды и реплики.
export function usedAssets(project: Project): Set<string> {
    const used = new Set<string>();
    for (const episode of project.episodes) {
        if (episode.audio) used.add(episode.audio.asset);
        for (const replica of episode.replicas) if (replica.audio) used.add(replica.audio.asset);
    }
    return used;
}

export async function buildWebApp(source: Project, options: WebAppOptions): Promise<ExportFile[]> {
    const project: Project = structuredClone(source);
    const files: ExportFile[] = [];
    const taken = new Set<string>();
    const used = usedAssets(project);
    for (const id of Object.keys(project.assets)) {
        if (!used.has(id)) {
            delete project.assets[id];
            continue;
        }
        const asset = project.assets[id];
        const name = safeFileName(asset.name || id, asset.type, taken);
        files.push({ path: `audio/${name}`, data: await options.readAsset(asset.url) });
        project.assets[id] = { ...asset, url: `audio/${name}` };
    }

    const json = JSON.stringify(project, null, 2);
    files.push({ path: 'project.json', data: json + '\n' });
    files.push({ path: 'presentation.js', data: `// Сценарий анимации. Создано в Sequence Diagram Animator.\nwindow.SDA_PROJECT = ${json};\n` });
    files.push({ path: 'diagram.mmd', data: project.diagram.code });
    files.push({ path: 'index.html', data: indexHtml(project) });
    files.push({ path: 'player.js', data: await options.readStatic('player/player.js') });
    files.push({ path: 'player.css', data: await options.readStatic('player/player.css') });
    for (const font of FONT_FILES) files.push({ path: `fonts/${font}`, data: await options.readStatic(`fonts/${font}`) });
    files.push({ path: 'README.md', data: readme(project, options.branch ?? 'main') });
    files.push({ path: '.github/workflows/pages.yml', data: pagesWorkflow(options.branch ?? 'main') });
    files.push({ path: '.nojekyll', data: '' });
    return files;
}

function indexHtml(project: Project): string {
    const title = escapeXml(project.title || 'Диаграмма последовательности');
    const description = project.description ? `<p>${escapeXml(project.description)}</p>` : '';
    return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="fonts/fonts.css">
<link rel="stylesheet" href="player.css">
<style>
    html, body { height: 100%; margin: 0; }
    body {
        display: flex;
        flex-direction: column;
        background: #f6f8fa;
        color: #1f2328;
        font: 15px/1.5 'SDA Inter', Inter, 'Segoe UI', Roboto, Arial, sans-serif;
    }
    header { padding: 14px 20px 6px; }
    header h1 { margin: 0; font-size: 22px; }
    header p { margin: 4px 0 0; color: #57606a; }
    #sda-app { flex: 1 1 auto; min-height: 480px; padding: 10px 20px; display: flex; }
    footer { padding: 4px 20px 14px; color: #57606a; font-size: 13px; }
    footer a { color: inherit; }
    noscript { padding: 20px; }
    @media (max-width: 860px) { #sda-app { min-height: 0; } }
    @media (max-width: 600px) { #sda-app { padding: 6px; } header { padding: 10px 10px 4px; } }
</style>
</head>
<body>
<header>
    <h1>${title}</h1>
    ${description}
</header>
<main id="sda-app"></main>
<noscript>Для просмотра анимации включите JavaScript.</noscript>
<footer>
    Пробел — пауза, ← → — эпизоды, Shift + ← → — реплики.
    Код диаграммы: <a href="diagram.mmd">diagram.mmd</a> (Mermaid) · сценарий: <a href="project.json">project.json</a>
</footer>
<script src="presentation.js"></script>
<script src="player.js"></script>
</body>
</html>
`;
}

function readme(project: Project, branch: string): string {
    const episodes = project.episodes.map((e, i) => `${i + 1}. ${e.title}`).join('\n');
    return `# ${project.title || 'Анимированная диаграмма последовательности'}

${project.description || 'Анимированная UML-диаграмма последовательности с озвучкой.'}

Эпизоды:

${episodes}

## Как посмотреть

- Откройте \`index.html\` в браузере — сервер не нужен.
- Или запустите локальный сервер: \`python3 -m http.server\` и откройте http://localhost:8000.

Управление: пробел или щелчок по схеме — пауза, ← → — соседний эпизод,
Shift + ← → — соседняя реплика, шкала под схемой — переход к месту эпизода.

## Публикация на GitHub Pages

Workflow \`.github/workflows/pages.yml\` публикует сайт при каждом push в ветку \`${branch}\`.
Один раз включите Pages: Settings → Pages → Source: **GitHub Actions**.

## Как изменить

Откройте \`project.json\` (или ZIP этого репозитория) в Sequence Diagram Animator:
там правится код диаграммы (Mermaid), реплики, подсветка и камера.

| Файл | Что внутри |
| --- | --- |
| \`diagram.mmd\` | код диаграммы в синтаксисе Mermaid |
| \`project.json\` | диаграмма, эпизоды, реплики, настройки |
| \`presentation.js\` | то же, что project.json, для запуска без сервера |
| \`player.js\`, \`player.css\` | плеер |
| \`audio/\` | записи диктора |
| \`fonts/\` | шрифты Inter и JetBrains Mono (SIL OFL 1.1) |
`;
}

export function pagesWorkflow(branch: string): string {
    return `name: GitHub Pages

on:
  push:
    branches: [${branch}]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - id: deployment
        uses: actions/deploy-pages@v4
`;
}
