// Парсер и сериализатор диаграмм последовательности в синтаксисе Mermaid.
//
// Поддерживается всё, что нужно для UML-диаграммы последовательности:
// participant/actor (в том числе participant X@{ "type": "database" }), as,
// create/destroy, box, сообщения всех видов стрелок с +/- активацией,
// activate/deactivate, Note left of/right of/over, фрагменты loop/alt/opt/par/
// critical/break/rect с ветками else/and/option, autonumber, title, комментарии.
// Расширение: строка `%% == Текст ==` — разделитель (Mermaid видит в ней
// комментарий, так что код остаётся корректным Mermaid).
import {
    ARROWS,
    ArrowType,
    BlockKind,
    Box,
    Diagram,
    emptyDiagram,
    Item,
    Participant,
    ParticipantKind,
    PARTICIPANT_KINDS,
} from './diagram';

export interface ParseError {
    line: number; // с 1
    message: string;
}

export interface ParseResult {
    diagram: Diagram;
    errors: ParseError[];
    // Строка кода (с 1) для каждого элемента с id — в порядке elementsOf().
    lines: Map<object, number>;
}

const ARROW_TOKENS: [string, ArrowType][] = (Object.keys(ARROWS) as ArrowType[])
    .map((type) => [ARROWS[type].token, type] as [string, ArrowType])
    .sort((a, b) => b[0].length - a[0].length);

const BLOCK_WORDS: Record<string, BlockKind> = {
    loop: 'loop',
    alt: 'alt',
    opt: 'opt',
    par: 'par',
    par_over: 'par',
    critical: 'critical',
    break: 'break',
    rect: 'rect',
};

const RAW_WORDS = /^(links?|properties|details|acctitle|accdescr)\b/i;

const NAMED_ENTITIES: Record<string, string> = {
    quot: '"',
    amp: '&',
    lt: '<',
    gt: '>',
    nbsp: ' ',
    semi: ';',
    colon: ':',
    num: '#',
};

