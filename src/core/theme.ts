// Темы оформления диаграммы. Цвета подсветки и приглушения — часть темы:
// в видео и в web-приложении диаграмма выглядит одинаково.

export interface Theme {
    id: string;
    name: string;
    font: string;
    mono: string;
    size: number; // кегль подписей
    small: number; // кегль деталей
    participantStyle: 'flat' | 'bevel';
    dividerStyle: 'center' | 'left';
    radius: number;
    colors: {
        background: string;
        text: string;
        line: string;
        muted: string; // детали под стрелкой
        lifeline: string;
        dim: string; // приглушённые элементы
        highlight: string; // подсвеченные
        glow: string; // ореол подсветки
        async: string; // асинхронные сообщения (события)
        divider: string;
        participantFill: string;
        participantStroke: string;
        participantText: string;
        participantMuted: string;
        noteFill: string;
        noteStroke: string;
        blockStroke: string;
        blockTab: string;
        activationFill: string;
        numberFill: string;
        numberText: string;
        boxFill: string;
        subtitleBg: string;
        subtitleText: string;
    };
}

const FONT = "'SDA Inter', Inter, 'Segoe UI', Roboto, Arial, sans-serif";
const MONO = "'SDA Mono', 'JetBrains Mono', Consolas, 'Courier New', monospace";

export const THEMES: Theme[] = [
    {
        id: 'light',
        name: 'Светлая',
        font: FONT,
        mono: MONO,
        size: 14,
        small: 11.5,
        participantStyle: 'flat',
        dividerStyle: 'center',
        radius: 6,
        colors: {
            background: '#ffffff',
            text: '#1f2328',
            line: '#1f2328',
            muted: '#57606a',
            lifeline: '#8c959f',
            dim: '#b4b9bf',
            highlight: '#d9480f',
            glow: 'rgba(255, 146, 43, 0.30)',
            async: '#0b5cad',
            divider: '#0b5cad',
            participantFill: '#eef2f7',
            participantStroke: '#1f2328',
            participantText: '#1f2328',
            participantMuted: '#57606a',
            noteFill: '#fff8c5',
            noteStroke: '#9a6700',
            blockStroke: '#57606a',
            blockTab: '#eef2f7',
            activationFill: '#ffffff',
            numberFill: '#1f2328',
            numberText: '#ffffff',
            boxFill: 'rgba(84, 174, 255, 0.10)',
            subtitleBg: 'rgba(17, 20, 24, 0.82)',
            subtitleText: '#ffffff',
        },
    },
    {
        id: 'itinder',
        name: 'Классическая (как в ITinder)',
        font: FONT,
        mono: MONO,
        size: 13,
        small: 11,
        participantStyle: 'bevel',
        dividerStyle: 'left',
        radius: 0,
        colors: {
            background: '#ffffff',
            text: '#000000',
            line: '#000000',
            muted: '#44474b',
            lifeline: '#86898d',
            dim: '#9a9da1',
            highlight: '#c2410c',
            glow: 'rgba(255, 196, 0, 0.35)',
            async: '#0000a3',
            divider: '#0000a3',
            participantFill: '#c3c6ca',
            participantStroke: '#000000',
            participantText: '#000000',
            participantMuted: '#44474b',
            noteFill: '#ffffe1',
            noteStroke: '#000000',
            blockStroke: '#44474b',
            blockTab: '#c3c6ca',
            activationFill: '#ffffff',
            numberFill: '#0000a3',
            numberText: '#ffffff',
            boxFill: 'rgba(0, 0, 163, 0.06)',
            subtitleBg: 'rgba(0, 0, 0, 0.78)',
            subtitleText: '#ffffff',
        },
    },
    {
        id: 'dark',
        name: 'Тёмная',
        font: FONT,
        mono: MONO,
        size: 14,
        small: 11.5,
        participantStyle: 'flat',
        dividerStyle: 'center',
        radius: 6,
        colors: {
            background: '#0f1419',
            text: '#e6edf3',
            line: '#e6edf3',
            muted: '#9ba7b4',
            lifeline: '#5b6672',
            dim: '#4a535d',
            highlight: '#ffb224',
            glow: 'rgba(255, 178, 36, 0.28)',
            async: '#58a6ff',
            divider: '#58a6ff',
            participantFill: '#1c2530',
            participantStroke: '#9ba7b4',
            participantText: '#e6edf3',
            participantMuted: '#9ba7b4',
            noteFill: '#3b3417',
            noteStroke: '#bb9a2f',
            blockStroke: '#7d8996',
            blockTab: '#1c2530',
            activationFill: '#1c2530',
            numberFill: '#58a6ff',
            numberText: '#0f1419',
            boxFill: 'rgba(88, 166, 255, 0.08)',
            subtitleBg: 'rgba(0, 0, 0, 0.75)',
            subtitleText: '#ffffff',
        },
    },
];

export function themeById(id: string | undefined): Theme {
    return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

// Смешивание цветов #rrggbb / rgba(): для плавной подсветки и приглушения.
type RGBA = [number, number, number, number];

const cache = new Map<string, RGBA>();

export function parseColor(color: string): RGBA {
    const known = cache.get(color);
    if (known) return known;
    let result: RGBA = [0, 0, 0, 1];
    const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
    if (hex) {
        let h = hex[1];
        if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
        result = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    } else {
        const rgb = /^rgba?\(([^)]*)\)$/i.exec(color.trim());
        if (rgb) {
            const parts = rgb[1].split(',').map((x) => parseFloat(x));
            result = [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts.length > 3 ? parts[3] : 1];
        }
    }
    cache.set(color, result);
    return result;
}

export function mix(a: string, b: string, t: number): string {
    if (t <= 0) return a;
    if (t >= 1) return b;
    const x = parseColor(a);
    const y = parseColor(b);
    const c = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t);
    const alpha = x[3] + (y[3] - x[3]) * t;
    return alpha >= 0.999 ? `rgb(${c(0)}, ${c(1)}, ${c(2)})` : `rgba(${c(0)}, ${c(1)}, ${c(2)}, ${alpha.toFixed(3)})`;
}
