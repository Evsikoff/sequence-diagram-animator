// Проект: диаграмма + сценарий анимации + настройки + аудиофайлы.
//
// Сценарий делится на эпизоды (между ними переключаются в плеере, как сцены
// в референсе), эпизод — на реплики. Реплика — фраза диктора, и для неё
// задаётся:
//   set       — какие элементы с этой реплики показаны / скрыты / приглушены
//               (накопительно: действует и в следующих репликах, пока не
//               изменят);
//   highlight — какие элементы подсвечены (только в этой реплике);
//   camera    — какую часть диаграммы видно.
import { DiagramSource } from './source';

export type VisibilityState = 'visible' | 'hidden' | 'dim';

export interface AudioRef {
    asset: string; // ключ в project.assets
    duration: number; // с — запоминаем, чтобы тайминг не зависел от загрузки
}

export type CameraSpec =
    | { mode: 'auto' } // следить за новыми и подсвеченными элементами
    | { mode: 'all' } // вся диаграмма
    | { mode: 'keep' } // как в предыдущей реплике
    | { mode: 'fit'; ids: string[] } // вписать выбранные элементы (пусто — новые и подсвеченные)
    | { mode: 'manual'; x: number; y: number; w: number; h: number };

export interface Replica {
    id: string;
    text: string; // текст диктора, он же субтитр
    set: Record<string, VisibilityState>;
    highlight: string[];
    camera: CameraSpec;
    audio: AudioRef | null; // своя запись реплики
    cue: number | null; // начало реплики в записи эпизода, с
    duration: number | null; // длительность вручную, с
    reveal: 'stagger' | 'together'; // новые элементы — по очереди или разом
}

export interface Episode {
    id: string;
    title: string;
    // Что делать с тем, что показано в прошлых эпизодах: оставить, приглушить, убрать.
    start: 'continue' | 'dim' | 'clear';
    audio: AudioRef | null; // одна запись на весь эпизод (тогда реплики — метки в ней)
    replicas: Replica[];
}

export interface Settings {
    theme: string;
    width: number; // кадр видео
    height: number;
    fps: number;
    subtitles: boolean; // субтитры в видео
    stickyHeader: boolean; // участники держатся у верхнего края кадра
    autoAdvance: boolean; // плеер сам переходит к следующему эпизоду
    readingSpeed: number; // символов в секунду, если нет записи
    minReplica: number; // с
    drawTime: number; // с — прорисовка одного элемента
    cameraTime: number; // с — переезд камеры
    episodeTail: number; // с — пауза в конце эпизода
}

export interface Asset {
    name: string;
    type: string; // MIME
    url: string; // data:, blob: или относительный путь
}

export interface Project {
    format: 'sequence-diagram-animator';
    version: 1;
    title: string;
    description: string;
    diagram: DiagramSource;
    episodes: Episode[];
    settings: Settings;
    assets: Record<string, Asset>;
}

export const DEFAULT_SETTINGS: Settings = {
    theme: 'light',
    width: 1920,
    height: 1080,
    fps: 30,
    subtitles: true,
    stickyHeader: true,
    autoAdvance: true,
    readingSpeed: 14,
    minReplica: 3,
    drawTime: 0.7,
    cameraTime: 0.9,
    episodeTail: 0.8,
};

let counter = 0;
export function uid(prefix: string): string {
    counter = (counter + 1) % 1e6;
    return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function newReplica(partial: Partial<Replica> = {}): Replica {
    return {
        id: uid('r'),
        text: '',
        set: {},
        highlight: [],
        camera: { mode: 'auto' },
        audio: null,
        cue: null,
        duration: null,
        reveal: 'stagger',
        ...partial,
    };
}

export function newEpisode(partial: Partial<Episode> = {}): Episode {
    return {
        id: uid('e'),
        title: 'Новый эпизод',
        start: 'dim',
        audio: null,
        replicas: [newReplica()],
        ...partial,
    };
}

export function newProject(code: string, title = 'Новая диаграмма'): Project {
    return {
        format: 'sequence-diagram-animator',
        version: 1,
        title,
        description: '',
        diagram: { code, ids: [] },
        episodes: [newEpisode({ title: 'Эпизод 1' })],
        settings: { ...DEFAULT_SETTINGS },
        assets: {},
    };
}

// Приводит загруженный JSON к текущему виду (недостающие поля — по умолчанию).
export function normalizeProject(raw: unknown): Project {
    if (!raw || typeof raw !== 'object') throw new Error('Файл проекта пуст или повреждён');
    const data = raw as Partial<Project>;
    if (data.format !== 'sequence-diagram-animator') throw new Error('Это не проект Sequence Diagram Animator');
    if (!data.diagram || typeof data.diagram.code !== 'string') throw new Error('В проекте нет кода диаграммы');
    return {
        format: 'sequence-diagram-animator',
        version: 1,
        title: data.title ?? 'Без названия',
        description: data.description ?? '',
        diagram: { code: data.diagram.code, ids: Array.isArray(data.diagram.ids) ? data.diagram.ids : [] },
        episodes: (data.episodes ?? []).map((episode) => ({
            ...newEpisode(),
            ...episode,
            replicas: (episode.replicas ?? []).map((replica) => ({ ...newReplica(), ...replica })),
        })),
        settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) },
        assets: data.assets ?? {},
    };
}

// Подстановки для текста реплик/заметок не нужны, но длина текста — да:
// столько секунд реплика идёт без записи.
export function estimateDuration(text: string, settings: Settings): number {
    const chars = text.trim().length;
    if (!chars) return Math.max(2, settings.minReplica * 0.8);
    return Math.max(settings.minReplica, chars / settings.readingSpeed);
}

// Кадр видео: высота полосы субтитров и доля, отданная под диаграмму.
export function subtitleBand(settings: Settings): number {
    return settings.subtitles ? Math.round(settings.height * 0.16) : 0;
}

export function diagramAspect(settings: Settings): number {
    return settings.width / Math.max(1, settings.height - subtitleBand(settings));
}
