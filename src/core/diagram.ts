// Модель диаграммы последовательности.
//
// Источник истины — код в синтаксисе Mermaid (sequenceDiagram). Парсер
// (mermaid.ts) превращает его в Diagram, сериализатор — обратно в код.
// Визуальный редактор меняет Diagram и пересобирает код, редактор кода —
// наоборот. У каждого видимого элемента есть устойчивый id: на него ссылаются
// реплики анимации. Код id не хранит — проект хранит их отдельным списком
// в порядке элементов, а при правке кода id переносятся сопоставлением
// (reconcile.ts).

export type ParticipantKind =
    | 'participant'
    | 'actor'
    | 'boundary'
    | 'control'
    | 'entity'
    | 'database'
    | 'collections'
    | 'queue';

export const PARTICIPANT_KINDS: ParticipantKind[] = [
    'participant',
    'actor',
    'boundary',
    'control',
    'entity',
    'database',
    'collections',
    'queue',
];

// Стрелки Mermaid. Отрисовка — по нотации UML: вызов — сплошная линия и
// закрашенный наконечник, ответ — пунктир и открытый, асинхронное сообщение —
// сплошная линия и открытый наконечник.
export type ArrowType =
    | 'sync' // ->>
    | 'reply' // -->>
    | 'async' // -)
    | 'asyncDashed' // --)
    | 'line' // ->
    | 'dashedLine' // -->
    | 'lost' // -x
    | 'lostDashed' // --x
    | 'both' // <<->>
    | 'bothDashed'; // <<-->>

export const ARROWS: Record<ArrowType, { token: string; dashed: boolean; head: 'filled' | 'open' | 'none' | 'cross'; both?: boolean; title: string }> = {
    sync: { token: '->>', dashed: false, head: 'filled', title: 'Вызов (синхронный)' },
    reply: { token: '-->>', dashed: true, head: 'open', title: 'Ответ' },
    async: { token: '-)', dashed: false, head: 'open', title: 'Асинхронное сообщение / событие' },
    asyncDashed: { token: '--)', dashed: true, head: 'open', title: 'Асинхронный ответ' },
    line: { token: '->', dashed: false, head: 'none', title: 'Линия без стрелки' },
    dashedLine: { token: '-->', dashed: true, head: 'none', title: 'Пунктир без стрелки' },
    lost: { token: '-x', dashed: false, head: 'cross', title: 'Потерянное сообщение' },
    lostDashed: { token: '--x', dashed: true, head: 'cross', title: 'Потерянный ответ' },
    both: { token: '<<->>', dashed: false, head: 'filled', both: true, title: 'В обе стороны' },
    bothDashed: { token: '<<-->>', dashed: true, head: 'filled', both: true, title: 'В обе стороны, пунктир' },
};

export type BlockKind = 'loop' | 'alt' | 'opt' | 'par' | 'critical' | 'break' | 'rect';
export const BLOCK_KINDS: BlockKind[] = ['loop', 'alt', 'opt', 'par', 'critical', 'break', 'rect'];
// Какое слово открывает ветку внутри фрагмента.
export const BRANCH_WORD: Partial<Record<BlockKind, 'else' | 'and' | 'option'>> = {
    alt: 'else',
    par: 'and',
    critical: 'option',
};

export interface Participant {
    type: 'participant';
    id: string; // id элемента (для реплик)
    alias: string; // имя в коде Mermaid
    label: string; // подпись; по умолчанию = alias
    description: string; // вторая строка подписи (<br/> в Mermaid)
    kind: ParticipantKind;
    explicit: boolean; // объявлен строкой participant/actor (а не появился из сообщения)
    created: boolean; // create participant — появляется по ходу диаграммы
    box: number | null; // индекс группы box
}

export interface Message {
    type: 'message';
    id: string;
    from: string; // alias
    to: string;
    arrow: ArrowType;
    text: string; // первая строка — подпись над стрелкой, остальные — детали под ней
    activate: boolean; // ->>+
    deactivate: boolean; // -->>-
}

export interface Note {
    type: 'note';
    id: string;
    placement: 'left' | 'right' | 'over';
    targets: string[]; // один или два alias
    text: string;
}

export interface BlockStart {
    type: 'block';
    id: string;
    kind: BlockKind;
    label: string; // условие; для rect — цвет
}

export interface BlockBranch {
    type: 'branch';
    id: string;
    word: 'else' | 'and' | 'option';
    label: string;
}

export interface BlockEnd {
    type: 'end';
}

// Разделитель-заголовок поперёк диаграммы. В Mermaid такого нет, поэтому он
// пишется комментарием `%% == Текст ==`: Mermaid его пропустит, а мы нарисуем.
export interface Divider {
    type: 'divider';
    id: string;
    text: string;
}

export interface Activation {
    type: 'activate' | 'deactivate';
    target: string;
}

export interface Create {
    type: 'create';
    alias: string;
}

export interface Destroy {
    type: 'destroy';
    alias: string;
}

export interface Comment {
    type: 'comment';
    text: string;
}

// Строки, которые мы не рисуем, но сохраняем как есть (links, properties, accTitle…).
export interface Raw {
    type: 'raw';
    text: string;
}

export type Item = Message | Note | BlockStart | BlockBranch | BlockEnd | Divider | Activation | Create | Destroy | Comment | Raw;
export type ElementItem = Message | Note | BlockStart | BlockBranch | Divider;
export type DiagramElement = Participant | ElementItem;

export interface Box {
    label: string;
    color: string;
}

export interface Diagram {
    header: string[]; // строки до sequenceDiagram (front matter, %%{init}%%)
    title: string;
    autonumber: boolean;
    participants: Participant[];
    boxes: Box[];
    items: Item[];
}

export function hasId(item: Item | Participant): item is DiagramElement {
    return (
        item.type === 'participant' ||
        item.type === 'message' ||
        item.type === 'note' ||
        item.type === 'block' ||
        item.type === 'branch' ||
        item.type === 'divider'
    );
}

// Все элементы с id в каноническом порядке: участники, затем тело сверху вниз.
export function elementsOf(diagram: Diagram): DiagramElement[] {
    const body = diagram.items.filter(hasId) as ElementItem[];
    return [...diagram.participants, ...body];
}

export function emptyDiagram(): Diagram {
    return { header: [], title: '', autonumber: false, participants: [], boxes: [], items: [] };
}

export function firstLine(text: string): string {
    const index = text.indexOf('\n');
    return index < 0 ? text : text.slice(0, index);
}

export function restLines(text: string): string[] {
    const lines = text.split('\n');
    return lines.slice(1);
}

// Короткое описание элемента для списков в редакторе.
export function describe(element: DiagramElement, diagram: Diagram): string {
    const name = (alias: string) => diagram.participants.find((p) => p.alias === alias)?.label ?? alias;
    switch (element.type) {
        case 'participant':
            return element.label;
        case 'message':
            return `${name(element.from)} → ${name(element.to)}: ${firstLine(element.text)}`;
        case 'note':
            return `Заметка: ${firstLine(element.text)}`;
        case 'block':
            return `${element.kind}${element.label ? ' ' + element.label : ''}`;
        case 'branch':
            return `${element.word}${element.label ? ' ' + element.label : ''}`;
        case 'divider':
            return `== ${element.text} ==`;
    }
}

export const ELEMENT_KIND_TITLE: Record<DiagramElement['type'], string> = {
    participant: 'Участник',
    message: 'Сообщение',
    note: 'Заметка',
    block: 'Фрагмент',
    branch: 'Ветка фрагмента',
    divider: 'Разделитель',
};
