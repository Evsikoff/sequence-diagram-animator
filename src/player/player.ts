// Плеер анимированной диаграммы. Работает и в редакторе (предпросмотр), и в
// экспортированном web-приложении. Как в референсе: диктор говорит —
// стрелки прорисовываются; щелчок по схеме и пробел — пауза, ← → — соседний
// эпизод, Shift+← → — соседняя реплика. Пока записи нет, реплика идёт в темпе
// чтения текста. Браузер не дал включить звук без щелчка — просим щёлкнуть.
import { Animator } from '../core/animate';
import { layoutDiagram } from '../core/layout';
import { canvasMeasure, loadFonts } from '../core/measure';
import { Project } from '../core/project';
import { primsToSvg } from '../core/render';
import { buildScene } from '../core/scene';
import { loadDiagram } from '../core/source';
import { themeById } from '../core/theme';

type Playback = 'loading' | 'playing' | 'paused' | 'blocked' | 'ended' | 'ready';

export interface PlayerOptions {
    project: Project;
    container: HTMLElement;
    resolveAsset?: (asset: string) => string | null;
    autoplay?: boolean;
    episode?: number;
    time?: number;
    onClose?: () => void; // кнопка «Закрыть» (предпросмотр в редакторе)
}

const ICONS = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z" fill="currentColor"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z" fill="currentColor"/></svg>',
    full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zM4 15h2v3h3v2H4zm14 3v-3h2v5h-5v-2z" fill="currentColor"/></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" fill="currentColor"/></svg>',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, html = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    if (html) node.innerHTML = html;
    return node;
}

export class Player {
    private animator: Animator | null = null;
    private episode = 0;
    private time = 0;
    private playback: Playback = 'ready';
    private frameId = 0;
    private lastTick = 0;
    private dirty = true;
    private attempt = 0;
    private readonly audio = new Map<string, HTMLAudioElement>();
    private readonly failed = new Set<string>();
    private readonly root: HTMLDivElement;
    private readonly stage: HTMLDivElement;
    private readonly svg: SVGSVGElement;
    private readonly overlay: HTMLButtonElement;
    private readonly fill: HTMLDivElement;
    private readonly ticks: HTMLDivElement;
    private readonly progress: HTMLDivElement;
    private readonly caption: HTMLDivElement;
    private readonly status: HTMLSpanElement;
    private readonly playButton: HTMLButtonElement;
    private readonly prevButton: HTMLButtonElement;
    private readonly nextButton: HTMLButtonElement;
    private readonly select: HTMLSelectElement;
    private readonly chapters: HTMLOListElement;
    private readonly resize: ResizeObserver;
    private readonly options: PlayerOptions;
    private destroyed = false;
    private lastCaption = '';
    private readonly keyHandler: (event: KeyboardEvent) => void;

    constructor(options: PlayerOptions) {
        this.options = options;
        this.episode = Math.max(0, Math.min(options.episode ?? 0, options.project.episodes.length - 1));
        this.time = options.time ?? 0;

        const root = el('div', 'sda-player');
        root.tabIndex = 0;
        this.root = root;
        const main = el('div', 'sda-main');
        this.stage = el('div', 'sda-stage');
        this.stage.title = 'Щелчок — пауза или продолжить';
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('class', 'sda-svg');
        this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        this.svg.setAttribute('role', 'img');
        this.overlay = el('button', 'sda-overlay', `${ICONS.play}<span>Смотреть</span>`);
        this.overlay.type = 'button';
        this.stage.append(this.svg, this.overlay);

        this.progress = el('div', 'sda-progress');
        this.progress.title = 'Перейти к месту эпизода';
        this.fill = el('div', 'sda-progress-fill');
        this.ticks = el('div', 'sda-ticks');
        this.progress.append(this.fill, this.ticks);

        this.caption = el('div', 'sda-caption');
        this.caption.setAttribute('aria-live', 'polite');

        const controls = el('div', 'sda-controls');
        this.prevButton = el('button', 'sda-button', `${ICONS.prev}<span>Назад</span>`);
        this.prevButton.title = 'Предыдущий эпизод (←)';
        this.playButton = el('button', 'sda-button sda-play', ICONS.play);
        this.playButton.title = 'Пауза / продолжить (пробел)';
        this.nextButton = el('button', 'sda-button', `<span>Вперёд</span>${ICONS.next}`);
        this.nextButton.title = 'Следующий эпизод (→)';
        this.status = el('span', 'sda-status');
        this.select = el('select', 'sda-select');
        this.select.title = 'Эпизоды';
        const fullButton = el('button', 'sda-button sda-icon', ICONS.full);
        fullButton.title = 'Во весь экран';
        controls.append(this.prevButton, this.playButton, this.nextButton, this.status, this.select, fullButton);
        if (options.onClose) {
            const close = el('button', 'sda-button sda-close', '<span>Закрыть</span>');
            close.addEventListener('click', () => options.onClose?.());
            controls.append(close);
        }
        main.append(this.stage, this.progress, this.caption, controls);

        const aside = el('aside', 'sda-aside');
        aside.append(el('div', 'sda-aside-title', `${ICONS.list}<span>Эпизоды</span>`));
        this.chapters = el('ol', 'sda-chapters');
        aside.append(this.chapters);
        root.append(main, aside);
        options.container.append(root);

        // События.
        this.stage.addEventListener('click', () => this.toggle());
        this.overlay.addEventListener('click', (event) => {
            event.stopPropagation();
            this.play();
        });
        this.playButton.addEventListener('click', () => this.toggle());
        this.prevButton.addEventListener('click', () => this.goTo(this.episode - 1));
        this.nextButton.addEventListener('click', () => this.goTo(this.episode + 1));
        this.select.addEventListener('change', () => this.goTo(Number(this.select.value)));
        fullButton.addEventListener('click', () => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void root.requestFullscreen?.();
        });
        this.progress.addEventListener('click', (event) => {
            const rect = this.progress.getBoundingClientRect();
            const share = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            this.seek(share * (this.animator?.duration(this.episode) ?? 0));
        });
        this.keyHandler = (event: KeyboardEvent) => this.onKey(event);
        window.addEventListener('keydown', this.keyHandler);
        this.resize = new ResizeObserver(() => {
            this.dirty = true;
            this.render();
        });
        this.resize.observe(this.stage);

