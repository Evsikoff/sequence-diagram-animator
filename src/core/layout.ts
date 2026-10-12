// Раскладка диаграммы: где стоят участники, на какой высоте каждая строка,
// какие рамки у фрагментов и полосы активаций. Координаты «мировые» — камера
// реплики выбирает из них прямоугольник, который виден в кадре.
import { ARROWS, ArrowType, BlockKind, Diagram, firstLine, Item, ParticipantKind, restLines } from './diagram';
import { approximateMeasure, Measure } from './measure';
import { Theme } from './theme';

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface ParticipantBox {
    type: 'participant';
    id: string;
    alias: string;
    label: string;
    description: string;
    kind: ParticipantKind;
    x: number; // центр линии жизни
    w: number;
    h: number;
    top: number;
    lifeTop: number; // откуда идёт линия жизни
    lifeBottom: number;
    destroyed: boolean;
}

export interface MessageGeom {
    type: 'message';
    id: string;
    arrow: ArrowType;
    self: boolean;
    x1: number;
    x2: number;
    y: number; // высота стрелки (для петли — верхний отрезок)
    loopBottom: number; // для петли
    label: string;
    details: string[];
    labelX: number;
    labelY: number;
    detailY: number[];
    anchor: 'start' | 'middle';
    number: number | null;
    async: boolean;
    top: number;
    bottom: number;
}

export interface NoteGeom {
    type: 'note';
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    lines: string[];
    top: number;
    bottom: number;
}

export interface BlockGeom {
    type: 'block';
    id: string;
    kind: BlockKind;
    label: string;
    x1: number;
    x2: number;
    top: number;
    bottom: number;
    headerBottom: number;
    inner: string[]; // все вложенные элементы
    branches: string[];
    depth: number;
}

export interface BranchGeom {
    type: 'branch';
    id: string;
    block: string;
    word: string;
    label: string;
    x1: number;
    x2: number;
    y: number;
    top: number;
    bottom: number;
}

export interface DividerGeom {
    type: 'divider';
    id: string;
    text: string;
    x1: number;
    x2: number;
    y: number;
    top: number;
    bottom: number;
}

export interface ActivationGeom {
    participant: string; // id участника
    x: number; // центр полосы
    top: number;
    bottom: number;
    anchor: string | null; // элемент, с которым полоса появляется
    inner: string[]; // элементы в пределах полосы — по ним полоса «растёт»
}

export interface BoxGeom {
    label: string;
    color: string;
    x1: number;
    x2: number;
    top: number;
    bottom: number;
    members: string[]; // id участников
}

export type Geom = ParticipantBox | MessageGeom | NoteGeom | BlockGeom | BranchGeom | DividerGeom;

export interface Layout {
    theme: Theme;
    title: string;
    titleY: number;
    participants: ParticipantBox[];
    geoms: Map<string, Geom>;
    order: string[]; // id элементов в каноническом порядке
    activations: ActivationGeom[];
    boxes: BoxGeom[];
    headerTop: number;
    headerBottom: number;
    contentBottom: number;
    bounds: Rect;
    elementBounds: Map<string, Rect>;
}

const MARGIN = 28;
const MIN_CENTER_GAP = 150;
const LOOP = 34;
const BAR = 5; // половина ширины полосы активации
const BAR_SHIFT = 5; // смещение вложенной активации
const ICON_KINDS: ParticipantKind[] = ['actor', 'boundary', 'control', 'entity'];

export function isIconKind(kind: ParticipantKind): boolean {
    return ICON_KINDS.includes(kind);
}

