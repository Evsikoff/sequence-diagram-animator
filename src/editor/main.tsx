import { createRoot } from 'react-dom/client';
import { layoutDiagram } from '../core/layout';
import { canvasMeasure, loadFonts } from '../core/measure';
import { isStaleDemo } from '../core/demo';
import { newProject, normalizeProject, Project } from '../core/project';
import { loadDiagram } from '../core/source';
import { autoSplit } from '../core/split';
import { themeById } from '../core/theme';
import type { VideoOptions } from '../export/video';
import { buildWebApp } from '../export/webapp';
import { App, STARTER } from './App';
import { bytesToBase64, loadCurrent, readUrl } from './files';
import { createStore, store } from './store';
import '../player/player.css';
import './editor.css';

async function example(): Promise<Project | null> {
    try {
        const response = await fetch('examples/partner-link/project.json');
        return response.ok ? normalizeProject(await response.json()) : null;
    } catch {
        return null;
    }
}

async function boot() {
    const params = new URLSearchParams(location.search);
    let project: Project | null = null;
    let fromExample = false;
    if (params.has('example')) {
        project = await example();
        fromExample = project !== null;
    } else if (!params.has('fresh')) {
        project = await loadCurrent();
        // Устаревшая копия примера (без новых записей и т. п.) — заменяем свежим.
        const demo = project ? await example() : null;
        if (project && demo && isStaleDemo(project, demo)) {
            project = demo;
            fromExample = true;
        }
    }
    if (!project && !params.has('fresh')) {
        project = await example();
        fromExample = project !== null;
    }
    project ??= newProject(STARTER, 'Вход в приложение');
    createStore(project, fromExample);
    createRoot(document.getElementById('root')!).render(<App />);
}

// Точка для автоматизации (scripts/render-video.mjs, e2e-тесты): тот же экспорт без интерфейса.
const automation = {
    // Проект без сценария (например, голый код Mermaid) нарезается автоматически.
    load(raw: unknown) {
        const project = normalizeProject(raw);
        if (!project.episodes.length) {
            const { diagram } = loadDiagram(project.diagram);
            project.episodes = autoSplit(diagram, { episodes: 'dividers', perReplica: 1, highlightNew: true });
        }
        store().load(project);
    },
    project(): Project {
        return store().get().project;
    },
    async renderVideo(options: Partial<Omit<VideoOptions, 'resolveAsset' | 'onProgress' | 'signal'>> = {}) {
        await loadFonts();
        const project = store().get().project;
        const theme = themeById(project.settings.theme);
        const layout = layoutDiagram(store().get().diagram, theme, canvasMeasure(theme.font, theme.mono));
        const { renderVideo } = await import('../export/video');
        const result = await renderVideo(project, layout, {
            episodes: options.episodes ?? project.episodes.map((_, i) => i),
            width: options.width ?? project.settings.width,
            height: options.height ?? project.settings.height,
            fps: options.fps ?? project.settings.fps,
            subtitles: options.subtitles ?? project.settings.subtitles,
            format: options.format ?? 'mp4',
            resolveAsset: (id) => project.assets[id]?.url ?? null,
        });
        return { base64: bytesToBase64(new Uint8Array(await result.blob.arrayBuffer())), mime: result.mime, extension: result.extension, duration: result.duration };
    },
    async exportWebApp() {
        const files = await buildWebApp(store().get().project, {
            readStatic: (path) => readUrl(new URL(path, document.baseURI).href),
            readAsset: (url) => readUrl(url),
        });
        return files.map((f) => ({ path: f.path, base64: bytesToBase64(typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data) }));
    },
};
(window as unknown as { SDA: typeof automation }).SDA = automation;

void boot();