        void this.init();
    }

    private async init(): Promise<void> {
        await loadFonts();
        if (this.destroyed) return;
        const project = this.options.project;
        const theme = themeById(project.settings.theme);
        const { diagram } = loadDiagram(project.diagram);
        const layout = layoutDiagram(diagram, theme, canvasMeasure(theme.font, theme.mono));
        this.animator = new Animator(project, layout);
        this.root.style.setProperty('--sda-stage-bg', theme.colors.background);
        this.root.classList.toggle('sda-dark', theme.id === 'dark');
        this.buildChapters();
        this.dirty = true;
        this.updateChrome();
        this.render();
        this.frameId = requestAnimationFrame((now) => this.tick(now));
        // Фокус — плееру, чтобы сразу работали пробел и стрелки.
        this.root.focus({ preventScroll: true });
        if (this.options.autoplay) this.play();
    }

    private buildChapters(): void {
        const episodes = this.options.project.episodes;
        this.select.innerHTML = '';
        this.chapters.innerHTML = '';
        episodes.forEach((episode, i) => {
            const option = document.createElement('option');
            option.value = String(i);
            option.textContent = `${i + 1}. ${episode.title}`;
            this.select.append(option);
            const item = el('li', 'sda-chapter');
            const button = el('button', '', '');
            button.type = 'button';
            const duration = this.animator?.duration(i) ?? 0;
            button.innerHTML = `<span class="sda-chapter-number">${i + 1}</span><span class="sda-chapter-title"></span><span class="sda-chapter-time">${formatTime(duration)}</span>`;
            button.querySelector('.sda-chapter-title')!.textContent = episode.title;
            button.addEventListener('click', () => {
                this.goTo(i, 0);
                if (this.playback !== 'playing') this.play();
            });
            item.append(button);
            this.chapters.append(item);
        });
    }

    // --- Управление.

    play(): void {
        if (!this.animator) {
            this.options.autoplay = true;
            return;
        }
        if (this.playback === 'ended') {
            this.time = 0;
            this.dirty = true;
        }
        this.playback = 'playing';
        this.lastTick = performance.now();
        this.updateChrome();
    }

    pause(): void {
        this.attempt++;
        for (const audio of this.audio.values()) audio.pause();
        if (this.playback !== 'ended') this.playback = 'paused';
        this.updateChrome();
    }

    toggle(): void {
        if (this.playback === 'playing' || this.playback === 'loading') this.pause();
        else this.play();
        this.root.focus({ preventScroll: true });
    }

    goTo(episode: number, time = 0): void {
        const count = this.options.project.episodes.length;
        if (episode < 0 || episode >= count) return;
        const keepPlaying = this.playback === 'playing' || this.playback === 'loading' || this.playback === 'ended';
        this.attempt++;
        for (const audio of this.audio.values()) audio.pause();
        this.episode = episode;
        this.time = time;
        this.dirty = true;
        this.playback = keepPlaying ? 'playing' : this.playback === 'ready' ? 'ready' : 'paused';
        this.lastTick = performance.now();
        this.updateChrome();
        this.render();
    }

    seek(time: number): void {
        this.attempt++;
        for (const audio of this.audio.values()) audio.pause();
        this.time = Math.max(0, time);
        if (this.playback === 'ended') this.playback = 'paused';
        if (this.playback === 'loading') this.playback = 'playing';
        this.dirty = true;
        this.render();
        this.updateChrome();
    }

    stepReplica(step: number): void {
        const animator = this.animator;
        if (!animator) return;
        const timing = animator.timeline.episodes[this.episode];
        const current = animator.replicaAt(this.episode, this.time);
        const target = current + step;
        if (target < 0) return this.goTo(this.episode - 1, 0);
        if (target >= timing.replicas.length) return this.goTo(this.episode + 1, 0);
        this.seek(timing.replicas[target].start);
    }

    destroy(): void {
        this.destroyed = true;
        cancelAnimationFrame(this.frameId);
        this.resize.disconnect();
        window.removeEventListener('keydown', this.keyHandler);
        for (const audio of this.audio.values()) {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
        }
        this.root.remove();
    }

    private onKey(event: KeyboardEvent): void {
        const target = event.target as HTMLElement | null;
        if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || (target.closest('.sda-player') === null && target !== document.body))) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            const step = event.key === 'ArrowLeft' ? -1 : 1;
            if (event.shiftKey) this.stepReplica(step);
            else this.goTo(this.episode + step);
        } else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
            event.preventDefault();
            this.toggle();
        } else if (event.key === 'Home') {
            this.seek(0);
        }
    }

    // --- Часы и звук.

    private audioFor(asset: string): HTMLAudioElement | null {
        if (this.failed.has(asset)) return null;
        let audio = this.audio.get(asset);
        if (!audio) {
            const url = this.options.resolveAsset?.(asset) ?? this.options.project.assets[asset]?.url ?? null;
            if (!url) {
                this.failed.add(asset);
                return null;
            }
            audio = new Audio();
            audio.preload = 'auto';
            audio.src = url;
            audio.addEventListener('error', () => {
                this.failed.add(asset);
                if (this.playback === 'loading') this.playback = 'playing';
                this.updateChrome();
            });
            this.audio.set(asset, audio);
        }
        return audio;
    }

    private tick(now: number): void {
        if (this.destroyed) return;
        const dt = Math.min(0.25, Math.max(0, (now - this.lastTick) / 1000));
        this.lastTick = now;
        const animator = this.animator;
        if (animator && this.playback === 'playing') {
            this.time += dt;
            this.dirty = true;
            this.syncAudio(animator);
            const duration = animator.duration(this.episode);
            if (this.time >= duration) {
                if (this.options.project.settings.autoAdvance && this.episode < this.options.project.episodes.length - 1) {
                    this.goTo(this.episode + 1, 0);
                } else {
                    this.time = duration;
                    this.playback = 'ended';
                    for (const audio of this.audio.values()) audio.pause();
                    this.updateChrome();
                }
            }
        }
        this.render();
        this.frameId = requestAnimationFrame((next) => this.tick(next));
    }

    private syncAudio(animator: Animator): void {
        const segments = animator.timeline.episodes[this.episode]?.audio ?? [];
        const active = segments.find((s) => this.time >= s.at && this.time < s.at + s.duration && !this.failed.has(s.asset));
        for (const [asset, audio] of this.audio) {
            if ((!active || active.asset !== asset) && !audio.paused) audio.pause();
        }
        if (!active) return;
        const audio = this.audioFor(active.asset);
        if (!audio) return;
        const expected = this.time - active.at + active.offset;
        if (audio.paused) {
            // Запись уже доиграла, а реплика ещё идёт (округление) — не перезапускаем.
            if (audio.ended || (Number.isFinite(audio.duration) && expected >= audio.duration - 0.1)) return;
            const current = ++this.attempt;
            try {
                audio.currentTime = expected;
            } catch {
                // Метаданные ещё не загружены — начнём с начала.
            }
            this.playback = 'loading';
            this.updateChrome();
            audio.play().then(
                () => {
                    if (current !== this.attempt) return;
                    if (this.playback === 'loading') this.playback = 'playing';
                    this.lastTick = performance.now();
                    this.updateChrome();
                },
                (error: DOMException) => {
                    if (current !== this.attempt) return;
                    if (error?.name === 'NotAllowedError') this.playback = 'blocked';
                    else if (error?.name === 'AbortError') this.playback = 'paused';
                    else {
                        this.failed.add(active.asset);
                        this.playback = 'playing';
                    }
                    this.updateChrome();
                }
            );
            return;
        }
        // Часы следуют за записью: мелкое расхождение подтягиваем, крупное — прыжком.
        const drift = active.at + audio.currentTime - active.offset - this.time;
        if (Math.abs(drift) > 0.3) this.time += drift;
        else this.time += drift * 0.1;
    }

    // --- Отрисовка.

    private render(): void {
        const animator = this.animator;
        if (!animator || !this.dirty) return;
        this.dirty = false;
        const frame = animator.frame(this.episode, this.time);
        const rect = this.stage.getBoundingClientRect();
        let camera = frame.camera;
        if (rect.width > 0 && rect.height > 0) {
            // Камеру — под пропорции окна, чтобы закреплённая шапка шла во всю ширину.
            const aspect = rect.width / rect.height;
            const w = Math.max(camera.w, camera.h * aspect);
            const h = Math.max(camera.h, camera.w / aspect);
            camera = { x: camera.x + camera.w / 2 - w / 2, y: camera.y + camera.h / 2 - h / 2, w, h };
        }
        const prims = buildScene(animator.layout, frame.visualOf, { camera, stickyHeader: this.options.project.settings.stickyHeader });
        this.svg.setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.w} ${camera.h}`);
        this.svg.innerHTML = primsToSvg(prims, animator.layout.theme);
        const duration = animator.duration(this.episode);
        this.fill.style.width = `${duration ? Math.min(100, (this.time / duration) * 100) : 0}%`;

        const episode = this.options.project.episodes[this.episode];
        const caption = `${this.episode}|${frame.replica}`;
        if (caption !== this.lastCaption) {
            this.lastCaption = caption;
            this.caption.innerHTML = '';
            const title = el('b', 'sda-caption-title');
            title.textContent = episode ? `${episode.title}. ` : '';
            const text = el('span', 'sda-caption-text');
            text.textContent = frame.text;
            this.caption.append(title, text);
            this.svg.setAttribute('aria-label', `${episode?.title ?? ''}: ${frame.text}`);
        }
    }

    private updateChrome(): void {
        const count = this.options.project.episodes.length;
        const animator = this.animator;
        this.prevButton.disabled = this.episode <= 0;
        this.nextButton.disabled = this.episode >= count - 1;
        const playing = this.playback === 'playing' || this.playback === 'loading';
        this.playButton.innerHTML = playing ? ICONS.pause : ICONS.play;
        this.playButton.setAttribute('aria-label', playing ? 'Пауза' : 'Продолжить');
        this.select.value = String(this.episode);
        [...this.chapters.children].forEach((child, i) => child.classList.toggle('sda-current', i === this.episode));
        this.overlay.hidden = !(this.playback === 'ready' || this.playback === 'blocked');
        this.overlay.querySelector('span')!.textContent = this.playback === 'blocked' ? 'Включить звук' : 'Смотреть';
        this.root.dataset.state = this.playback;
        this.root.dataset.episode = String(this.episode);

        const segments = animator?.timeline.episodes[this.episode]?.audio ?? [];
        const voiced = segments.some((s) => !this.failed.has(s.asset));
        const last = this.episode === count - 1;
        const state = (() => {
            switch (this.playback) {
                case 'ready':
                    return 'нажмите «Смотреть»';
                case 'loading':
                    return 'загружаем речь…';
                case 'paused':
                    return 'пауза — щёлкните по схеме';
                case 'blocked':
                    return 'включите звук щелчком по схеме';
                case 'ended':
                    return last ? 'презентация досмотрена' : 'эпизод досмотрен';
                default:
                    return voiced ? 'говорит диктор' : 'озвучки нет — читайте текст';
            }
        })();
        this.status.textContent = `Эпизод ${this.episode + 1} из ${count} · ${state}`;

        // Метки реплик на шкале.
        const timing = animator?.timeline.episodes[this.episode];
        const key = `${this.episode}`;
        if (timing && this.ticks.dataset.episode !== key) {
            this.ticks.dataset.episode = key;
            this.ticks.innerHTML = '';
            for (const replica of timing.replicas.slice(1)) {
                const tick = el('span', 'sda-tick');
                tick.style.left = `${(replica.start / timing.duration) * 100}%`;
                this.ticks.append(tick);
            }
        }
    }

    get state(): { episode: number; time: number; playback: Playback } {
        return { episode: this.episode, time: this.time, playback: this.playback };
    }
}

export function formatTime(seconds: number): string {
    const s = Math.round(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