// Текст из кода Mermaid: <br/> — перенос строки, #59; и #quot; — сущности.
export function decodeText(text: string): string {
    return text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
        .replace(/#([a-zA-Z]+);/g, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim();
}

// Обратно в код: # и ; в тексте Mermaid запрещены, переносы — <br/>.
export function encodeText(text: string): string {
    return text
        .replace(/[#;]/g, (char) => (char === '#' ? '#35;' : '#59;'))
        .split('\n')
        .map((line) => line.trim())
        .join('<br/>');
}

// Разбивает строку на операторы по «;», не трогая сущности вида #59;.
function splitStatements(line: string): string[] {
    const parts: string[] = [];
    let start = 0;
    for (let i = 0; i < line.length; i++) {
        if (line[i] !== ';') continue;
        if (/#\w+$/.test(line.slice(start, i))) continue;
        parts.push(line.slice(start, i));
        start = i + 1;
    }
    parts.push(line.slice(start));
    return parts;
}

const CSS_COLOR = /^(transparent|aqua|aquamarine|beige|black|blue|brown|coral|cyan|gold|gray|grey|green|ivory|khaki|lavender|lime|linen|magenta|maroon|navy|olive|orange|orchid|pink|plum|purple|red|salmon|silver|tan|teal|thistle|tomato|turquoise|violet|wheat|white|yellow|light\w+|dark\w+|pale\w+|#[0-9a-f]{3,8})$/i;

function parseBoxHeader(rest: string): Box {
    const text = rest.trim();
    const rgb = /^(rgba?\([^)]*\))\s*(.*)$/i.exec(text);
    if (rgb) return { color: rgb[1], label: rgb[2].trim() };
    const [word, ...others] = text.split(/\s+/);
    if (word && CSS_COLOR.test(word)) return { color: word, label: others.join(' ') };
    return { color: '', label: text };
}

interface DeclarationParts {
    alias: string;
    kind: ParticipantKind | null;
    label: string | null;
}

// participant ID[@{ "type": "database" }] [as Label]
function parseDeclaration(rest: string): DeclarationParts | null {
    let text = rest.trim();
    let kind: ParticipantKind | null = null;
    let configLabel: string | null = null;
    const config = /@\{([^}]*)\}/.exec(text);
    if (config) {
        const type = /["']?type["']?\s*:\s*["']?(\w+)["']?/.exec(config[1]);
        if (type && (PARTICIPANT_KINDS as string[]).includes(type[1].toLowerCase())) kind = type[1].toLowerCase() as ParticipantKind;
        const alias = /["']?alias["']?\s*:\s*["']([^"']*)["']/.exec(config[1]);
        if (alias) configLabel = alias[1];
        text = (text.slice(0, config.index) + ' ' + text.slice(config.index + config[0].length)).replace(/\s+/g, ' ').trim();
    }
    const as = /^(.+?)\s+as\s+(.+)$/i.exec(text);
    const alias = (as ? as[1] : text).trim();
    if (!alias) return null;
    const label = as ? as[2] : configLabel;
    return { alias, kind, label };
}

export function parseMermaid(code: string): ParseResult {
    const diagram = emptyDiagram();
    const errors: ParseError[] = [];
    const lines = new Map<object, number>();
    const byAlias = new Map<string, Participant>();
    const stack: ('box' | 'block')[] = [];
    let currentBox: number | null = null;
    let started = false; // встретили sequenceDiagram
    let anything = false; // встретили хоть один оператор

    const ensure = (alias: string, line: number): Participant => {
        let participant = byAlias.get(alias);
        if (!participant) {
            participant = {
                type: 'participant',
                id: '',
                alias,
                label: alias,
                description: '',
                kind: 'participant',
                explicit: false,
                created: false,
                box: null,
            };
            byAlias.set(alias, participant);
            diagram.participants.push(participant);
            lines.set(participant, line);
        }
        return participant;
    };

    const push = (item: Item, line: number) => {
        diagram.items.push(item);
        lines.set(item, line);
    };

    const source = code.replace(/\r\n?/g, '\n').split('\n');
    let index = 0;

    // Front matter --- … --- в начале — сохраняем как есть.
    while (index < source.length && source[index].trim() === '') index++;
    if (source[index]?.trim() === '---') {
        const end = source.findIndex((line, i) => i > index && line.trim() === '---');
        if (end > index) {
            diagram.header.push(...source.slice(index, end + 1));
            index = end + 1;
        }
    }

    for (; index < source.length; index++) {
        const lineNo = index + 1;
        const physical = source[index].trim();
        if (!physical) continue;

        if (physical.startsWith('%%')) {
            const divider = /^%%\s*==\s*(.*?)\s*==\s*$/.exec(physical);
            if (divider && started) {
                push({ type: 'divider', id: '', text: decodeText(divider[1]) }, lineNo);
            } else if (/^%%\{.*\}%%$/.test(physical) && !anything) {
                diagram.header.push(physical);
            } else if (!started) {
                diagram.header.push(physical);
            } else {
                push({ type: 'comment', text: physical.slice(2) }, lineNo);
            }
            continue;
        }

        for (const part of splitStatements(physical)) {
            const s = part.trim();
            if (!s) continue;
            const fail = (message: string) => errors.push({ line: lineNo, message });

            if (/^sequenceDiagram\b/.test(s)) {
                if (started) fail('Повторная строка sequenceDiagram');
                started = true;
                continue;
            }
            if (!started) {
                fail('Код должен начинаться со строки sequenceDiagram');
                started = true;
            }
            anything = true;

            let match: RegExpExecArray | null;
            // «loop->>B: …» — это сообщение участнику loop, а не ключевое слово.
            const wordThenArrow = /^\w+\s*(<<|-)/.test(s);
            if (!wordThenArrow && (match = /^title\b\s*:?\s*(.*)$/i.exec(s))) {
                diagram.title = decodeText(match[1]);
                continue;
            }
            if (!wordThenArrow && (match = /^autonumber\b\s*(.*)$/i.exec(s))) {
                diagram.autonumber = match[1].trim().toLowerCase() !== 'off';
                continue;
            }
            if ((match = /^box\b(.*)$/i.exec(s))) {
                if (stack.length) {
                    fail('box можно открыть только на верхнем уровне');
                    continue;
                }
                diagram.boxes.push(parseBoxHeader(match[1]));
                currentBox = diagram.boxes.length - 1;
                stack.push('box');
                continue;
            }
            if (/^end$/i.test(s)) {
                const top = stack.pop();
                if (!top) fail('Лишний end: нечего закрывать');
                else if (top === 'box') currentBox = null;
                else push({ type: 'end' }, lineNo);
                continue;
            }
            if ((match = /^(create\s+)?(participant|actor)\s+(.+)$/i.exec(s))) {
                const parts = parseDeclaration(match[3]);
                if (!parts) {
                    fail('Не указано имя участника');
                    continue;
                }
                const created = Boolean(match[1]);
                const existed = byAlias.has(parts.alias);
                const participant = ensure(parts.alias, lineNo);
                if (existed && participant.explicit) fail(`Участник ${parts.alias} уже объявлен`);
                participant.explicit = true;
                participant.kind = parts.kind ?? (match[2].toLowerCase() === 'actor' ? 'actor' : 'participant');
                if (parts.label !== null) {
                    const text = decodeText(parts.label);
                    const [label, ...description] = text.split('\n');
                    participant.label = label || parts.alias;
                    participant.description = description.join('\n');
                }
                if (currentBox !== null) participant.box = currentBox;
                if (created) {
                    participant.created = true;
                    push({ type: 'create', alias: parts.alias }, lineNo);
                }
                continue;
            }
            if ((match = /^destroy\s+(.+)$/i.exec(s))) {
                ensure(match[1].trim(), lineNo);
                push({ type: 'destroy', alias: match[1].trim() }, lineNo);
                continue;
            }
            if ((match = /^(activate|deactivate)\s+(.+)$/i.exec(s))) {
                const target = match[2].trim();
                ensure(target, lineNo);
                push({ type: match[1].toLowerCase() as 'activate' | 'deactivate', target }, lineNo);
                continue;
            }
            if ((match = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:(.*)$/i.exec(s))) {
                const placement = match[1].toLowerCase().startsWith('left') ? 'left' : match[1].toLowerCase().startsWith('right') ? 'right' : 'over';
                const targets = match[2]
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .slice(0, 2);
                if (!targets.length) {
                    fail('У заметки не указан участник');
                    continue;
                }
                targets.forEach((t) => ensure(t, lineNo));
                push({ type: 'note', id: '', placement, targets, text: decodeText(match[3]) }, lineNo);
                continue;
            }
            if (/^note\b/i.test(s)) {
                fail('Заметка пишется так: Note over A: текст (или left of / right of)');
                continue;
            }
            if ((match = /^(\w+)\b\s*(.*)$/.exec(s)) && BLOCK_WORDS[match[1].toLowerCase()] && !wordThenArrow) {
                if (stack.includes('box')) {
                    fail('Фрагмент нельзя открыть внутри box');
                    continue;
                }
                stack.push('block');
                push({ type: 'block', id: '', kind: BLOCK_WORDS[match[1].toLowerCase()], label: decodeText(match[2]) }, lineNo);
                continue;
            }
            if (!wordThenArrow && (match = /^(else|and|option)\b\s*(.*)$/i.exec(s))) {
                if (stack[stack.length - 1] !== 'block') {
                    fail(`${match[1]} вне фрагмента`);
                    continue;
                }
                push({ type: 'branch', id: '', word: match[1].toLowerCase() as 'else' | 'and' | 'option', label: decodeText(match[2]) }, lineNo);
                continue;
            }
            if (RAW_WORDS.test(s)) {
                push({ type: 'raw', text: s }, lineNo);
                continue;
            }

            const message = parseMessage(s);
            if (message) {
                ensure(message.from, lineNo);
                ensure(message.to, lineNo);
                push({ type: 'message', id: '', ...message }, lineNo);
                continue;
            }
            fail(`Не понимаю строку: ${s}`);
        }
    }

    if (!started) errors.push({ line: 1, message: 'Нет строки sequenceDiagram' });
    if (stack.length) {
        errors.push({
            line: source.length,
            message: stack[stack.length - 1] === 'box' ? 'Не закрыт box (нет end)' : 'Не закрыт фрагмент (нет end)',
        });
        // Закрываем, чтобы схема всё равно нарисовалась.
        for (const top of stack.reverse()) if (top === 'block') diagram.items.push({ type: 'end' });
    }
    return { diagram, errors, lines };
}

function parseMessage(s: string): { from: string; to: string; arrow: ArrowType; text: string; activate: boolean; deactivate: boolean } | null {
    for (let i = 1; i < s.length; i++) {
        if (s[i] !== '-' && s[i] !== '<') continue;
        const found = ARROW_TOKENS.find(([token]) => s.startsWith(token, i));
        if (!found) continue;
        const [token, arrow] = found;
        const from = s.slice(0, i).trim();
        let rest = s.slice(i + token.length).trimStart();
        let activate = false;
        let deactivate = false;
        if (rest.startsWith('+')) {
            activate = true;
            rest = rest.slice(1);
        } else if (rest.startsWith('-')) {
            deactivate = true;
            rest = rest.slice(1);
        }
        const colon = rest.indexOf(':');
        const to = (colon < 0 ? rest : rest.slice(0, colon)).trim();
        const text = colon < 0 ? '' : decodeText(rest.slice(colon + 1));
        if (!from || !to || from.includes(':')) return null;
        return { from, to, arrow, text, activate, deactivate };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Сериализация

const INDENT = '    ';

function declaration(p: Participant, create = false): string {
    const word = p.kind === 'actor' ? 'actor' : 'participant';
    const config = p.kind === 'actor' || p.kind === 'participant' ? '' : `@{ "type" : "${p.kind}" }`;
    const fullLabel = p.description ? `${p.label}\n${p.description}` : p.label;
    const as = fullLabel !== p.alias ? ` as ${encodeText(fullLabel)}` : '';
    return `${create ? 'create ' : ''}${word} ${p.alias}${config}${as}`;
}

function needsDeclaration(p: Participant): boolean {
    return p.explicit || p.label !== p.alias || Boolean(p.description) || p.kind !== 'participant' || p.box !== null;
}

// Порядок участников, который получит Mermaid, если объявить только declared.
function impliedOrder(diagram: Diagram, declared: Set<string>): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const add = (alias: string) => {
        if (!seen.has(alias)) {
            seen.add(alias);
            order.push(alias);
        }
    };
    diagram.participants.forEach((p) => {
        if (declared.has(p.alias) && !p.created) add(p.alias);
    });
    for (const item of diagram.items) {
        if (item.type === 'create') add(item.alias);
        else if (item.type === 'message') {
            add(item.from);
            add(item.to);
        } else if (item.type === 'note') item.targets.forEach(add);
        else if (item.type === 'activate' || item.type === 'deactivate') add(item.target);
        else if (item.type === 'destroy') add(item.alias);
    }
    diagram.participants.forEach((p) => add(p.alias));
    return order;
}

export function serializeMermaid(diagram: Diagram): string {
    const out: string[] = [...diagram.header, 'sequenceDiagram'];
    if (diagram.title) out.push(`${INDENT}title ${encodeText(diagram.title).replace(/<br\/>/g, ' ')}`);
    if (diagram.autonumber) out.push(`${INDENT}autonumber`);

    let declared = new Set(diagram.participants.filter(needsDeclaration).map((p) => p.alias));
    const wanted = diagram.participants.map((p) => p.alias).join('\n');
    if (impliedOrder(diagram, declared).join('\n') !== wanted) {
        declared = new Set(diagram.participants.map((p) => p.alias));
    }

    const top = diagram.participants.filter((p) => !p.created && declared.has(p.alias));
    for (let i = 0; i < top.length; ) {
        const p = top[i];
        if (p.box === null || !diagram.boxes[p.box]) {
            out.push(INDENT + declaration(p));
            i++;
            continue;
        }
        const box = diagram.boxes[p.box];
        out.push(`${INDENT}box ${[box.color, box.label].filter(Boolean).join(' ')}`.trimEnd());
        while (i < top.length && top[i].box === p.box) out.push(INDENT + INDENT + declaration(top[i++]));
        out.push(`${INDENT}end`);
    }

    let depth = 1;
    const line = (text: string) => out.push(INDENT.repeat(depth) + text);
    for (const item of diagram.items) {
        switch (item.type) {
            case 'message': {
                const marker = item.activate ? '+' : item.deactivate ? '-' : '';
                line(`${item.from}${ARROWS[item.arrow].token}${marker}${item.to}: ${encodeText(item.text)}`);
                break;
            }
            case 'note': {
                const where = item.placement === 'over' ? 'over' : `${item.placement} of`;
                line(`Note ${where} ${item.targets.join(',')}: ${encodeText(item.text)}`);
                break;
            }
            case 'block':
                line(`${item.kind}${item.label ? ' ' + encodeText(item.label) : ''}`);
                depth++;
                break;
            case 'branch':
                depth = Math.max(1, depth - 1);
                line(`${item.word}${item.label ? ' ' + encodeText(item.label) : ''}`);
                depth++;
                break;
            case 'end':
                depth = Math.max(1, depth - 1);
                line('end');
                break;
            case 'divider':
                line(`%% == ${item.text.replace(/\n/g, ' ')} ==`);
                break;
            case 'activate':
            case 'deactivate':
                line(`${item.type} ${item.target}`);
                break;
            case 'create': {
                const p = diagram.participants.find((x) => x.alias === item.alias);
                if (p) line(declaration(p, true));
                break;
            }
            case 'destroy':
                line(`destroy ${item.alias}`);
                break;
            case 'comment':
                line(`%%${item.text}`);
                break;
            case 'raw':
                line(item.text);
                break;
        }
    }
    return out.join('\n') + '\n';
}
