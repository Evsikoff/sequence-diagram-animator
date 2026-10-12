// Ширина текста для раскладки. В браузере меряем канвасом тем же шрифтом,
// которым рисуем; вне браузера (тесты, Node) — приблизительно по таблице.

export interface FontSpec {
    size: number;
    weight?: number;
    mono?: boolean;
}

export type Measure = (text: string, font: FontSpec) => number;

// Средняя ширина символов Inter в долях кегля.
function charWidth(char: string): number {
    if (char === ' ') return 0.28;
    if (/[0-9]/.test(char)) return 0.6;
    if (/[iljI.,:;'|!]/.test(char)) return 0.3;
    if (/[mwMWЖШЩЮжшщюМм]/.test(char)) return 0.85;
    if (/[A-ZА-ЯЁ]/.test(char)) return 0.68;
    if (/[a-zа-яё]/.test(char)) return 0.55;
    return 0.6;
}

export const approximateMeasure: Measure = (text, font) => {
    if (font.mono) return text.length * 0.6 * font.size;
    let sum = 0;
    for (const char of text) sum += charWidth(char);
    return sum * font.size * ((font.weight ?? 400) >= 600 ? 1.05 : 1);
};

// Измеритель на канвасе. families — CSS font-family темы.
export function canvasMeasure(family: string, mono: string): Measure {
    if (typeof document === 'undefined') return approximateMeasure;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return approximateMeasure;
    const cache = new Map<string, number>();
    return (text, font) => {
        const css = `${font.weight ?? 400} ${font.size}px ${font.mono ? mono : family}`;
        const key = css + '\u0000' + text;
        let width = cache.get(key);
        if (width === undefined) {
            context.font = css;
            width = context.measureText(text).width;
            cache.set(key, width);
        }
        return width;
    };
}

// Ждём загрузки шрифтов диаграммы, чтобы раскладка не «прыгнула» после.
export async function loadFonts(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return;
    const probes = ['400 14px "SDA Inter"', '600 14px "SDA Inter"', '400 12px "SDA Mono"'];
    const sample = 'AaЯя01';
    try {
        await Promise.all(probes.map((font) => document.fonts.load(font, sample)));
    } catch {
        // Шрифт не загрузился — рисуем запасным.
    }
}
