// Код диаграммы + устойчивые id элементов.
//
// Проект хранит код Mermaid и список id в порядке elementsOf(). Когда код
// правят руками, новые элементы сопоставляются со старыми (наибольшая общая
// подпоследовательность по «подписям», затем — по типу в промежутках), и
// реплики не теряют ссылки, даже если сообщение переименовали или вставили
// новое выше.
import { Diagram, DiagramElement, elementsOf } from './diagram';
import { parseMermaid, ParseError, serializeMermaid } from './mermaid';

export interface DiagramSource {
    code: string;
    ids: string[];
}

export interface LoadedDiagram {
    diagram: Diagram;
    errors: ParseError[];
    lineOf: Map<string, number>; // id → строка кода
}

const PREFIX: Record<DiagramElement['type'], string> = {
    participant: 'p',
    message: 'm',
    note: 'n',
    block: 'f',
    branch: 'b',
    divider: 'd',
};

export function idsOf(diagram: Diagram): string[] {
    return elementsOf(diagram).map((element) => element.id);
}

// Новый id вида m12: следующий номер после наибольшего занятого.
export function freshId(type: DiagramElement['type'], taken: Iterable<string>): string {
    const prefix = PREFIX[type];
    let max = 0;
    for (const id of taken) {
        const match = /^([a-z]+)(\d+)$/.exec(id);
        if (match && match[1] === prefix) max = Math.max(max, Number(match[2]));
    }
    return `${prefix}${max + 1}`;
}

function signature(element: DiagramElement): string {
    switch (element.type) {
        case 'participant':
            return `p|${element.alias}`;
        case 'message':
            return `m|${element.from}|${element.to}|${element.arrow}|${element.text}`;
        case 'note':
            return `n|${element.placement}|${element.targets.join(',')}|${element.text}`;
        case 'block':
            return `f|${element.kind}|${element.label}`;
        case 'branch':
            return `b|${element.word}|${element.label}`;
        case 'divider':
            return `d|${element.text}`;
    }
}

// Наибольшая общая подпоследовательность: пары индексов (старый, новый).
function lcs(a: string[], b: string[]): [number, number][] {
    const n = a.length;
    const m = b.length;
    const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    const pairs: [number, number][] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            pairs.push([i, j]);
            i++;
            j++;
        } else if (table[i + 1][j] >= table[i][j + 1]) i++;
        else j++;
    }
    return pairs;
}

// Сопоставляет элементы списка next со старыми, возвращает id для next.
function matchLists(prev: DiagramElement[], next: DiagramElement[]): (string | null)[] {
    const result: (string | null)[] = next.map(() => null);
    const anchors = lcs(prev.map(signature), next.map(signature));
    anchors.push([prev.length, next.length]);
    let pi = 0;
    let ni = 0;
    for (const [ai, aj] of anchors) {
        // Промежуток: старые prev[pi..ai), новые next[ni..aj) — пары по типу по порядку.
        const pool = prev.slice(pi, ai);
        const used = new Set<number>();
        for (let j = ni; j < aj; j++) {
            const k = pool.findIndex((old, index) => !used.has(index) && old.type === next[j].type);
            if (k >= 0) {
                used.add(k);
                result[j] = pool[k].id;
            }
        }
        if (ai < prev.length) result[aj] = prev[ai].id;
        pi = ai + 1;
        ni = aj + 1;
    }
    return result;
}

// Переносит id из prev в next (next — свежеразобранная диаграмма без id).
export function reconcile(prev: Diagram, next: Diagram): void {
    const taken = new Set<string>();
    // Участники: сначала по имени в коде, затем оставшиеся — по порядку.
    const oldByAlias = new Map(prev.participants.map((p) => [p.alias, p]));
    const leftovers = prev.participants.filter((p) => !next.participants.some((q) => q.alias === p.alias));
    for (const p of next.participants) {
        const same = oldByAlias.get(p.alias);
        if (same) p.id = same.id;
        else if (leftovers.length) p.id = leftovers.shift()!.id;
        else p.id = '';
        if (p.id) taken.add(p.id);
    }
    const oldBody = elementsOf(prev).filter((e) => e.type !== 'participant');
    const newBody = elementsOf(next).filter((e) => e.type !== 'participant');
    const ids = matchLists(oldBody, newBody);
    newBody.forEach((element, index) => {
        const id = ids[index];
        element.id = id && !taken.has(id) ? id : '';
        if (element.id) taken.add(element.id);
    });
    assignMissing(next, taken);
}

function assignMissing(diagram: Diagram, taken: Set<string>): void {
    for (const element of elementsOf(diagram)) {
        if (element.id) continue;
        element.id = freshId(element.type, taken);
        taken.add(element.id);
    }
}

// Разбор кода с готовым списком id (при загрузке проекта).
export function loadDiagram(source: DiagramSource): LoadedDiagram {
    const { diagram, errors, lines } = parseMermaid(source.code);
    const elements = elementsOf(diagram);
    const taken = new Set<string>();
    elements.forEach((element, index) => {
        const id = source.ids[index];
        if (id && !taken.has(id)) {
            element.id = id;
            taken.add(id);
        }
    });
    assignMissing(diagram, taken);
    return { diagram, errors, lineOf: linesById(elements, lines) };
}

// Разбор правленого кода: id переносятся с предыдущей диаграммы.
export function reparse(code: string, prev: Diagram): LoadedDiagram {
    const { diagram, errors, lines } = parseMermaid(code);
    reconcile(prev, diagram);
    return { diagram, errors, lineOf: linesById(elementsOf(diagram), lines) };
}

function linesById(elements: DiagramElement[], lines: Map<object, number>): Map<string, number> {
    const map = new Map<string, number>();
    for (const element of elements) {
        const line = lines.get(element);
        if (line !== undefined) map.set(element.id, line);
    }
    return map;
}

// Визуальная правка: диаграмма → код + id. Порядок элементов при повторном
// разборе совпадает, поэтому id переносятся по позиции.
export function sourceOf(diagram: Diagram): DiagramSource {
    return { code: serializeMermaid(diagram), ids: idsOf(diagram) };
}

export function cloneDiagram(diagram: Diagram): Diagram {
    return structuredClone(diagram);
}
