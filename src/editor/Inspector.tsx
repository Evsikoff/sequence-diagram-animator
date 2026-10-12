// Свойства выделенного элемента (режим «Диаграмма»). Каждая правка идёт
// через store.editDiagram — код Mermaid пересобирается сразу.
import { ARROWS, ArrowType, BLOCK_KINDS, BlockKind, Diagram, DiagramElement, elementsOf, ELEMENT_KIND_TITLE, PARTICIPANT_KINDS, ParticipantKind } from '../core/diagram';
import { addBranch, insertMessage, insertNote, moveParticipant, removeItem, removeParticipant, renameAlias, shiftItem, uniqueAlias, wrapInBlock } from '../core/edit';
import { THEMES } from '../core/theme';
import { store, useEditor } from './store';

const KIND_TITLES: Record<ParticipantKind, string> = {
    participant: 'Участник (прямоугольник)',
    actor: 'Актёр (человечек)',
    boundary: 'Граница (boundary)',
    control: 'Управление (control)',
    entity: 'Сущность (entity)',
    database: 'База данных',
    collections: 'Коллекция',
    queue: 'Очередь',
};

const BLOCK_TITLES: Record<BlockKind, string> = {
    loop: 'loop — цикл',
    alt: 'alt — варианты',
    opt: 'opt — необязательно',
    par: 'par — параллельно',
    critical: 'critical — критическая секция',
    break: 'break — прерывание',
    rect: 'rect — цветная подложка',
};

function edit(fn: (d: Diagram) => string | null | void, group: string | null = null) {
    store().editDiagram(fn, group);
}

function findItem<T extends DiagramElement['type']>(d: Diagram, id: string, type: T) {
    return elementsOf(d).find((e) => e.id === id && e.type === type) as Extract<DiagramElement, { type: T }> | undefined;
}

