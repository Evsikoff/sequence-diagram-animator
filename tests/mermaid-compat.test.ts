// @vitest-environment jsdom
// Код, который пишет редактор, должен разбираться настоящим Mermaid —
// тогда диаграмму можно вставить в README на GitHub, в GitLab, Notion и т. п.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { serializeMermaid } from '../src/core/mermaid';
import { loadDiagram } from '../src/core/source';
import { STARTER_CODE } from './fixtures';

type MermaidApi = { parse(text: string): Promise<unknown>; initialize(config: object): void };
let mermaid: MermaidApi;

beforeAll(async () => {
    mermaid = (await import('mermaid')).default as unknown as MermaidApi;
    mermaid.initialize({ startOnLoad: false });
});

const samples: Record<string, string> = {
    starter: STARTER_CODE,
    demo: JSON.parse(readFileSync('public/examples/partner-link/project.json', 'utf8')).diagram.code,
    everything: `sequenceDiagram
    title Все конструкции
    autonumber
    box Aqua Клиент
        actor u as Пользователь
        participant b as Браузер
    end
    participant s@{ "type" : "control" } as Сервис
    participant q@{ "type" : "queue" } as Очередь
    %% == Раздел ==
    u->>+b: Действие<br/>подробности
    b-)s: Событие
    s--)b: Асинхронный ответ
    s-xq: Потеряно
    s--xq: Потерянный ответ
    s->q: Линия
    s-->q: Пунктир
    b<<->>s: Туда-обратно
    b-->>-u: Готово#59; спасибо
    loop каждые 5 с
        b->>s: Опрос
        alt есть данные
            s-->>b: Данные
        else нет
            s-->>b: 204
        end
    end
    par одновременно
        b->>s: A
    and
        b->>q: B
    end
    critical соединение
        s->>q: Подключиться
    option таймаут
        s->>s: Повтор
    end
    rect rgb(230, 242, 255)
        Note over u,b: Подложка
    end
    Note left of u: Слева
    Note right of q: Справа
    activate s
    deactivate s
    create participant n as Новый
    s->>n: Создать
    destroy n
    s-xn: Удалить
`,
};

describe('совместимость с Mermaid', () => {
    it('проверка не пустая: Mermaid отвергает неверный код', async () => {
        await expect(mermaid.parse('sequenceDiagram\n    A->>: нет получателя')).rejects.toBeTruthy();
    });

    for (const [name, code] of Object.entries(samples)) {
        it(`${name}: наш код разбирается Mermaid и после пересборки`, async () => {
            await expect(mermaid.parse(code)).resolves.toBeTruthy();
            const { diagram, errors } = loadDiagram({ code, ids: [] });
            expect(errors).toEqual([]);
            await expect(mermaid.parse(serializeMermaid(diagram))).resolves.toBeTruthy();
        });
    }
});
