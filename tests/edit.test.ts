import { describe, expect, it } from 'vitest';
import { elementsOf } from '../src/core/diagram';
import { addBranch, addParticipant, insertMessage, moveItem, moveParticipant, removeItem, removeParticipant, renameAlias, shiftItem, translitAlias, wrapInBlock } from '../src/core/edit';
import { parseMermaid, serializeMermaid } from '../src/core/mermaid';
import { loadDiagram, sourceOf } from '../src/core/source';

const load = (code: string) => loadDiagram({ code, ids: [] }).diagram;
const texts = (code: string) =>
    parseMermaid(code)
        .diagram.items.map((i) => (i.type === 'message' ? i.text : i.type))
        .join(',');

describe('визуальные правки', () => {
    it('добавляет участника и сообщение — код и id согласованы', () => {
        const d = load('sequenceDiagram\nA->>B: one\n');
        const p = addParticipant(d, 'Реестр ФСП', 'database');
        expect(p.alias).toBe('reestr_fsp');
        const m = insertMessage(d, 'A', p.alias, 1, 'GET /results');
        const source = sourceOf(d);
        expect(source.code).toContain('participant reestr_fsp@{ "type" : "database" } as Реестр ФСП');
        expect(source.code).toContain('A->>reestr_fsp: GET /results');
        const again = loadDiagram(source).diagram;
        expect(elementsOf(again).map((e) => e.id)).toEqual(source.ids);
        expect(source.ids).toContain(m);
    });

    it('переименование имени участника обновляет сообщения', () => {
        const d = load('sequenceDiagram\nA->>B: one\nNote over A,B: n\nactivate A\n');
        renameAlias(d, 'A', 'Client');
        expect(serializeMermaid(d)).toBe('sequenceDiagram\n    Client->>B: one\n    Note over Client,B: n\n    activate Client\n');
    });

    it('удаление участника убирает его сообщения', () => {
        const d = load('sequenceDiagram\nA->>B: one\nB->>C: two\nNote over B,C: n\n');
        removeParticipant(d, d.participants[2].id);
        expect(texts(serializeMermaid(d))).toBe('one,note');
    });

    it('порядок участников и сообщений', () => {
        const d = load('sequenceDiagram\nA->>B: one\nB->>A: two\nA->>B: three\n');
        moveParticipant(d, d.participants[1].id, 0);
        const code = serializeMermaid(d);
        expect(parseMermaid(code).diagram.participants.map((p) => p.alias)).toEqual(['B', 'A']);
        const third = (d.items[2] as { id: string }).id;
        moveItem(d, third, 0);
        expect(texts(serializeMermaid(d))).toBe('three,one,two');
        shiftItem(d, third, 1);
        expect(texts(serializeMermaid(d))).toBe('one,three,two');
    });

    it('фрагмент вокруг сообщения, ветка и удаление рамки', () => {
        const d = load('sequenceDiagram\nA->>B: one\nB->>A: two\n');
        const first = (d.items[0] as { id: string }).id;
        const block = wrapInBlock(d, first, 'alt', 'успех')!;
        addBranch(d, block, 'ошибка');
        expect(serializeMermaid(d)).toBe('sequenceDiagram\n    alt успех\n        A->>B: one\n    else ошибка\n    end\n    B->>A: two\n');
        // Фрагмент переносится целиком.
        shiftItem(d, block, 1);
        expect(texts(serializeMermaid(d))).toBe('two,block,one,branch,end');
        removeItem(d, block);
        expect(texts(serializeMermaid(d))).toBe('two,one');
    });

    it('translitAlias', () => {
        expect(translitAlias('ФСП ID')).toBe('fsp_id');
        expect(translitAlias('1С')).toBe('p_1s');
    });
});
