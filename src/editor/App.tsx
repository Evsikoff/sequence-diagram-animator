import { useEffect, useMemo, useRef, useState } from 'react';
import { Animator } from '../core/animate';
import { Diagram, elementsOf } from '../core/diagram';
import { addParticipant, indexOfItem, insertBlock, insertDivider, insertMessage, insertNote, removeItem, removeParticipant, shiftItem, wrapInBlock } from '../core/edit';
import { layoutDiagram } from '../core/layout';
import { canvasMeasure, loadFonts } from '../core/measure';
import { newProject, normalizeProject } from '../core/project';
import { themeById } from '../core/theme';
import { svgDocument } from '../core/render';
import { buildScene, FULL } from '../core/scene';
import { Canvas } from './Canvas';
import { CodeEditor } from './CodeEditor';
import { PreviewModal, SplitDialog, VideoDialog, WebAppDialog } from './Dialogs';
import { download, fileSlug, openFile, projectFile, saveCurrent } from './files';
import { Inspector } from './Inspector';
import { Scenario } from './Scenario';
import { store, Tool, useEditor } from './store';

export { STARTER } from '../core/starter';
import { STARTER } from '../core/starter';

type Dialog = null | 'split' | 'video' | 'webapp' | { preview: { episode: number; time: number } };

// Куда вставлять новый элемент: после выделенного (внутрь фрагмента — в начало).
function insertAt(diagram: Diagram, selection: string | null): number {
    if (!selection) return diagram.items.length;
    const index = indexOfItem(diagram, selection);
    return index < 0 ? diagram.items.length : index + 1;
}

