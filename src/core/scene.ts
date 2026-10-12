// Сцена: раскладка + визуальное состояние каждого элемента → список
// примитивов (линии, прямоугольники, текст). Примитивы одинаково рисуются в
// SVG (редактор, web-приложение) и на канвасе (экспорт видео), поэтому кадр
// видео совпадает с тем, что видно в плеере.
import { ARROWS } from './diagram';
import { ActivationGeom, BlockGeom, BranchGeom, DividerGeom, Geom, isIconKind, Layout, MessageGeom, NoteGeom, ParticipantBox, Rect } from './layout';
import { mix, Theme } from './theme';

export type Prim =
    | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; w: number; dash?: string }
    | { t: 'poly'; pts: number[]; stroke?: string; fill?: string; w?: number; dash?: string; close?: boolean }
    | { t: 'rect'; x: number; y: number; w: number; h: number; r?: number; fill?: string; stroke?: string; sw?: number; dash?: string }
    | { t: 'path'; d: string; fill?: string; stroke?: string; sw?: number }
    | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: string; sw?: number }
    | {
          t: 'text';
          x: number;
          y: number;
          s: string;
          size: number;
          weight?: number;
          anchor?: 'start' | 'middle' | 'end';
          fill: string;
          mono?: boolean;
          italic?: boolean;
          halo?: string;
      }
    | { t: 'group'; id?: string; opacity?: number; items: Prim[]; hit?: Rect };

// Как выглядит элемент в данный момент.
export interface Visual {
    opacity: number; // 0 — не виден
    progress: number; // 0…1 — насколько прорисован (стрелка «дотягивается»)
    dim: number; // 0…1 — приглушение
    highlight: number; // 0…1 — подсветка
}

export const FULL: Visual = { opacity: 1, progress: 1, dim: 0, highlight: 0 };

