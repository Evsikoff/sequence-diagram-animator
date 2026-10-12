// Операции визуального редактора над диаграммой. Все функции меняют
// переданную диаграмму на месте — вызывающий заранее делает копию.
import { ArrowType, BlockKind, BRANCH_WORD, Diagram, elementsOf, Item, Participant, ParticipantKind } from './diagram';
import { freshId } from './source';

function taken(diagram: Diagram): string[] {
    return elementsOf(diagram).map((e) => e.id);
}

export function indexOfItem(diagram: Diagram, id: string): number {
    return diagram.items.findIndex((item) => 'id' in item && item.id === id);
}

// Конец фрагмента, открытого в позиции start (индекс строки end).
export function blockEnd(items: Item[], start: number): number {
    let depth = 0;
    for (let i = start; i < items.length; i++) {
        if (items[i].type === 'block') depth++;
        else if (items[i].type === 'end') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return items.length - 1;
}

// Диапазон строк, который занимает элемент (у фрагмента — вместе с содержимым).
function rangeOf(diagram: Diagram, id: string): [number, number] | null {
    const index = indexOfItem(diagram, id);
    if (index < 0) return null;
    const item = diagram.items[index];
    return item.type === 'block' ? [index, blockEnd(diagram.items, index)] : [index, index];
}

// --- Участники.

export function uniqueAlias(diagram: Diagram, wanted: string): string {
    const base = wanted.replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '') || 'P';
    const used = new Set(diagram.participants.map((p) => p.alias));
    if (!used.has(base)) return base;
    for (let i = 2; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

export function addParticipant(diagram: Diagram, label: string, kind: ParticipantKind = 'participant', index = diagram.participants.length): Participant {
    const alias = uniqueAlias(diagram, translitAlias(label));
    const participant: Participant = {
        type: 'participant',
        id: freshId('participant', taken(diagram)),
        alias,
        label,
        description: '',
        kind,
        explicit: true,
        created: false,
        box: null,
    };
    diagram.participants.splice(Math.max(0, Math.min(index, diagram.participants.length)), 0, participant);
    return participant;
}

const LATIN: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

// Имя в коде из подписи: латиница, без пробелов («Реестр ФСП» → reestr_fsp).
export function translitAlias(label: string): string {
    const latin = [...label.toLowerCase()].map((c) => LATIN[c] ?? c).join('');
    const alias = latin.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    return /^[a-z_]/.test(alias) ? alias : alias ? `p_${alias}` : 'p';
}

export function renameAlias(diagram: Diagram, from: string, to: string): void {
    if (from === to) return;
    const fix = (alias: string) => (alias === from ? to : alias);
    for (const item of diagram.items) {
        if (item.type === 'message') {
            item.from = fix(item.from);
            item.to = fix(item.to);
        } else if (item.type === 'note') item.targets = item.targets.map(fix);
        else if (item.type === 'activate' || item.type === 'deactivate') item.target = fix(item.target);
        else if (item.type === 'create' || item.type === 'destroy') item.alias = fix(item.alias);
    }
    const p = diagram.participants.find((x) => x.alias === from);
    if (p) {
        // Подпись совпадала с именем — меняется вместе с ним.
        if (p.label === from) p.label = to;
        p.alias = to;
    }
}

export function removeParticipant(diagram: Diagram, id: string): void {
    const p = diagram.participants.find((x) => x.id === id);
    if (!p) return;
    diagram.participants = diagram.participants.filter((x) => x !== p);
    diagram.items = diagram.items.filter((item) => {
        if (item.type === 'message') return item.from !== p.alias && item.to !== p.alias;
        if (item.type === 'note') {
            item.targets = item.targets.filter((t) => t !== p.alias);
            return item.targets.length > 0;
        }
        if (item.type === 'activate' || item.type === 'deactivate') return item.target !== p.alias;
        if (item.type === 'create' || item.type === 'destroy') return item.alias !== p.alias;
        return true;
    });
}

export function moveParticipant(diagram: Diagram, id: string, index: number): void {
    const from = diagram.participants.findIndex((x) => x.id === id);
    if (from < 0) return;
    const [p] = diagram.participants.splice(from, 1);
    diagram.participants.splice(Math.max(0, Math.min(index, diagram.participants.length)), 0, p);
    // Участник из чужой группы box выходит из неё, чтобы группы оставались непрерывными.
    const neighbours = [diagram.participants[index - 1], diagram.participants[index + 1]].filter(Boolean);
    if (p.box !== null && !neighbours.some((n) => n.box === p.box)) p.box = null;
    p.explicit = true;
}

// --- Строки тела.

export function insertMessage(diagram: Diagram, from: string, to: string, at: number, text = 'Сообщение', arrow: ArrowType = 'sync'): string {
    const id = freshId('message', taken(diagram));
    diagram.items.splice(clampIndex(diagram, at), 0, { type: 'message', id, from, to, arrow, text, activate: false, deactivate: false });
    return id;
}

export function insertNote(diagram: Diagram, targets: string[], at: number, text = 'Заметка'): string {
    const id = freshId('note', taken(diagram));
    diagram.items.splice(clampIndex(diagram, at), 0, { type: 'note', id, placement: 'over', targets, text });
    return id;
}

export function insertDivider(diagram: Diagram, at: number, text = 'Раздел'): string {
    const id = freshId('divider', taken(diagram));
    diagram.items.splice(clampIndex(diagram, at), 0, { type: 'divider', id, text });
    return id;
}

// Фрагмент вокруг строк [from, to] (или пустой в позиции from).
export function insertBlock(diagram: Diagram, kind: BlockKind, label: string, from: number, to: number | null = null): string {
    const id = freshId('block', taken(diagram));
    const start = clampIndex(diagram, from);
    const end = to === null ? start : Math.max(start, Math.min(to + 1, diagram.items.length));
    diagram.items.splice(end, 0, { type: 'end' });
    diagram.items.splice(start, 0, { type: 'block', id, kind, label });
    return id;
}

export function wrapInBlock(diagram: Diagram, elementId: string, kind: BlockKind, label: string): string | null {
    const range = rangeOf(diagram, elementId);
    if (!range) return null;
    return insertBlock(diagram, kind, label, range[0], range[1]);
}

export function addBranch(diagram: Diagram, blockId: string, label = ''): string | null {
    const start = indexOfItem(diagram, blockId);
    if (start < 0) return null;
    const block = diagram.items[start];
    if (block.type !== 'block') return null;
    const end = blockEnd(diagram.items, start);
    const id = freshId('branch', taken(diagram));
    diagram.items.splice(end, 0, { type: 'branch', id, word: BRANCH_WORD[block.kind] ?? 'else', label });
    return id;
}

// Удаление: у фрагмента удаляется рамка, содержимое остаётся.
export function removeItem(diagram: Diagram, id: string): void {
    const index = indexOfItem(diagram, id);
    if (index < 0) return;
    const item = diagram.items[index];
    if (item.type === 'block') {
        const end = blockEnd(diagram.items, index);
        let depth = 0;
        diagram.items = diagram.items.filter((x, i) => {
            if (i === index || i === end) return false;
            if (i > index && i < end) {
                if (x.type === 'block') depth++;
                if (x.type === 'end') depth--;
                if (x.type === 'branch' && depth === 0) return false;
            }
            return true;
        });
        return;
    }
    diagram.items.splice(index, 1);
}

// Перенос элемента (у фрагмента — целиком) так, чтобы он встал перед строкой target.
export function moveItem(diagram: Diagram, id: string, target: number): void {
    const range = rangeOf(diagram, id);
    if (!range) return;
    const [a, b] = range;
    if (target >= a && target <= b + 1) return;
    const chunk = diagram.items.slice(a, b + 1);
    const rest = [...diagram.items.slice(0, a), ...diagram.items.slice(b + 1)];
    const at = target > b ? target - chunk.length : target;
    rest.splice(Math.max(0, Math.min(at, rest.length)), 0, ...chunk);
    diagram.items = rest;
}

// Сдвиг на одну строку с id вверх/вниз (перешагивая фрагменты целиком).
export function shiftItem(diagram: Diagram, id: string, step: -1 | 1): void {
    const range = rangeOf(diagram, id);
    if (!range) return;
    const [a, b] = range;
    if (step < 0) {
        if (a === 0) return;
        moveItem(diagram, id, a - 1);
    } else {
        if (b >= diagram.items.length - 1) return;
        const next = diagram.items[b + 1];
        const after = next.type === 'block' ? blockEnd(diagram.items, b + 1) : b + 1;
        moveItem(diagram, id, after + 1);
    }
}

function clampIndex(diagram: Diagram, at: number): number {
    return Math.max(0, Math.min(at, diagram.items.length));
}
