import { describe, expect, it } from 'vitest';
import { elementsOf } from '../src/core/diagram';
import { decodeText, encodeText, parseMermaid, serializeMermaid } from '../src/core/mermaid';
import { loadDiagram, reparse, sourceOf } from '../src/core/source';

const SAMPLE = `sequenceDiagram
    title Вход через ФСП ID
    autonumber
    actor user as Кандидат<br/>браузер
    participant itinder as ITinder
    participant kc@{ "type" : "database" } as ФСП ID
    %% == 1. Вход ==
    user->>+itinder: Связать профиль<br/>{fsp_id}
    itinder-->>-user: 302 → вход
    Note over user,kc: Логин#59; пароль
    loop Раз в сутки
        itinder-)kc: GET /results
        alt есть изменения
            kc--)itinder: Изменения
        else нет
            kc-->>itinder: 304
        end
    end
    itinder->>itinder: Новые компетенции
    %% обычный комментарий
`;

describe('parseMermaid', () => {
    it('разбирает участников, сообщения, заметки, фрагменты и разделители', () => {
        const { diagram, errors } = parseMermaid(SAMPLE);
        expect(errors).toEqual([]);
        expect(diagram.title).toBe('Вход через ФСП ID');
        expect(diagram.autonumber).toBe(true);
        expect(diagram.participants.map((p) => [p.alias, p.label, p.kind, p.description])).toEqual([
            ['user', 'Кандидат', 'actor', 'браузер'],
            ['itinder', 'ITinder', 'participant', ''],
            ['kc', 'ФСП ID', 'database', ''],
        ]);
        const types = diagram.items.map((item) => item.type);
        expect(types).toEqual(['divider', 'message', 'message', 'note', 'block', 'message', 'block', 'message', 'branch', 'message', 'end', 'end', 'message', 'comment']);
        const first = diagram.items[1];
        expect(first).toMatchObject({ type: 'message', from: 'user', to: 'itinder', arrow: 'sync', activate: true, text: 'Связать профиль\n{fsp_id}' });
        expect(diagram.items[2]).toMatchObject({ arrow: 'reply', deactivate: true });
        expect(diagram.items[3]).toMatchObject({ type: 'note', placement: 'over', targets: ['user', 'kc'], text: 'Логин; пароль' });
        expect(diagram.items[5]).toMatchObject({ arrow: 'async' });
        expect(diagram.items[7]).toMatchObject({ arrow: 'asyncDashed' });
    });

    it('создаёт участников из сообщений в порядке появления', () => {
        const { diagram } = parseMermaid('sequenceDiagram\nA->>B: hi\nC-xA: lost');
        expect(diagram.participants.map((p) => p.alias)).toEqual(['A', 'B', 'C']);
        expect(diagram.items[1]).toMatchObject({ from: 'C', to: 'A', arrow: 'lost' });
    });

    it('разделяет операторы точкой с запятой, но не сущности', () => {
        const { diagram, errors } = parseMermaid('sequenceDiagram; A->>B: a#59;b; B-->>A: ok');
        expect(errors).toEqual([]);
        expect(diagram.items.map((i) => (i.type === 'message' ? i.text : ''))).toEqual(['a;b', 'ok']);
    });

    it('сообщает об ошибках с номером строки', () => {
        const { errors } = parseMermaid('sequenceDiagram\nA->>B: hi\nчто-то непонятное\nloop x\nA->>B: y');
        expect(errors.map((e) => e.line)).toEqual([3, 5]);
    });

    it('отличает участника loop от ключевого слова', () => {
        const { diagram, errors } = parseMermaid('sequenceDiagram\nloop->>B: hi');
        expect(errors).toEqual([]);
        expect(diagram.items[0]).toMatchObject({ type: 'message', from: 'loop', to: 'B' });
    });

    it('box группирует участников', () => {
        const { diagram, errors } = parseMermaid('sequenceDiagram\nbox Aqua Сервер\nparticipant A\nparticipant B\nend\nA->>B: x');
        expect(errors).toEqual([]);
        expect(diagram.boxes).toEqual([{ color: 'Aqua', label: 'Сервер' }]);
        expect(diagram.participants.map((p) => p.box)).toEqual([0, 0]);
    });
});

describe('serializeMermaid', () => {
    it('сохраняет структуру при обратном разборе', () => {
        const first = parseMermaid(SAMPLE).diagram;
        const code = serializeMermaid(first);
        const second = parseMermaid(code);
        expect(second.errors).toEqual([]);
        const strip = (d: typeof first) => JSON.stringify(elementsOf(d).map((e) => ({ ...e, id: '' })));
        expect(strip(second.diagram)).toBe(strip(first));
        expect(serializeMermaid(second.diagram)).toBe(code);
    });

    it('не объявляет неявных участников без нужды', () => {
        const code = serializeMermaid(parseMermaid('sequenceDiagram\nA->>B: hi').diagram);
        expect(code).toBe('sequenceDiagram\n    A->>B: hi\n');
    });

    it('экранирует # и ;', () => {
        expect(encodeText('a;b#c\nd')).toBe('a#59;b#35;c<br/>d');
        expect(decodeText(encodeText('a;b#c\nd'))).toBe('a;b#c\nd');
    });
});

describe('id элементов', () => {
    it('переживают правку кода: вставку, переименование и удаление', () => {
        const loaded = loadDiagram({ code: 'sequenceDiagram\nA->>B: one\nB-->>A: two\nA->>B: three', ids: [] });
        const ids = elementsOf(loaded.diagram).map((e) => e.id);
        expect(ids).toEqual(['p1', 'p2', 'm1', 'm2', 'm3']);

        // Вставили сообщение в начало и поменяли текст второго.
        const edited = reparse('sequenceDiagram\nA->>B: zero\nA->>B: one\nB-->>A: TWO\nA->>B: three', loaded.diagram);
        const byText = Object.fromEntries(
            elementsOf(edited.diagram)
                .filter((e) => e.type === 'message')
                .map((e) => [e.type === 'message' ? e.text : '', e.id])
        );
        expect(byText).toEqual({ zero: 'm4', one: 'm1', TWO: 'm2', three: 'm3' });

        // Переименовали участника A → Client: id участника и сообщений сохраняются.
        const renamed = reparse('sequenceDiagram\nClient->>B: zero\nClient->>B: one\nB-->>Client: TWO', edited.diagram);
        expect(elementsOf(renamed.diagram).map((e) => e.id)).toEqual(['p1', 'p2', 'm4', 'm1', 'm2']);
    });

    it('sourceOf → loadDiagram сохраняет id по позиции', () => {
        const loaded = loadDiagram({ code: SAMPLE, ids: [] });
        const source = sourceOf(loaded.diagram);
        const again = loadDiagram(source);
        expect(elementsOf(again.diagram).map((e) => e.id)).toEqual(source.ids);
        expect(again.lineOf.get(source.ids[0])).toBeGreaterThan(0);
    });
});