export function Inspector() {
    const diagram = useEditor((s) => s.diagram);
    const selection = useEditor((s) => s.selection);
    const project = useEditor((s) => s.project);
    const lineOf = useEditor((s) => s.lineOf);
    const element = selection ? elementsOf(diagram).find((e) => e.id === selection) : undefined;
    const participants = diagram.participants;

    if (!element) {
        return (
            <div className="inspector">
                <h3>Диаграмма</h3>
                <label className="field">
                    <span>Заголовок</span>
                    <input value={diagram.title} onChange={(e) => edit((d) => void (d.title = e.target.value), 'title')} placeholder="Без заголовка" />
                </label>
                <label className="check">
                    <input type="checkbox" checked={diagram.autonumber} onChange={(e) => edit((d) => void (d.autonumber = e.target.checked))} />
                    Нумеровать сообщения (autonumber)
                </label>
                <label className="field">
                    <span>Тема оформления</span>
                    <select value={project.settings.theme} onChange={(e) => store().update((p) => ({ ...p, settings: { ...p.settings, theme: e.target.value } }))}>
                        {THEMES.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="hint-block">
                    <p>
                        <b>Визуально:</b> щёлкните элемент, чтобы выделить; двойной щелчок — правка подписи; плашку участника и сообщение можно перетаскивать. Инструмент
                        «Стрелка» рисует сообщение между линиями жизни. Delete — удалить, Alt+↑/↓ — сдвинуть строку.
                    </p>
                    <p>
                        <b>Кодом:</b> слева — код Mermaid. Правки в коде и на схеме синхронизируются. Разделитель эпизодов пишется комментарием <code>%% == Заголовок ==</code>.
                    </p>
                </div>
            </div>
        );
    }

    const title = ELEMENT_KIND_TITLE[element.type];
    const remove = () => {
        edit((d) => {
            if (element.type === 'participant') removeParticipant(d, element.id);
            else removeItem(d, element.id);
            return null;
        });
    };

    return (
        <div className="inspector">
            <h3>
                {title} <code className="element-id">{element.id}</code>
            </h3>
            {element.type === 'participant' && (
                <>
                    <label className="field">
                        <span>Подпись</span>
                        <input
                            value={element.label}
                            onChange={(e) =>
                                edit((d) => {
                                    const p = findItem(d, element.id, 'participant');
                                    if (p) {
                                        p.label = e.target.value;
                                        p.explicit = true;
                                    }
                                }, `label:${element.id}`)
                            }
                        />
                    </label>
                    <label className="field">
                        <span>Пояснение (вторая строка)</span>
                        <input
                            value={element.description}
                            placeholder="например, «браузер»"
                            onChange={(e) =>
                                edit((d) => {
                                    const p = findItem(d, element.id, 'participant');
                                    if (p) p.description = e.target.value;
                                }, `desc:${element.id}`)
                            }
                        />
                    </label>
                    <label className="field">
                        <span>Имя в коде</span>
                        <input
                            defaultValue={element.alias}
                            key={element.alias}
                            onBlur={(e) => {
                                const wanted = e.target.value.trim();
                                if (!wanted || wanted === element.alias) return;
                                edit((d) => renameAlias(d, element.alias, uniqueAlias(d, wanted)));
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        />
                    </label>
                    <label className="field">
                        <span>Вид</span>
                        <select
                            value={element.kind}
                            onChange={(e) =>
                                edit((d) => {
                                    const p = findItem(d, element.id, 'participant');
                                    if (p) {
                                        p.kind = e.target.value as ParticipantKind;
                                        p.explicit = true;
                                    }
                                })
                            }
                        >
                            {PARTICIPANT_KINDS.map((k) => (
                                <option key={k} value={k}>
                                    {KIND_TITLES[k]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className="button-row">
                        <button onClick={() => edit((d) => moveParticipant(d, element.id, participants.findIndex((p) => p.id === element.id) - 1))}>← Левее</button>
                        <button onClick={() => edit((d) => moveParticipant(d, element.id, participants.findIndex((p) => p.id === element.id) + 1))}>Правее →</button>
                    </div>
                    <div className="button-row">
                        <button
                            onClick={() =>
                                edit((d) => {
                                    const index = d.participants.findIndex((p) => p.id === element.id);
                                    const other = d.participants[index + 1] ?? d.participants[index - 1] ?? d.participants[index];
                                    return insertMessage(d, element.alias, other.alias, d.items.length);
                                })
                            }
                        >
                            + Сообщение отсюда
                        </button>
                        <button onClick={() => edit((d) => insertNote(d, [element.alias], d.items.length))}>+ Заметка</button>
                    </div>
                </>
            )}

            {element.type === 'message' && (
                <>
                    <div className="field-row">
                        <label className="field">
                            <span>От</span>
                            <select
                                value={element.from}
                                onChange={(e) =>
                                    edit((d) => {
                                        const m = findItem(d, element.id, 'message');
                                        if (m) m.from = e.target.value;
                                    })
                                }
                            >
                                {participants.map((p) => (
                                    <option key={p.id} value={p.alias}>
                                        {p.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button
                            className="swap"
                            title="Поменять направление"
                            onClick={() =>
                                edit((d) => {
                                    const m = findItem(d, element.id, 'message');
                                    if (m) [m.from, m.to] = [m.to, m.from];
                                })
                            }
                        >
                            ⇄
                        </button>
                        <label className="field">
                            <span>Кому</span>
                            <select
                                value={element.to}
                                onChange={(e) =>
                                    edit((d) => {
                                        const m = findItem(d, element.id, 'message');
                                        if (m) m.to = e.target.value;
                                    })
                                }
                            >
                                {participants.map((p) => (
                                    <option key={p.id} value={p.alias}>
                                        {p.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <label className="field">
                        <span>Вид стрелки</span>
                        <select
                            value={element.arrow}
                            onChange={(e) =>
                                edit((d) => {
                                    const m = findItem(d, element.id, 'message');
                                    if (m) m.arrow = e.target.value as ArrowType;
                                })
                            }
                        >
                            {(Object.keys(ARROWS) as ArrowType[]).map((a) => (
                                <option key={a} value={a}>
                                    {ARROWS[a].token} — {ARROWS[a].title}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span>Текст (первая строка — над стрелкой, остальные — детали под ней)</span>
                        <textarea
                            rows={3}
                            value={element.text}
                            onChange={(e) =>
                                edit((d) => {
                                    const m = findItem(d, element.id, 'message');
                                    if (m) m.text = e.target.value;
                                }, `text:${element.id}`)
                            }
                        />
                    </label>
                    <label className="check">
                        <input
                            type="checkbox"
                            checked={element.activate}
                            onChange={(e) =>
                                edit((d) => {
                                    const m = findItem(d, element.id, 'message');
                                    if (m) {
                                        m.activate = e.target.checked;
                                        if (m.activate) m.deactivate = false;
                                    }
                                })
                            }
                        />
                        Активировать получателя (+)
                    </label>
                    <label className="check">
                        <input
                            type="checkbox"
                            checked={element.deactivate}
                            onChange={(e) =>
                                edit((d) => {
                                    const m = findItem(d, element.id, 'message');
                                    if (m) {
                                        m.deactivate = e.target.checked;
                                        if (m.deactivate) m.activate = false;
                                    }
                                })
                            }
                        />
                        Завершить активацию отправителя (−)
                    </label>
                </>
            )}

            {element.type === 'note' && (
                <>
                    <div className="field-row">
                        <label className="field">
                            <span>Где</span>
                            <select
                                value={element.placement}
                                onChange={(e) =>
                                    edit((d) => {
                                        const n = findItem(d, element.id, 'note');
                                        if (n) {
                                            n.placement = e.target.value as 'left' | 'right' | 'over';
                                            if (n.placement !== 'over') n.targets = n.targets.slice(0, 1);
                                        }
                                    })
                                }
                            >
                                <option value="over">над</option>
                                <option value="left">слева от</option>
                                <option value="right">справа от</option>
                            </select>
                        </label>
                        <label className="field">
                            <span>Участник</span>
                            <select
                                value={element.targets[0]}
                                onChange={(e) =>
                                    edit((d) => {
                                        const n = findItem(d, element.id, 'note');
                                        if (n) n.targets = [e.target.value, ...n.targets.slice(1)];
                                    })
                                }
                            >
                                {participants.map((p) => (
                                    <option key={p.id} value={p.alias}>
                                        {p.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {element.placement === 'over' && (
                            <label className="field">
                                <span>…до</span>
                                <select
                                    value={element.targets[1] ?? ''}
                                    onChange={(e) =>
                                        edit((d) => {
                                            const n = findItem(d, element.id, 'note');
                                            if (n) n.targets = e.target.value ? [n.targets[0], e.target.value] : [n.targets[0]];
                                        })
                                    }
                                >
                                    <option value="">—</option>
                                    {participants
                                        .filter((p) => p.alias !== element.targets[0])
                                        .map((p) => (
                                            <option key={p.id} value={p.alias}>
                                                {p.label}
                                            </option>
                                        ))}
                                </select>
                            </label>
                        )}
                    </div>
                    <label className="field">
                        <span>Текст</span>
                        <textarea
                            rows={3}
                            value={element.text}
                            onChange={(e) =>
                                edit((d) => {
                                    const n = findItem(d, element.id, 'note');
                                    if (n) n.text = e.target.value;
                                }, `text:${element.id}`)
                            }
                        />
                    </label>
                </>
            )}

            {element.type === 'block' && (
                <>
                    <label className="field">
                        <span>Вид фрагмента</span>
                        <select
                            value={element.kind}
                            onChange={(e) =>
                                edit((d) => {
                                    const b = findItem(d, element.id, 'block');
                                    if (b) b.kind = e.target.value as BlockKind;
                                })
                            }
                        >
                            {BLOCK_KINDS.map((k) => (
                                <option key={k} value={k}>
                                    {BLOCK_TITLES[k]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span>{element.kind === 'rect' ? 'Цвет подложки (например, rgb(230, 245, 255))' : 'Условие'}</span>
                        <input
                            value={element.label}
                            onChange={(e) =>
                                edit((d) => {
                                    const b = findItem(d, element.id, 'block');
                                    if (b) b.label = e.target.value;
                                }, `label:${element.id}`)
                            }
                        />
                    </label>
                    {element.kind !== 'rect' && (
                        <button onClick={() => edit((d) => addBranch(d, element.id, 'иначе'))}>+ Ветка ({element.kind === 'par' ? 'and' : element.kind === 'critical' ? 'option' : 'else'})</button>
                    )}
                </>
            )}

            {element.type === 'branch' && (
                <label className="field">
                    <span>Условие ветки ({element.word})</span>
                    <input
                        value={element.label}
                        onChange={(e) =>
                            edit((d) => {
                                const b = findItem(d, element.id, 'branch');
                                if (b) b.label = e.target.value;
                            }, `label:${element.id}`)
                        }
                    />
                </label>
            )}

            {element.type === 'divider' && (
                <label className="field">
                    <span>Текст разделителя</span>
                    <input
                        value={element.text}
                        onChange={(e) =>
                            edit((d) => {
                                const x = findItem(d, element.id, 'divider');
                                if (x) x.text = e.target.value;
                            }, `text:${element.id}`)
                        }
                    />
                </label>
            )}

            {element.type !== 'participant' && (
                <div className="button-row">
                    <button onClick={() => edit((d) => shiftItem(d, element.id, -1))} title="Alt+↑">
                        ↑ Выше
                    </button>
                    <button onClick={() => edit((d) => shiftItem(d, element.id, 1))} title="Alt+↓">
                        ↓ Ниже
                    </button>
                </div>
            )}
            {(element.type === 'message' || element.type === 'note') && (
                <div className="button-row">
                    <select
                        value=""
                        onChange={(e) => {
                            const kind = e.target.value as BlockKind;
                            if (kind) edit((d) => wrapInBlock(d, element.id, kind, kind === 'rect' ? 'rgb(230, 242, 255)' : 'условие'));
                        }}
                    >
                        <option value="">Обернуть во фрагмент…</option>
                        {BLOCK_KINDS.map((k) => (
                            <option key={k} value={k}>
                                {BLOCK_TITLES[k]}
                            </option>
                        ))}
                    </select>
                </div>
            )}
            <div className="button-row">
                <button className="danger" onClick={remove}>
                    {element.type === 'block' ? 'Убрать рамку фрагмента' : 'Удалить'}
                </button>
            </div>
            {element.type === 'block' && <p className="muted small">Содержимое фрагмента при удалении рамки остаётся на месте.</p>}
            <p className="muted small">Строка кода: {lineOf.get(element.id) ?? '—'}</p>
        </div>
    );
}
