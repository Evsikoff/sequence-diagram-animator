// Состояние редактора. Проект неизменяемый: каждая правка даёт новый объект,
// поэтому отмена — просто стек прошлых проектов.
import { useSyncExternalStore } from 'react';
import { Diagram } from '../core/diagram';
import { ParseError } from '../core/mermaid';
import { Episode, Project, Replica, VisibilityState } from '../core/project';
import { cloneDiagram, loadDiagram, reparse, sourceOf } from '../core/source';

export type Mode = 'diagram' | 'animation';
export type Tool = 'select' | 'show' | 'highlight' | 'dim' | 'camera';

export interface EditorState {
    project: Project;
    diagram: Diagram; // последняя корректная диаграмма с id
    lineOf: Map<string, number>;
    errors: ParseError[];
    code: string; // текст в редакторе кода (может быть с ошибками)
    codeVersion: number; // растёт, когда код поменяли не из редактора кода
    selection: string | null;
    mode: Mode;
    episode: number;
    replica: number;
    tool: Tool;
    canUndo: boolean;
    canRedo: boolean;
    notice: { text: string; kind: 'info' | 'error' } | null;
}

interface HistoryEntry {
    project: Project;
    group: string | null;
    at: number;
}

type Listener = () => void;

class Store {
    private state: EditorState;
    private readonly listeners = new Set<Listener>();
    private past: HistoryEntry[] = [];
    private future: HistoryEntry[] = [];
    private lastGroup: { group: string; at: number } | null = null;

    constructor(project: Project) {
        this.state = this.fresh(project);
    }

    private fresh(project: Project): EditorState {
        const loaded = loadDiagram(project.diagram);
        const source = loaded.errors.length ? project.diagram : { code: project.diagram.code, ids: sourceOf(loaded.diagram).ids };
        return {
            project: { ...project, diagram: { code: project.diagram.code, ids: source.ids } },
            diagram: loaded.diagram,
            lineOf: loaded.lineOf,
            errors: loaded.errors,
            code: project.diagram.code,
            codeVersion: 0,
            selection: null,
            mode: 'diagram',
            episode: 0,
            replica: 0,
            tool: 'select',
            canUndo: false,
            canRedo: false,
            notice: null,
        };
    }

    get = (): EditorState => this.state;

    subscribe = (listener: Listener): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    private set(patch: Partial<EditorState>): void {
        this.state = { ...this.state, ...patch };
        this.state.canUndo = this.past.length > 0;
        this.state.canRedo = this.future.length > 0;
        this.state.episode = Math.max(0, Math.min(this.state.episode, this.state.project.episodes.length - 1));
        const replicas = this.state.project.episodes[this.state.episode]?.replicas.length ?? 0;
        this.state.replica = Math.max(0, Math.min(this.state.replica, replicas - 1));
        this.listeners.forEach((listener) => listener());
    }

    // Запоминает текущий проект в истории перед правкой. Правки одной группы
    // подряд (набор текста) склеиваются в один шаг отмены.
    private remember(group: string | null): void {
        const now = Date.now();
        if (group && this.lastGroup && this.lastGroup.group === group && now - this.lastGroup.at < 1500) {
            this.lastGroup.at = now;
            return;
        }
        this.past.push({ project: this.state.project, group, at: now });
        if (this.past.length > 200) this.past.shift();
        this.future = [];
        this.lastGroup = group ? { group, at: now } : null;
    }

    // --- Проект целиком.

    load(project: Project, notice?: string): void {
        this.past = [];
        this.future = [];
        this.lastGroup = null;
        const fresh = this.fresh(project);
        this.state = { ...fresh, codeVersion: this.state.codeVersion + 1, mode: this.state.mode };
        this.set({ notice: notice ? { text: notice, kind: 'info' } : null });
    }

    update(fn: (project: Project) => Project, group: string | null = null): void {
        const next = fn(this.state.project);
        if (next === this.state.project) return;
        this.remember(group);
        this.set({ project: next });
    }

    // --- Диаграмма.