export function App() {
    const project = useEditor((s) => s.project);
    const diagram = useEditor((s) => s.diagram);
    const mode = useEditor((s) => s.mode);
    const tool = useEditor((s) => s.tool);
    const selection = useEditor((s) => s.selection);
    const code = useEditor((s) => s.code);
    const codeVersion = useEditor((s) => s.codeVersion);
    const errors = useEditor((s) => s.errors);
    const lineOf = useEditor((s) => s.lineOf);
    const canUndo = useEditor((s) => s.canUndo);
    const canRedo = useEditor((s) => s.canRedo);
    const notice = useEditor((s) => s.notice);
    const episode = useEditor((s) => s.episode);
    const replica = useEditor((s) => s.replica);

    const [fonts, setFonts] = useState(false);
    const [dialog, setDialog] = useState<Dialog>(null);
    const [connect, setConnect] = useState(false);
    const [fitRequest, setFitRequest] = useState(0);
    const [menu, setMenu] = useState<null | 'file' | 'export'>(null);
    const [saved, setSaved] = useState<'saved' | 'saving' | 'example'>('saved');
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        void loadFonts().then(() => setFonts(true));
    }, []);

    const theme = themeById(project.settings.theme);
    const measure = useMemo(() => canvasMeasure(theme.font, theme.mono), [theme, fonts]);
    const layout = useMemo(() => layoutDiagram(diagram, theme, measure), [diagram, theme, measure]);
    const animator = useMemo(() => (project.episodes.length ? new Animator(project, layout) : null), [project, layout]);

    // Автосохранение в браузере. Нетронутый пример не сохраняем — при следующем
    // открытии он придёт с сервера свежим (с новыми записями и правками).
    useEffect(() => {
        if (store().isPristineExample(project)) {
            setSaved('example');
            return;
        }
        setSaved('saving');
        const timer = window.setTimeout(() => void saveCurrent(project).then(() => setSaved('saved')), 700);
        return () => window.clearTimeout(timer);
    }, [project]);

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => store().clearNotice(), notice.kind === 'error' ? 7000 : 3500);
        return () => window.clearTimeout(timer);
    }, [notice]);

    // Горячие клавиши (кроме полей ввода и редактора кода).
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            const typing = target.closest('input, textarea, select, .cm-editor, [contenteditable="true"]');
            const mod = event.ctrlKey || event.metaKey;
            if (mod && event.key.toLowerCase() === 'z' && !typing) {
                event.preventDefault();
                if (event.shiftKey) store().redo();
                else store().undo();
                return;
            }
            if (mod && event.key.toLowerCase() === 'y' && !typing) {
                event.preventDefault();
                store().redo();
                return;
            }
            if (mod && event.key.toLowerCase() === 's') {
                event.preventDefault();
                void saveProject();
                return;
            }
            if (typing || document.querySelector('.modal-backdrop, .preview-backdrop')) return;
            const state = store().get();
            if ((event.key === 'Delete' || event.key === 'Backspace') && state.selection && state.mode === 'diagram') {
                event.preventDefault();
                deleteSelected();
            } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && state.selection && state.mode === 'diagram') {
                event.preventDefault();
                const id = state.selection;
                store().editDiagram((d) => shiftItem(d, id, event.key === 'ArrowUp' ? -1 : 1));
            } else if (event.key === 'Escape') {
                store().select(null);
                setConnect(false);
                store().setTool('select');
            } else if (state.mode === 'animation' && !mod && !event.altKey) {
                const tools: Record<string, Tool> = { v: 'select', s: 'show', h: 'highlight', d: 'dim', c: 'camera' };
                const tool = tools[event.key.toLowerCase()];
                if (tool) store().setTool(tool);
                if (event.key === 'PageDown' || event.key === 'PageUp') {
                    event.preventDefault();
                    stepReplica(event.key === 'PageDown' ? 1 : -1);
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    const stepReplica = (step: number) => {
        const state = store().get();
        const episodes = state.project.episodes;
        let e = state.episode;
        let r = state.replica + step;
        if (r < 0 && e > 0) {
            e--;
            r = episodes[e].replicas.length - 1;
        } else if (r >= episodes[e].replicas.length && e < episodes.length - 1) {
            e++;
            r = 0;
        }
        store().focus(e, Math.max(0, Math.min(r, episodes[e].replicas.length - 1)));
    };

    const deleteSelected = () => {
        const id = store().get().selection;
        if (!id) return;
        store().editDiagram((d) => {
            if (d.participants.some((p) => p.id === id)) removeParticipant(d, id);
            else removeItem(d, id);
            return null;
        });
    };

    // --- Добавление элементов.
    const participantOf = (d: Diagram, id: string | null) => {
        const el = id ? elementsOf(d).find((e) => e.id === id) : undefined;
        if (!el) return null;
        if (el.type === 'participant') return el.alias;
        if (el.type === 'message') return el.from;
        if (el.type === 'note') return el.targets[0];
        return null;
    };
    const add = (what: 'participant' | 'message' | 'note' | 'block' | 'divider') => {
        const sel = store().get().selection;
        store().editDiagram((d) => {
            if (what === 'participant') {
                const after = d.participants.findIndex((p) => p.id === sel);
                return addParticipant(d, `Участник ${d.participants.length + 1}`, 'participant', after >= 0 ? after + 1 : d.participants.length).id;
            }
            while (d.participants.length < (what === 'message' ? 2 : 1)) addParticipant(d, `Участник ${d.participants.length + 1}`);
            const at = insertAt(d, sel);
            if (what === 'message') {
                const selected = sel ? elementsOf(d).find((e) => e.id === sel) : undefined;
                if (selected?.type === 'message') return insertMessage(d, selected.to, selected.from, at, 'Ответ', selected.arrow === 'sync' ? 'reply' : 'sync');
                const from = participantOf(d, sel) ?? d.participants[0].alias;
                const index = d.participants.findIndex((p) => p.alias === from);
                const to = (d.participants[index + 1] ?? d.participants[index - 1]).alias;
                return insertMessage(d, from, to, at);
            }
            if (what === 'note') return insertNote(d, [participantOf(d, sel) ?? d.participants[0].alias], at);
            if (what === 'divider') return insertDivider(d, at, 'Новый раздел');
            const selected = sel ? elementsOf(d).find((e) => e.id === sel) : undefined;
            if (selected && (selected.type === 'message' || selected.type === 'note')) return wrapInBlock(d, selected.id, 'alt', 'условие');
            return insertBlock(d, 'loop', 'повторять', at);
        });
        if (mode !== 'diagram') store().setMode('diagram');
    };

    // --- Файлы.
    const saveProject = async () => {
        const blob = await projectFile(store().get().project);
        download(blob, `${fileSlug(store().get().project.title)}.sda.json`);
    };
    const open = async (file: File) => {
        try {
            const opened = await openFile(file);
            store().load(opened, `Открыт файл ${file.name}`);
            setFitRequest((n) => n + 1);
        } catch (error) {
            store().notify(`Не удалось открыть ${file.name}: ${(error as Error).message}`, 'error');
        }
    };
    const openExample = async () => {
        try {
            const response = await fetch('examples/partner-link/project.json');
            store().load(normalizeProject(await response.json()), 'Открыт пример: связка профиля с партнёром', true);
            setFitRequest((n) => n + 1);
        } catch (error) {
            store().notify(`Пример не загрузился: ${(error as Error).message}`, 'error');
        }
    };
    const newDiagram = (template: string) => {
        if (!confirm('Создать новый проект? Текущий останется только в файле, если вы его сохранили.')) return;
        store().load(newProject(template, template ? 'Новая диаграмма' : 'Пустая диаграмма'));
        setFitRequest((n) => n + 1);
    };

    const preview = (e = episode, time?: number) => {
        const t = time ?? animator?.timeline.episodes[e]?.replicas[mode === 'animation' && e === episode ? replica : 0]?.start ?? 0;
        setDialog({ preview: { episode: e, time: t } });
    };

    const selectedLine = selection ? lineOf.get(selection) ?? null : null;
    const animationTools: [Tool, string, string][] = [
        ['select', 'Выбор', 'V'],
        ['show', 'Показать / скрыть', 'S'],
        ['highlight', 'Подсветить', 'H'],
        ['dim', 'Приглушить', 'D'],
        ['camera', 'Кадр камеры', 'C'],
    ];

    return (
        <div className="app" onClick={() => menu && setMenu(null)}>
            <header className="topbar">
                <div className="brand" title="Sequence Diagram Animator">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 3v18M12 3v18M19 3v18" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 2" />
                        <path d="M5 7h12m0 0-3-2.5M17 7l-3 2.5M19 13H7m0 0 3-2.5M7 13l3 2.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                    </svg>
                    <span>SDA</span>
                </div>
                <input
                    className="project-title"
                    value={project.title}
                    onChange={(e) => store().update((p) => ({ ...p, title: e.target.value }), 'project-title')}
                    aria-label="Название проекта"
                />
                <div className="menu-wrap" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setMenu(menu === 'file' ? null : 'file')}>Файл ▾</button>
                    {menu === 'file' && (
                        <div className="menu" onClick={() => setMenu(null)}>
                            <button onClick={() => newDiagram(STARTER)}>Новый проект (пример)</button>
                            <button onClick={() => newDiagram('sequenceDiagram\n')}>Новый пустой проект</button>
                            <button onClick={() => fileInput.current?.click()}>Открыть… (.json, .zip, .mmd)</button>
                            <button onClick={openExample}>Пример: связка профиля с партнёром</button>
                            <hr />
                            <button onClick={saveProject}>Сохранить проект (.sda.json) — Ctrl+S</button>
                            <button onClick={() => download(new Blob([project.diagram.code], { type: 'text/plain' }), `${fileSlug(project.title)}.mmd`)}>Скачать код Mermaid (.mmd)</button>
                            <button
                                onClick={() => {
                                    const b = layout.bounds;
                                    const svg = svgDocument(buildScene(layout, () => FULL), layout.theme, b, { width: Math.round(b.w), height: Math.round(b.h) });
                                    download(new Blob([svg], { type: 'image/svg+xml' }), `${fileSlug(project.title)}.svg`);
                                }}
                            >
                                Скачать картинку диаграммы (.svg)
                            </button>
                        </div>
                    )}
                </div>
                <input ref={fileInput} type="file" hidden accept=".json,.zip,.mmd,.mermaid,.txt" onChange={(e) => e.target.files?.[0] && open(e.target.files[0]).finally(() => (e.target.value = ''))} />
                <button onClick={() => store().undo()} disabled={!canUndo} title="Отменить (Ctrl+Z)">
                    ↶
                </button>
                <button onClick={() => store().redo()} disabled={!canRedo} title="Повторить (Ctrl+Shift+Z)">
                    ↷
                </button>
                <div className="mode-switch" role="tablist">
                    <button role="tab" aria-selected={mode === 'diagram'} className={mode === 'diagram' ? 'on' : ''} onClick={() => store().setMode('diagram')}>
                        Диаграмма
                    </button>
                    <button role="tab" aria-selected={mode === 'animation'} className={mode === 'animation' ? 'on' : ''} onClick={() => store().setMode('animation')}>
                        Анимация
                    </button>
                </div>
                <div className="spacer" />
                <span className="save-state muted small">{saved === 'saving' ? 'сохраняем…' : saved === 'example' ? 'пример: правки сохранятся в браузере' : 'сохранено в браузере'}</span>
                <button className="primary" onClick={() => preview()} disabled={!animator}>
                    ▶ Смотреть
                </button>
                <div className="menu-wrap" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setMenu(menu === 'export' ? null : 'export')}>Экспорт ▾</button>
                    {menu === 'export' && (
                        <div className="menu right" onClick={() => setMenu(null)}>
                            <button onClick={() => setDialog('video')}>Видео (MP4 / WebM)…</button>
                            <button onClick={() => setDialog('webapp')}>Web-приложение (GitHub / ZIP)…</button>
                        </div>
                    )}
                </div>
            </header>

            <main className="workspace">
                <aside className="pane left">
                    <div className="pane-head">
                        <h3>Код (Mermaid)</h3>
                        <span className={`badge ${errors.length ? 'bad' : 'good'}`}>{errors.length ? `ошибок: ${errors.length}` : 'без ошибок'}</span>
                    </div>
                    <CodeEditor
                        code={code}
                        version={codeVersion}
                        errors={errors}
                        selectedLine={selectedLine}
                        onChange={(text) => store().setCode(text)}
                        onCursorLine={(line) => {
                            const found = [...store().get().lineOf.entries()].find(([, l]) => l === line);
                            if (found) store().select(found[0]);
                        }}
                    />
                    {errors.length > 0 && (
                        <ul className="errors">
                            {errors.slice(0, 6).map((error, i) => (
                                <li key={i}>
                                    Строка {error.line}: {error.message}
                                </li>
                            ))}
                            <li className="muted small">Пока в коде есть ошибки, схема показывает последнюю корректную версию.</li>
                        </ul>
                    )}
                </aside>

                <section className="center">
                    <div className="toolbar">
                        {mode === 'diagram' ? (
                            <>
                                <button className={!connect ? 'on' : ''} onClick={() => setConnect(false)} title="Выбор и перетаскивание">
                                    ⬉ Выбор
                                </button>
                                <button className={connect ? 'on' : ''} onClick={() => setConnect(!connect)} title="Нарисовать сообщение между линиями жизни">
                                    ↗ Стрелка
                                </button>
                                <span className="sep" />
                                <button onClick={() => add('participant')}>+ Участник</button>
                                <button onClick={() => add('message')}>+ Сообщение</button>
                                <button onClick={() => add('note')}>+ Заметка</button>
                                <button onClick={() => add('block')} title="Обернуть выделенное сообщение во фрагмент alt, или добавить цикл">
                                    + Фрагмент
                                </button>
                                <button onClick={() => add('divider')} title="Разделитель — граница эпизода при нарезке">
                                    + Разделитель
                                </button>
                                <span className="sep" />
                                <button onClick={deleteSelected} disabled={!selection} className="danger">
                                    Удалить
                                </button>
                            </>
                        ) : (
                            <>
                                {animationTools.map(([id, title, key]) => (
                                    <button key={id} className={tool === id ? 'on' : ''} onClick={() => store().setTool(id)} title={`${title} (${key})`}>
                                        {title}
                                    </button>
                                ))}
                                <span className="sep" />
                                <button onClick={() => stepReplica(-1)} title="Предыдущая реплика (PageUp)">
                                    ◀
                                </button>
                                <span className="muted small replica-label">
                                    эп. {episode + 1} · реплика {replica + 1}
                                </span>
                                <button onClick={() => stepReplica(1)} title="Следующая реплика (PageDown)">
                                    ▶
                                </button>
                                <button onClick={() => preview(episode)} title="Смотреть с выбранной реплики">
                                    ▶ С реплики
                                </button>
                            </>
                        )}
                    </div>
                    <Canvas layout={layout} animator={mode === 'animation' ? animator : null} connectTool={connect} onConnectDone={() => setConnect(false)} fitRequest={fitRequest} />
                    {mode === 'animation' && animator && <ReplicaStrip animator={animator} />}
                </section>

                <aside className="pane right">{mode === 'diagram' ? <Inspector /> : <Scenario animator={animator} onPreview={(e, t) => preview(e, t)} onSplit={() => setDialog('split')} />}</aside>
            </main>

            {notice && <div className={`toast ${notice.kind}`}>{notice.text}</div>}
            {dialog === 'split' && <SplitDialog onClose={() => setDialog(null)} />}
            {dialog === 'video' && <VideoDialog layout={layout} onClose={() => setDialog(null)} />}
            {dialog === 'webapp' && <WebAppDialog onClose={() => setDialog(null)} />}
            {dialog && typeof dialog === 'object' && <PreviewModal project={project} episode={dialog.preview.episode} time={dialog.preview.time} onClose={() => setDialog(null)} />}
        </div>
    );
}

// Полоса реплик эпизода под холстом: ширина — длительность, щелчок — выбрать.
function ReplicaStrip({ animator }: { animator: Animator }) {
    const project = useEditor((s) => s.project);
    const episode = useEditor((s) => s.episode);
    const replica = useEditor((s) => s.replica);
    const timing = animator.timeline.episodes[episode];
    if (!timing) return null;
    const total = timing.duration || 1;
    return (
        <div className="replica-strip" title="Реплики эпизода: ширина — длительность">
            {timing.replicas.map((t, i) => (
                <button
                    key={project.episodes[episode].replicas[i]?.id ?? i}
                    className={i === replica ? 'on' : ''}
                    style={{ flexGrow: (t.end - t.start) / total }}
                    onClick={() => store().focus(episode, i)}
                >
                    <span>{i + 1}</span> {project.episodes[episode].replicas[i]?.text}
                </button>
            ))}
        </div>
    );
}