export interface SceneOptions {
    camera?: Rect; // для закреплённой шапки участников
    stickyHeader?: boolean;
    hits?: boolean; // прозрачные области для щелчков (редактор)
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function buildScene(layout: Layout, visualOf: (id: string) => Visual | null, options: SceneOptions = {}): Prim[] {
    const theme = layout.theme;
    const c = theme.colors;
    const tone = (base: string, v: Visual) => mix(mix(base, c.dim, v.dim), c.highlight, v.highlight);
    const visible = (id: string | null): Visual | null => {
        if (!id) return null;
        const v = visualOf(id);
        return v && v.opacity > 0.001 ? v : null;
    };

    const background: Prim[] = [];
    const lifelines: Prim[] = [];
    const bars: Prim[] = [];
    const middle: Prim[] = [];
    const header: Prim[] = [];

    // Насколько «дорос» элемент: для рамок и полос активации.
    const reach = (id: string): number | null => {
        const v = visible(id);
        if (!v) return null;
        const g = layout.geoms.get(id);
        if (!g) return null;
        if (g.type === 'message') return g.self ? g.y + (g.loopBottom - g.y) * v.progress : g.y;
        if (g.type === 'block') return blockBottom(g);
        if (g.type === 'note') return g.y + g.h * v.progress;
        if (g.type === 'branch' || g.type === 'divider') return g.y;
        return null;
    };
    const complete = (ids: string[]) => ids.every((id) => {
        const v = visible(id);
        return v !== null && v.progress >= 0.999;
    });
    const bottomCache = new Map<string, number>();
    function blockBottom(block: BlockGeom): number {
        const cached = bottomCache.get(block.id);
        if (cached !== undefined) return cached;
        let bottom: number;
        if (complete(block.inner)) bottom = block.bottom;
        else {
            const reached = block.inner.map(reach).filter((r): r is number => r !== null);
            bottom = Math.min(block.bottom, Math.max(block.headerBottom + 10, ...reached.map((r) => r + 14)));
        }
        bottomCache.set(block.id, bottom);
        return bottom;
    }

    // Группы участников (box) — фоном. Цвета Mermaid обычно насыщенные,
    // поэтому явный цвет рисуем полупрозрачным.
    for (const box of layout.boxes) {
        const shown = box.members.map(visible).filter((v): v is Visual => v !== null);
        if (!shown.length) continue;
        const opacity = Math.max(...shown.map((v) => v.opacity));
        const custom = Boolean(box.color && box.color !== 'transparent');
        const fill = custom ? box.color : c.boxFill;
        const items: Prim[] = [
            {
                t: 'group',
                opacity: custom ? 0.3 : 1,
                items: [{ t: 'rect', x: box.x1, y: box.top, w: box.x2 - box.x1, h: box.bottom - box.top, r: theme.radius, fill }],
            },
            { t: 'rect', x: box.x1, y: box.top, w: box.x2 - box.x1, h: box.bottom - box.top, r: theme.radius, stroke: mix(c.lifeline, c.background, 0.3), sw: 1 },
        ];
        if (box.label) items.push({ t: 'text', x: (box.x1 + box.x2) / 2, y: box.top + 16, s: box.label, size: theme.small, weight: 600, anchor: 'middle', fill: c.muted });
        background.push({ t: 'group', opacity, items });
    }

    if (layout.title) {
        header.push({
            t: 'text',
            x: layout.bounds.x + layout.bounds.w / 2,
            y: layout.titleY,
            s: layout.title,
            size: theme.size + 3,
            weight: 600,
            anchor: 'middle',
            fill: c.text,
        });
    }

    for (const id of layout.order) {
        const g = layout.geoms.get(id)!;
        const v = visible(id);
        if (!v) continue;
        const bounds = layout.elementBounds.get(id);
        const group = (items: Prim[], opacity = v.opacity): Prim => ({ t: 'group', id, opacity, items, hit: options.hits ? bounds : undefined });
        switch (g.type) {
            case 'participant': {
                lifelines.push({ t: 'group', id: `${id}:life`, opacity: v.opacity, items: lifeline(g, v) });
                header.push(group(participantBox(g, g.top, v, theme, tone)));
                break;
            }
            case 'message':
                middle.push(group(message(g, v, theme, tone)));
                break;
            case 'note':
                middle.push(group(note(g, v, theme, tone), v.opacity * clamp(v.progress * 1.5)));
                break;
            case 'block': {
                const bottom = blockBottom(g);
                if (g.kind === 'rect') {
                    background.push(group([{ t: 'rect', x: g.x1, y: g.top, w: g.x2 - g.x1, h: bottom - g.top, r: 4, fill: g.label || c.boxFill }], v.opacity * 0.5));
                } else middle.push(group(block(g, bottom, v, theme, tone)));
                break;
            }
            case 'branch':
                middle.push(group(branch(g, v, theme, tone), v.opacity * clamp(v.progress * 1.5)));
                break;
            case 'divider':
                middle.push(group(divider(g, v, theme, tone)));
                break;
        }
    }

    function lifeline(p: ParticipantBox, v: Visual): Prim[] {
        const color = tone(c.lifeline, v);
        const items: Prim[] = [{ t: 'line', x1: p.x, y1: p.lifeTop, x2: p.x, y2: p.lifeBottom, stroke: color, w: 1, dash: '4 4' }];
        if (p.destroyed) {
            const y = p.lifeBottom;
            items.push({ t: 'line', x1: p.x - 8, y1: y - 8, x2: p.x + 8, y2: y + 8, stroke: tone(c.line, v), w: 2 });
            items.push({ t: 'line', x1: p.x - 8, y1: y + 8, x2: p.x + 8, y2: y - 8, stroke: tone(c.line, v), w: 2 });
        }
        return items;
    }

    // Полосы активации: появляются с «якорным» сообщением и растут вниз.
    for (const bar of layout.activations) {
        const v = visible(bar.anchor) ?? (bar.anchor ? null : visible(bar.participant));
        if (!v) continue;
        const bottom = activationBottom(bar);
        bars.push({
            t: 'group',
            opacity: v.opacity,
            items: [{ t: 'rect', x: bar.x - 5, y: bar.top, w: 10, h: Math.max(4, bottom - bar.top), fill: c.activationFill, stroke: tone(c.line, { ...v, highlight: 0 }), sw: 1 }],
        });
    }
    function activationBottom(bar: ActivationGeom): number {
        if (complete(bar.inner)) return bar.bottom;
        const reached = bar.inner.map(reach).filter((r): r is number => r !== null);
        return Math.min(bar.bottom, Math.max(bar.top + 12, ...reached.map((r) => r + 6)));
    }

    const result: Prim[] = [...background, ...lifelines, ...bars, ...middle, ...header];

    // Закреплённая шапка: когда камера ушла ниже участников, их плашки едут по верху кадра.
    if (options.stickyHeader && options.camera) {
        const cam = options.camera;
        const shift = cam.y + 6 - layout.headerTop;
        const fade = clamp((cam.y - layout.headerTop) / 24);
        if (shift > 0 && fade > 0) {
            const height = layout.headerBottom - layout.headerTop + 12;
            const items: Prim[] = [
                { t: 'rect', x: cam.x - 2, y: cam.y - 2, w: cam.w + 4, h: height + 2, fill: c.background },
                { t: 'line', x1: cam.x, y1: cam.y + height, x2: cam.x + cam.w, y2: cam.y + height, stroke: mix(c.lifeline, c.background, 0.4), w: 1 },
            ];
            for (const p of layout.participants) {
                const v = visible(p.id);
                if (!v) continue;
                items.push({ t: 'group', opacity: v.opacity, items: participantBox(p, p.top + shift, v, theme, tone) });
            }
            result.push({ t: 'group', opacity: fade, items });
        }
    }
    return result;
}

type Tone = (base: string, v: Visual) => string;

function glowLine(points: number[], color: string, amount: number): Prim | null {
    if (amount <= 0.01) return null;
    return { t: 'group', opacity: amount, items: [{ t: 'poly', pts: points, stroke: color, w: 9 }] };
}

// Обрезает ломаную до доли p её длины.
function partial(points: number[], p: number): number[] {
    if (p >= 1) return points;
    let total = 0;
    for (let i = 2; i < points.length; i += 2) total += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
    let left = total * Math.max(0, p);
    const out = [points[0], points[1]];
    for (let i = 2; i < points.length; i += 2) {
        const seg = Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
        if (seg >= left) {
            const k = seg ? left / seg : 0;
            out.push(points[i - 2] + (points[i] - points[i - 2]) * k, points[i - 1] + (points[i + 1] - points[i - 1]) * k);
            return out;
        }
        out.push(points[i], points[i + 1]);
        left -= seg;
    }
    return out;
}

function head(x: number, y: number, direction: number, kind: 'filled' | 'open' | 'none' | 'cross', color: string): Prim[] {
    const back = x - direction * 10;
    if (kind === 'filled') return [{ t: 'poly', pts: [x, y, back, y - 5, back, y + 5], fill: color, close: true }];
    if (kind === 'open') return [{ t: 'poly', pts: [back, y - 6, x, y, back, y + 6], stroke: color, w: 1.4 }];
    if (kind === 'cross') {
        const cx = x - direction * 6;
        return [
            { t: 'line', x1: cx - 5, y1: y - 5, x2: cx + 5, y2: y + 5, stroke: color, w: 1.6 },
            { t: 'line', x1: cx - 5, y1: y + 5, x2: cx + 5, y2: y - 5, stroke: color, w: 1.6 },
        ];
    }
    return [];
}

function message(g: MessageGeom, v: Visual, theme: Theme, tone: Tone): Prim[] {
    const c = theme.colors;
    const spec = ARROWS[g.arrow];
    const color = tone(g.async ? c.async : c.line, v);
    const muted = tone(c.muted, { ...v, highlight: v.highlight * 0.7 });
    const dash = spec.dashed ? '6 4' : undefined;
    const p = clamp(v.progress);
    const items: Prim[] = [];
    const textOpacity = clamp(p * 1.6);

    if (g.self) {
        const x = g.x1;
        const end = x + 34;
        const full = [x, g.y, end, g.y, end, g.loopBottom, x + (spec.head === 'none' ? 0 : 2), g.loopBottom];
        const glow = glowLine(full, c.glow, v.highlight * p);
        if (glow) items.push(glow);
        items.push({ t: 'poly', pts: partial(full, p), stroke: color, w: 1.4, dash });
        if (p >= 0.97) items.push(...head(x, g.loopBottom, -1, spec.head, color));
    } else {
        const direction = g.x2 > g.x1 ? 1 : -1;
        const reachX = g.x1 + (g.x2 - g.x1) * p;
        const glow = glowLine([g.x1, g.y, g.x2, g.y], c.glow, v.highlight * p);
        if (glow) items.push(glow);
        const stop = p >= 0.97 && spec.head === 'filled' ? direction * 4 : 0;
        const start = spec.both && p >= 0.97 ? direction * 4 : 0;
        items.push({ t: 'line', x1: g.x1 + start, y1: g.y, x2: reachX - stop, y2: g.y, stroke: color, w: 1.4, dash });
        if (p >= 0.97) {
            items.push(...head(g.x2, g.y, direction, spec.head, color));
            if (spec.both) items.push(...head(g.x1, g.y, -direction, spec.head, color));
        }
    }

    const texts: Prim[] = [];
    if (g.label) {
        texts.push({ t: 'text', x: g.labelX, y: g.labelY, s: g.label, size: theme.size, anchor: g.anchor, fill: color, halo: c.background, weight: v.highlight > 0.5 ? 600 : 400 });
    }
    g.details.forEach((line, k) => {
        texts.push({ t: 'text', x: g.labelX, y: g.detailY[k], s: line, size: theme.small, anchor: g.anchor, fill: muted, mono: true, halo: c.background });
    });
    if (g.number !== null) {
        const nx = g.self ? g.x1 : g.x1;
        texts.push({ t: 'ellipse', cx: nx, cy: g.y, rx: 9, ry: 9, fill: tone(c.numberFill, v) });
        texts.push({ t: 'text', x: nx, y: g.y + 4, s: String(g.number), size: 10.5, weight: 600, anchor: 'middle', fill: c.numberText });
    }
    if (texts.length) items.push({ t: 'group', opacity: textOpacity, items: texts });
    return items;
}

function note(g: NoteGeom, v: Visual, theme: Theme, tone: Tone): Prim[] {
    const c = theme.colors;
    const stroke = tone(c.noteStroke, v);
    const fill = mix(c.noteFill, c.background, v.dim * 0.6);
    const right = g.x + g.w;
    const bottom = g.y + g.h;
    const items: Prim[] = [];
    if (v.highlight > 0.01) items.push({ t: 'group', opacity: v.highlight, items: [{ t: 'rect', x: g.x - 4, y: g.y - 4, w: g.w + 8, h: g.h + 8, r: 4, fill: c.glow }] });
    items.push({ t: 'path', d: `M${g.x},${g.y} H${right - 9} L${right},${g.y + 9} V${bottom} H${g.x} Z`, fill, stroke, sw: 1 });
    items.push({ t: 'path', d: `M${right - 9},${g.y} V${g.y + 9} H${right}`, stroke, sw: 1 });
    const lineH = Math.round(theme.size * 1.35);
    g.lines.forEach((line, k) => {
        items.push({ t: 'text', x: g.x + g.w / 2, y: g.y + 6 + theme.size + k * lineH, s: line, size: theme.size, anchor: 'middle', fill: tone(c.text, v) });
    });
    return items;
}

function block(g: BlockGeom, bottom: number, v: Visual, theme: Theme, tone: Tone): Prim[] {
    const c = theme.colors;
    const stroke = tone(c.blockStroke, v);
    const words = g.kind;
    const tabW = Math.max(40, words.length * theme.small * 0.62 + 18);
    const items: Prim[] = [];
    if (v.highlight > 0.01) {
        items.push({ t: 'group', opacity: v.highlight, items: [{ t: 'rect', x: g.x1 - 3, y: g.top - 3, w: g.x2 - g.x1 + 6, h: bottom - g.top + 6, r: 3, stroke: c.glow, sw: 7 }] });
    }
    items.push({ t: 'rect', x: g.x1, y: g.top, w: g.x2 - g.x1, h: bottom - g.top, stroke, sw: 1.2 });
    items.push({
        t: 'path',
        d: `M${g.x1},${g.top} H${g.x1 + tabW} V${g.top + 12} L${g.x1 + tabW - 8},${g.top + 20} H${g.x1} Z`,
        fill: mix(c.blockTab, c.background, v.dim * 0.5),
        stroke,
        sw: 1,
    });
    items.push({ t: 'text', x: g.x1 + 7, y: g.top + 14.5, s: words, size: theme.small, weight: 600, fill: tone(c.text, v) });
    if (g.label) {
        items.push({ t: 'text', x: g.x1 + tabW + 10, y: g.top + 15, s: `[${g.label}]`, size: theme.size - 1, fill: tone(c.text, v), halo: c.background });
    }
    return items;
}

function branch(g: BranchGeom, v: Visual, theme: Theme, tone: Tone): Prim[] {
    const c = theme.colors;
    const stroke = tone(c.blockStroke, v);
    const items: Prim[] = [{ t: 'line', x1: g.x1, y1: g.y, x2: g.x2, y2: g.y, stroke, w: 1.1, dash: '6 4' }];
    if (g.label) items.push({ t: 'text', x: g.x1 + 10, y: g.y + 17, s: `[${g.label}]`, size: theme.size - 1, fill: tone(c.text, v), halo: c.background });
    return items;
}

function divider(g: DividerGeom, v: Visual, theme: Theme, tone: Tone): Prim[] {
    const c = theme.colors;
    const color = tone(c.divider, v);
    const p = clamp(v.progress);
    const textOpacity = clamp(p * 1.6);
    if (theme.dividerStyle === 'left') {
        return [
            { t: 'line', x1: g.x1, y1: g.y, x2: g.x1 + (g.x2 - g.x1) * p, y2: g.y, stroke: color, w: 1 },
            { t: 'group', opacity: textOpacity, items: [{ t: 'text', x: g.x1 + 6, y: g.y - 7, s: g.text, size: theme.size + 1, weight: 600, fill: color, halo: c.background }] },
        ];
    }
    const mid = (g.x1 + g.x2) / 2;
    const half = ((g.x2 - g.x1) / 2) * p;
    const w = g.text.length * theme.size * 0.62 + 28;
    return [
        { t: 'line', x1: mid - half, y1: g.y, x2: mid + half, y2: g.y, stroke: color, w: 1.2 },
        {
            t: 'group',
            opacity: textOpacity,
            items: [
                { t: 'rect', x: mid - w / 2, y: g.y - 13, w, h: 26, r: 13, fill: c.background, stroke: color, sw: 1.2 },
                { t: 'text', x: mid, y: g.y + 5, s: g.text, size: theme.size, weight: 600, anchor: 'middle', fill: color },
            ],
        },
    ];
}

export function participantBox(p: ParticipantBox, top: number, v: Visual, theme: Theme, tone: Tone): Prim[] {
    const c = theme.colors;
    const stroke = tone(c.participantStroke, v);
    const textColor = tone(c.participantText, v);
    const mutedColor = tone(c.participantMuted, { ...v, highlight: v.highlight * 0.6 });
    const fill = mix(c.participantFill, c.background, v.dim * 0.5);
    const lineH = Math.round(theme.size * 1.35);
    const smallH = Math.round(theme.small * 1.45);
    const items: Prim[] = [];
    const left = p.x - p.w / 2;
    const description = p.description ? p.description.split('\n') : [];

    if (v.highlight > 0.01) {
        items.push({ t: 'group', opacity: v.highlight, items: [{ t: 'rect', x: left - 5, y: top - 5, w: p.w + 10, h: p.h + 10, r: theme.radius + 4, fill: c.glow }] });
    }

    if (isIconKind(p.kind)) {
        const x = p.x;
        const s = 1.6;
        if (p.kind === 'actor') {
            items.push({ t: 'ellipse', cx: x, cy: top + 7, rx: 6.5, ry: 6.5, fill, stroke, sw: s });
            items.push({ t: 'poly', pts: [x, top + 13.5, x, top + 25], stroke, w: s });
            items.push({ t: 'poly', pts: [x - 11, top + 18, x + 11, top + 18], stroke, w: s });
            items.push({ t: 'poly', pts: [x - 9, top + 35, x, top + 25, x + 9, top + 35], stroke, w: s });
        } else if (p.kind === 'boundary') {
            items.push({ t: 'ellipse', cx: x + 5, cy: top + 18, rx: 14, ry: 14, fill, stroke, sw: s });
            items.push({ t: 'poly', pts: [x - 17, top + 4, x - 17, top + 32], stroke, w: s });
            items.push({ t: 'poly', pts: [x - 17, top + 18, x - 9, top + 18], stroke, w: s });
        } else if (p.kind === 'control') {
            items.push({ t: 'ellipse', cx: x, cy: top + 20, rx: 14, ry: 14, fill, stroke, sw: s });
            items.push({ t: 'poly', pts: [x + 5, top + 1, x - 1, top + 6, x + 5, top + 11], stroke, w: s });
        } else {
            items.push({ t: 'ellipse', cx: x, cy: top + 17, rx: 14, ry: 14, fill, stroke, sw: s });
            items.push({ t: 'poly', pts: [x - 14, top + 33, x + 14, top + 33], stroke, w: s });
        }
        items.push({ t: 'text', x, y: top + 40 + theme.size, s: p.label, size: theme.size, weight: 600, anchor: 'middle', fill: textColor, halo: c.background });
        description.forEach((line, k) => {
            items.push({ t: 'text', x, y: top + 40 + lineH + theme.small + 2 + k * smallH, s: line, size: theme.small, anchor: 'middle', fill: mutedColor, halo: c.background });
        });
        return items;
    }

    const extra = p.kind === 'database' ? 12 : 0;
    const h = p.h;
    if (p.kind === 'database') {
        const rx = p.w / 2;
        items.push({ t: 'path', d: `M${left},${top + 6} A${rx},6 0 0 1 ${left + p.w},${top + 6} V${top + h - 6} A${rx},6 0 0 1 ${left},${top + h - 6} Z`, fill, stroke, sw: 1.2 });
        items.push({ t: 'path', d: `M${left},${top + 6} A${rx},6 0 0 0 ${left + p.w},${top + 6}`, stroke, sw: 1.2 });
    } else if (p.kind === 'collections') {
        items.push({ t: 'rect', x: left + 5, y: top - 5, w: p.w, h, r: theme.radius, fill, stroke, sw: 1.2 });
        items.push({ t: 'rect', x: left, y: top, w: p.w, h, r: theme.radius, fill, stroke, sw: 1.2 });
    } else if (p.kind === 'queue') {
        items.push({ t: 'rect', x: left, y: top, w: p.w, h, r: h / 2, fill, stroke, sw: 1.2 });
        items.push({ t: 'path', d: `M${left + p.w - h / 2},${top} A${h / 4},${h / 2} 0 0 0 ${left + p.w - h / 2},${top + h}`, stroke, sw: 1 });
    } else if (theme.participantStyle === 'bevel') {
        items.push({ t: 'rect', x: left, y: top, w: p.w, h, fill });
        items.push({ t: 'poly', pts: [left, top + h - 1, left, top, left + p.w, top], stroke: v.highlight > 0.01 ? c.highlight : '#ffffff', w: 2 });
        items.push({ t: 'poly', pts: [left + p.w, top, left + p.w, top + h, left, top + h], stroke, w: 1.5 });
    } else {
        items.push({ t: 'rect', x: left, y: top, w: p.w, h, r: theme.radius, fill, stroke, sw: 1.2 + v.highlight * 0.8 });
    }

    const contentTop = top + extra / 2;
    const contentH = h - extra;
    if (description.length) {
        const first = contentTop + 7 + theme.size;
        items.push({ t: 'text', x: p.x, y: first, s: p.label, size: theme.size, weight: 600, anchor: 'middle', fill: textColor });
        description.forEach((line, k) => {
            items.push({ t: 'text', x: p.x, y: first + 4 + theme.small + k * smallH, s: line, size: theme.small, anchor: 'middle', fill: mutedColor });
        });
    } else {
        items.push({ t: 'text', x: p.x, y: contentTop + contentH / 2 + theme.size * 0.36, s: p.label, size: theme.size, weight: 600, anchor: 'middle', fill: textColor });
    }
    return items;
}

export type { Geom };