export function layoutDiagram(diagram: Diagram, theme: Theme, measure: Measure = approximateMeasure): Layout {
    const size = theme.size;
    const small = theme.small;
    const lineH = Math.round(size * 1.35);
    const smallH = Math.round(small * 1.45);
    const text = (s: string, weight = 400) => measure(s, { size, weight });
    const smallText = (s: string) => measure(s, { size: small, mono: true });
    const boxLabel = (s: string) => measure(s, { size, weight: 600 });

    const index = new Map(diagram.participants.map((p, i) => [p.alias, i]));
    const n = diagram.participants.length;

    // --- Ширина плашек участников.
    const widths = diagram.participants.map((p) => {
        const label = boxLabel(p.label);
        const description = p.description ? Math.max(...p.description.split('\n').map((line) => measure(line, { size: small }))) : 0;
        const content = Math.max(label, description);
        return isIconKind(p.kind) ? Math.max(64, content + 12) : Math.max(96, content + 32);
    });
    const heights = diagram.participants.map((p) => {
        const descLines = p.description ? p.description.split('\n').length : 0;
        if (isIconKind(p.kind)) return 40 + lineH + descLines * smallH;
        const base = 18 + lineH + descLines * smallH;
        return p.kind === 'database' ? base + 12 : base;
    });

    // --- Расстояния между участниками: ограничения «от i до j не меньше d».
    const gaps = new Array(Math.max(0, n - 1)).fill(0).map((_, i) => Math.max(MIN_CENTER_GAP, widths[i] / 2 + widths[i + 1] / 2 + 28));
    const spans: [number, number, number][] = [];
    const need = (a: number, b: number, d: number) => {
        if (a === b || a < 0 || b < 0) return;
        spans.push([Math.min(a, b), Math.max(a, b), d]);
    };
    const messageText = (raw: string) => {
        const lines = [firstLine(raw)].filter(Boolean);
        const details = restLines(raw);
        return Math.max(0, ...lines.map((l) => text(l)), ...details.map(smallText));
    };
    const noteWidth = (raw: string) => Math.max(64, ...raw.split('\n').map((l) => text(l))) + 22;
    let rightExtra = 0;
    let leftExtra = 0;
    for (const item of diagram.items) {
        if (item.type === 'message') {
            const a = index.get(item.from)!;
            const b = index.get(item.to)!;
            const w = messageText(item.text) + (diagram.autonumber ? 22 : 0);
            if (a === b) {
                const needed = LOOP + 14 + w + 12;
                if (a === n - 1) rightExtra = Math.max(rightExtra, needed);
                else need(a, a + 1, needed);
            } else need(a, b, w + 44);
        } else if (item.type === 'note') {
            const w = noteWidth(item.text);
            const a = index.get(item.targets[0])!;
            if (item.placement === 'over' && item.targets.length > 1) {
                need(a, index.get(item.targets[1])!, w - 64);
            } else if (item.placement === 'over') {
                if (a > 0) need(a - 1, a, w / 2 + widths[a - 1] / 2 + 12);
                if (a < n - 1) need(a, a + 1, w / 2 + widths[a + 1] / 2 + 12);
            } else if (item.placement === 'left') {
                if (a > 0) need(a - 1, a, w + 24);
                else leftExtra = Math.max(leftExtra, w + 24 - widths[0] / 2);
            } else {
                if (a < n - 1) need(a, a + 1, w + 24);
                else rightExtra = Math.max(rightExtra, w + 24);
            }
        }
    }
    spans.sort((x, y) => x[1] - x[0] - (y[1] - y[0]));
    for (let pass = 0; pass < 2; pass++) {
        for (const [a, b, d] of spans) {
            let current = 0;
            for (let k = a; k < b; k++) current += gaps[k];
            if (current < d) {
                const add = (d - current) / (b - a);
                for (let k = a; k < b; k++) gaps[k] += add;
            }
        }
    }
    const xs: number[] = [];
    let cursor = MARGIN + leftExtra + (widths[0] ?? 0) / 2 + (diagram.boxes.length ? 12 : 0);
    for (let i = 0; i < n; i++) {
        xs.push(cursor);
        if (i < n - 1) cursor += gaps[i];
    }

    // --- Шапка.
    let y = MARGIN;
    const titleY = y + size + 4;
    if (diagram.title) y += lineH + 18;
    if (diagram.boxes.length) y += 24;
    const headerTop = y;
    const participants: ParticipantBox[] = diagram.participants.map((p, i) => ({
        type: 'participant',
        id: p.id,
        alias: p.alias,
        label: p.label,
        description: p.description,
        kind: p.kind,
        x: xs[i],
        w: widths[i],
        h: heights[i],
        top: headerTop,
        lifeTop: headerTop + heights[i],
        lifeBottom: 0,
        destroyed: false,
    }));
    const byAlias = new Map(participants.map((p) => [p.alias, p]));
    const headerBottom = headerTop + Math.max(0, ...heights);

    // --- Строки.
    const geoms = new Map<string, Geom>();
    const activations: ActivationGeom[] = [];
    const openBars = new Map<string, ActivationGeom[]>(); // alias → стек
    const openBlocks: { geom: BlockGeom }[] = [];
    const pendingCreate = new Set<string>();
    const pendingDestroy = new Set<string>();
    let lastElement: string | null = null;
    let lastArrowY = headerBottom + 10;
    let number = 0;
    y = headerBottom + 20;

    const depth = (alias: string) => openBars.get(alias)?.length ?? 0;
    // Край полосы активации со стороны side (+1 вправо, −1 влево).
    const edge = (alias: string, side: number, extraDepth = 0) => {
        const p = byAlias.get(alias)!;
        const d = depth(alias) + extraDepth;
        if (d <= 0) return p.x;
        return p.x + (d - 1) * BAR_SHIFT + side * BAR;
    };
    const register = (geom: Geom) => {
        geoms.set(geom.id, geom);
        for (const block of openBlocks) block.geom.inner.push(geom.id);
        for (const stack of openBars.values()) for (const bar of stack) bar.inner.push(geom.id);
        lastElement = geom.id;
    };
    const openBar = (alias: string, top: number, anchor: string | null) => {
        const p = byAlias.get(alias)!;
        const stack = openBars.get(alias) ?? [];
        const bar: ActivationGeom = { participant: p.id, x: p.x + stack.length * BAR_SHIFT, top, bottom: top, anchor, inner: [] };
        stack.push(bar);
        openBars.set(alias, stack);
        activations.push(bar);
    };
    const closeBar = (alias: string, bottom: number) => {
        const bar = openBars.get(alias)?.pop();
        if (bar) bar.bottom = Math.max(bar.top + 12, bottom);
    };

    const items: Item[] = diagram.items;
    for (const item of items) {
        switch (item.type) {
            case 'message': {
                const from = byAlias.get(item.from)!;
                const to = byAlias.get(item.to)!;
                const label = firstLine(item.text);
                const details = restLines(item.text);
                const num = diagram.autonumber ? ++number : null;
                const top = y;
                if (from === to) {
                    const loopTop = top + 12;
                    const textLines = 1 + details.length;
                    const loopH = Math.max(24, textLines * smallH + 4);
                    const x = edge(item.from, 1);
                    const labelX = x + LOOP + 10;
                    const labelY = loopTop + 5;
                    const detailY = details.map((_, k) => labelY + smallH * (k + 1));
                    const bottom = Math.max(loopTop + loopH, detailY.length ? detailY[detailY.length - 1] : 0) + 14;
                    const geom: MessageGeom = {
                        type: 'message', id: item.id, arrow: item.arrow, self: true,
                        x1: x, x2: x, y: loopTop, loopBottom: loopTop + loopH,
                        label, details, labelX, labelY, detailY, anchor: 'start', number: num,
                        async: ARROWS[item.arrow].head === 'open' && !ARROWS[item.arrow].dashed,
                        top, bottom,
                    };
                    if (item.deactivate) closeBar(item.from, loopTop);
                    register(geom);
                    if (item.activate) openBar(item.to, loopTop + loopH - 6, item.id);
                    lastArrowY = loopTop + loopH;
                    y = bottom;
                    break;
                }
                const direction = to.x > from.x ? 1 : -1;
                const labelY = top + 6 + size;
                const arrowY = label ? labelY + 8 : top + 14;
                const detailY = details.map((_, k) => arrowY + 6 + small + smallH * k);
                let bottom = (detailY.length ? detailY[detailY.length - 1] + 8 : arrowY + 12);
                bottom = Math.max(bottom, top + 38);
                const x1 = edge(item.from, direction);
                let x2: number;
                if (pendingCreate.has(item.to)) {
                    // Участник создаётся этим сообщением: плашка встаёт на уровне стрелки.
                    pendingCreate.delete(item.to);
                    to.top = arrowY - to.h / 2;
                    to.lifeTop = to.top + to.h;
                    x2 = to.x - direction * (to.w / 2);
                    bottom = Math.max(bottom, to.top + to.h + 10);
                } else {
                    x2 = edge(item.to, -direction, item.activate ? 1 : 0);
                }
                const geom: MessageGeom = {
                    type: 'message', id: item.id, arrow: item.arrow, self: false,
                    x1, x2, y: arrowY, loopBottom: arrowY,
                    label, details, labelX: (x1 + x2) / 2, labelY, detailY, anchor: 'middle', number: num,
                    async: ARROWS[item.arrow].head === 'open' && !ARROWS[item.arrow].dashed,
                    top, bottom,
                };
                if (item.deactivate) closeBar(item.from, arrowY);
                register(geom);
                if (item.activate) openBar(item.to, arrowY, item.id);
                for (const alias of [item.from, item.to]) {
                    if (pendingDestroy.has(alias)) {
                        pendingDestroy.delete(alias);
                        const p = byAlias.get(alias)!;
                        p.lifeBottom = arrowY + 10;
                        p.destroyed = true;
                    }
                }
                lastArrowY = arrowY;
                y = bottom;
                break;
            }
            case 'note': {
                const lines = item.text.split('\n');
                const w0 = noteWidth(item.text);
                const h = lines.length * lineH + 12;
                const a = byAlias.get(item.targets[0])!;
                let x: number;
                let w = w0;
                if (item.placement === 'over' && item.targets.length > 1) {
                    const b = byAlias.get(item.targets[1])!;
                    const left = Math.min(a.x, b.x) - 32;
                    const right = Math.max(a.x, b.x) + 32;
                    w = Math.max(w0, right - left);
                    x = (left + right) / 2 - w / 2;
                } else if (item.placement === 'over') {
                    w = Math.max(w0, 90);
                    x = a.x - w / 2;
                } else if (item.placement === 'left') {
                    x = edge(item.targets[0], -1) - 12 - w;
                } else {
                    x = edge(item.targets[0], 1) + 12;
                }
                const top = y;
                const geom: NoteGeom = { type: 'note', id: item.id, x, y: top + 6, w, h, lines, top, bottom: top + h + 18 };
                register(geom);
                y = geom.bottom;
                break;
            }
            case 'block': {
                const top = y + 4;
                const rect = item.kind === 'rect';
                const geom: BlockGeom = {
                    type: 'block', id: item.id, kind: item.kind, label: item.label,
                    x1: 0, x2: 0, top, bottom: top, headerBottom: rect ? top + 6 : top + 26,
                    inner: [], branches: [], depth: openBlocks.length,
                };
                register(geom);
                openBlocks.push({ geom });
                y = geom.headerBottom + 4;
                break;
            }
            case 'branch': {
                const parent = openBlocks[openBlocks.length - 1]?.geom;
                const geom: BranchGeom = {
                    type: 'branch', id: item.id, block: parent?.id ?? '', word: item.word, label: item.label,
                    x1: 0, x2: 0, y: y + 6, top: y, bottom: y + 30,
                };
                register(geom);
                parent?.branches.push(item.id);
                y += 30;
                break;
            }
            case 'end': {
                const open = openBlocks.pop();
                if (!open) break;
                const block = open.geom;
                block.bottom = y + 6;
                y += 16;
                lastElement = block.id;
                break;
            }
            case 'divider': {
                const geom: DividerGeom = { type: 'divider', id: item.id, text: item.text, x1: 0, x2: 0, y: y + 24, top: y, bottom: y + 40 };
                register(geom);
                y += 40;
                break;
            }
            case 'activate':
                openBar(item.target, lastArrowY, lastElement);
                break;
            case 'deactivate':
                closeBar(item.target, lastArrowY);
                break;
            case 'create':
                pendingCreate.add(item.alias);
                break;
            case 'destroy':
                pendingDestroy.add(item.alias);
                break;
            default:
                break;
        }
    }

    const contentBottom = y;
    const lifeBottom = y + 16;
    for (const p of participants) if (!p.destroyed) p.lifeBottom = lifeBottom;
    for (const stack of openBars.values()) for (const bar of stack) bar.bottom = Math.max(bar.top + 12, lifeBottom - 8);
    // Участник из create без сообщения — плашка там, где встретился create.
    for (const alias of pendingCreate) {
        const p = byAlias.get(alias)!;
        p.top = headerTop;
        p.lifeTop = p.top + p.h;
    }

    // --- Границы элементов (для камеры и щелчков).
    const elementBounds = new Map<string, Rect>();
    const labelWidth = (g: MessageGeom) => Math.max(g.label ? text(g.label) : 0, ...g.details.map(smallText));
    const extent = (g: Geom): [number, number] => {
        switch (g.type) {
            case 'participant':
                return [g.x - g.w / 2, g.x + g.w / 2];
            case 'message': {
                const w = labelWidth(g);
                if (g.self) return [g.x1 - 4, g.labelX + w + 6];
                const left = Math.min(g.x1, g.x2, g.labelX - w / 2) - (g.number !== null ? 12 : 0);
                return [left, Math.max(g.x1, g.x2, g.labelX + w / 2)];
            }
            case 'note':
                return [g.x, g.x + g.w];
            case 'block':
            case 'branch':
            case 'divider':
                return [g.x1, g.x2];
        }
    };

    // Рамки фрагментов: по содержимому, вложенные — внутрь внешних.
    const blocks = [...geoms.values()].filter((g): g is BlockGeom => g.type === 'block').sort((a, b) => b.depth - a.depth);
    const allLeft = Math.min(...participants.map((p) => p.x - p.w / 2));
    const allRight = Math.max(...participants.map((p) => p.x + p.w / 2));
    for (const block of blocks) {
        let left = Infinity;
        let right = -Infinity;
        for (const id of block.inner) {
            const g = geoms.get(id)!;
            if (g.type === 'branch') continue;
            if (g.type === 'block' && g.depth !== block.depth + 1) continue;
            const [a, b] = extent(g);
            const pad = g.type === 'block' ? 10 : 16;
            left = Math.min(left, a - pad);
            right = Math.max(right, b + pad);
        }
        if (!Number.isFinite(left)) {
            left = (participants.length ? allLeft : MARGIN) - 6;
            right = (participants.length ? allRight : MARGIN + 200) + 6;
        }
        const header = block.kind === 'rect' ? 0 : measure(block.kind, { size: small, weight: 600 }) + 22 + (block.label ? text(`[${block.label}]`) + 12 : 0);
        const branchWidth = Math.max(0, ...block.branches.map((id) => {
            const b = geoms.get(id) as BranchGeom;
            return b.label ? text(`[${b.label}]`) + 24 : 0;
        }));
        right = Math.max(right, left + header + 10, left + branchWidth);
        block.x1 = left;
        block.x2 = right;
        for (const id of block.branches) {
            const b = geoms.get(id) as BranchGeom;
            b.x1 = left;
            b.x2 = right;
        }
    }

    let minX = Math.min(...(participants.length ? participants.map((p) => p.x - p.w / 2) : [MARGIN]));
    let maxX = Math.max(...(participants.length ? participants.map((p) => p.x + p.w / 2) : [MARGIN + 300]));
    maxX = Math.max(maxX, (xs[n - 1] ?? MARGIN) + rightExtra);
    for (const g of geoms.values()) {
        if (g.type === 'divider') continue;
        const [a, b] = extent(g);
        minX = Math.min(minX, a);
        maxX = Math.max(maxX, b);
    }
    for (const g of geoms.values()) {
        if (g.type !== 'divider') continue;
        g.x1 = minX;
        g.x2 = maxX;
    }

    for (const g of geoms.values()) {
        const [a, b] = extent(g);
        if (g.type === 'note') elementBounds.set(g.id, { x: g.x, y: g.y, w: g.w, h: g.h });
        else if (g.type === 'block') elementBounds.set(g.id, { x: g.x1, y: g.top, w: g.x2 - g.x1, h: g.bottom - g.top });
        else if (g.type === 'participant') elementBounds.set(g.id, { x: a, y: g.top, w: b - a, h: g.h });
        else elementBounds.set(g.id, { x: a, y: g.top, w: b - a, h: g.bottom - g.top });
    }
    for (const p of participants) {
        geoms.set(p.id, p);
        elementBounds.set(p.id, { x: p.x - p.w / 2, y: p.top, w: p.w, h: p.h });
    }

    // Группы участников (box).
    const boxes: BoxGeom[] = diagram.boxes.map((box, i) => {
        const members = diagram.participants.filter((p) => p.box === i).map((p) => byAlias.get(p.alias)!);
        const x1 = members.length ? Math.min(...members.map((m) => m.x - m.w / 2)) - 12 : 0;
        const x2 = members.length ? Math.max(...members.map((m) => m.x + m.w / 2)) + 12 : 0;
        return { label: box.label, color: box.color, x1, x2, top: headerTop - 26, bottom: lifeBottom + 6, members: members.map((m) => m.id) };
    });
    for (const box of boxes) {
        minX = Math.min(minX, box.x1);
        maxX = Math.max(maxX, box.x2);
    }

    const order = [...participants.map((p) => p.id), ...diagram.items.filter((item) => 'id' in item && geoms.has((item as { id: string }).id)).map((item) => (item as { id: string }).id)];
    const width = maxX - minX + 2 * MARGIN;
    const bounds: Rect = { x: minX - MARGIN, y: 0, w: Math.max(width, 200), h: lifeBottom + MARGIN };

    return {
        theme,
        title: diagram.title,
        titleY,
        participants,
        geoms,
        order,
        activations,
        boxes,
        headerTop,
        headerBottom,
        contentBottom,
        bounds,
        elementBounds,
    };
}

export function unionRects(rects: Rect[]): Rect | null {
    if (!rects.length) return null;
    const x1 = Math.min(...rects.map((r) => r.x));
    const y1 = Math.min(...rects.map((r) => r.y));
    const x2 = Math.max(...rects.map((r) => r.x + r.w));
    const y2 = Math.max(...rects.map((r) => r.y + r.h));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