    setCode(code: string): void {
        if (code === this.state.code && !this.state.errors.length) return;
        const result = reparse(code, this.state.diagram);
        if (result.errors.length) {
            this.set({ code, errors: result.errors });
            return;
        }
        this.remember('code');
        const ids = sourceOf(result.diagram).ids;
        const selection = this.state.selection && result.lineOf.has(this.state.selection) ? this.state.selection : null;
        this.set({
            code,
            errors: [],
            diagram: result.diagram,
            lineOf: result.lineOf,
            selection,
            project: { ...this.state.project, diagram: { code, ids } },
        });
    }

    // Визуальная правка: fn меняет копию диаграммы и может вернуть id для выделения.
    editDiagram(fn: (diagram: Diagram) => string | null | void, group: string | null = null): void {
        const copy = cloneDiagram(this.state.diagram);
        const select = fn(copy);
        const source = sourceOf(copy);
        const loaded = loadDiagram(source);
        this.remember(group);
        this.set({
            code: source.code,
            codeVersion: this.state.codeVersion + 1,
            errors: loaded.errors,
            diagram: loaded.diagram,
            lineOf: loaded.lineOf,
            selection: select === undefined ? this.state.selection : select,
            project: { ...this.state.project, diagram: source },
        });
    }

    // --- Сценарий.

    updateEpisode(index: number, fn: (episode: Episode) => Episode, group: string | null = null): void {
        this.update((p) => ({ ...p, episodes: p.episodes.map((e, i) => (i === index ? fn(e) : e)) }), group);
    }

    updateReplica(episode: number, replica: number, fn: (replica: Replica) => Replica, group: string | null = null): void {
        this.updateEpisode(episode, (e) => ({ ...e, replicas: e.replicas.map((r, i) => (i === replica ? fn(r) : r)) }), group);
    }

    // Состояние элемента в реплике. inherited — каким он был бы без правки:
    // совпадает — правка убирается, реплика просто наследует.
    setElementState(episode: number, replica: number, id: string, state: VisibilityState, inherited: VisibilityState): void {
        this.updateReplica(episode, replica, (r) => {
            const set = { ...r.set };
            if (state === inherited) delete set[id];
            else set[id] = state;
            // Скрытый элемент не может быть подсвечен.
            const highlight = state === 'hidden' ? r.highlight.filter((h) => h !== id) : r.highlight;
            return { ...r, set, highlight };
        });
    }

    toggleHighlight(episode: number, replica: number, id: string): void {
        this.updateReplica(episode, replica, (r) => ({
            ...r,
            highlight: r.highlight.includes(id) ? r.highlight.filter((h) => h !== id) : [...r.highlight, id],
        }));
    }

    // --- Отмена.

    undo(): void {
        const entry = this.past.pop();
        if (!entry) return;
        this.future.push({ project: this.state.project, group: null, at: Date.now() });
        this.lastGroup = null;
        this.restore(entry.project);
    }

    redo(): void {
        const entry = this.future.pop();
        if (!entry) return;
        this.past.push({ project: this.state.project, group: null, at: Date.now() });
        this.lastGroup = null;
        this.restore(entry.project);
    }

    private restore(project: Project): void {
        const loaded = loadDiagram(project.diagram);
        this.set({
            project,
            diagram: loaded.diagram,
            lineOf: loaded.lineOf,
            errors: loaded.errors,
            code: project.diagram.code,
            codeVersion: this.state.codeVersion + 1,
            selection: this.state.selection && loaded.lineOf.has(this.state.selection) ? this.state.selection : null,
        });
    }

    // --- Интерфейс.

    select(id: string | null): void {
        if (id !== this.state.selection) this.set({ selection: id });
    }

    setMode(mode: Mode): void {
        this.set({ mode, tool: mode === 'diagram' ? 'select' : this.state.tool });
    }

    setTool(tool: Tool): void {
        this.set({ tool });
    }

    focus(episode: number, replica = 0): void {
        this.set({ episode, replica });
    }

    notify(text: string, kind: 'info' | 'error' = 'info'): void {
        this.set({ notice: { text, kind } });
    }

    clearNotice(): void {
        if (this.state.notice) this.set({ notice: null });
    }
}

let instance: Store | null = null;

export function createStore(project: Project): Store {
    instance = new Store(project);
    return instance;
}

export function store(): Store {
    if (!instance) throw new Error('Store is not created');
    return instance;
}

export function useEditor<T>(selector: (state: EditorState) => T): T {
    const s = store();
    return useSyncExternalStore(s.subscribe, () => selector(s.get()));
}

export type { Store };
