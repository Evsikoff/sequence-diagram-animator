// Точка входа экспортированного web-приложения: проект лежит в presentation.js
// (window.SDA_PROJECT), файлы записей — рядом, в папке audio/.
import { normalizeProject } from '../core/project';
import { Player } from './player';
import './player.css';

declare global {
    interface Window {
        SDA_PROJECT?: unknown;
        SequenceDiagramPlayer?: unknown;
    }
}

export { Player };

function start(): void {
    const container = document.getElementById('sda-app');
    if (!container || !window.SDA_PROJECT) return;
    const project = normalizeProject(window.SDA_PROJECT);
    const params = new URLSearchParams(location.search);
    const episode = Math.max(0, Number(params.get('episode') ?? 1) - 1) || 0;
    const player = new Player({ project, container, episode, autoplay: params.has('autoplay') });
    // Номер эпизода — в адресе, чтобы ссылкой можно было поделиться.
    const observer = new MutationObserver(() => {
        const current = Number(container.querySelector<HTMLElement>('.sda-player')?.dataset.episode ?? 0) + 1;
        const url = new URL(location.href);
        if (url.searchParams.get('episode') !== String(current)) {
            url.searchParams.set('episode', String(current));
            history.replaceState(null, '', url);
        }
    });
    observer.observe(container, { attributes: true, subtree: true, attributeFilter: ['data-episode'] });
    (window as unknown as { sdaPlayer: Player }).sdaPlayer = player;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
