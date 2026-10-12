// Анимация: по проекту и раскладке считает, что видно в момент t эпизода.
// Всё детерминировано — один и тот же кадр получается в плеере, в превью
// редактора и при экспорте видео.
import { Layout, Rect, unionRects } from './layout';
import { CameraSpec, diagramAspect, estimateDuration, Project, Replica, VisibilityState } from './project';
import { Visual } from './scene';

export interface AudioSegment {
    asset: string;
    at: number; // с от начала эпизода
    offset: number; // с от начала файла
    duration: number;
}

export interface ReplicaTiming {
    start: number;
    end: number;
}

export interface EpisodeTiming {
    duration: number;
    replicas: ReplicaTiming[];
    audio: AudioSegment[];
}

export interface Timeline {
    episodes: EpisodeTiming[];
    total: number;
}

const FADE = 0.45; // с — исчезновение, приглушение, подсветка

export function computeTimeline(project: Project): Timeline {
    const s = project.settings;
    const episodes = project.episodes.map((episode): EpisodeTiming => {
        const replicas: ReplicaTiming[] = [];
        const audio: AudioSegment[] = [];
        if (episode.audio && episode.audio.duration > 0) {
            // Одна запись на эпизод: реплики — метки в ней. Без меток делим
            // запись пропорционально длине текста.
            const total = episode.audio.duration;
            const weights = episode.replicas.map((r) => Math.max(8, r.text.trim().length));
            const count = episode.replicas.length;
            const starts: (number | null)[] = episode.replicas.map((r, k) =>
                k === 0 ? 0 : r.cue === null || r.cue === undefined ? null : Math.max(0, Math.min(total, r.cue))
            );
            for (let a = 0; a < count; ) {
                let b = a + 1;
                while (b < count && starts[b] === null) b++;
                const end = b < count ? (starts[b] as number) : total;
                const sum = weights.slice(a, b).reduce((x, y) => x + y, 0);
                let acc = starts[a] as number;
                const span = end - acc;
                for (let k = a + 1; k < b; k++) {
                    acc += (span * weights[k - 1]) / sum;
                    starts[k] = acc;
                }
                a = b;
            }
            for (let k = 0; k < episode.replicas.length; k++) {
                const start = Math.max(k ? replicas[k - 1].start + 0.3 : 0, starts[k] ?? 0);
                replicas.push({ start, end: total });
                if (k) replicas[k - 1].end = start;
            }
            audio.push({ asset: episode.audio.asset, at: 0, offset: 0, duration: total });
        } else {
            let t = 0;
            for (const replica of episode.replicas) {
                let length: number;
                if (replica.duration && replica.duration > 0) length = replica.duration;
                else if (replica.audio && replica.audio.duration > 0) length = replica.audio.duration + 0.35;
                else length = estimateDuration(replica.text, s);
                if (replica.audio && replica.audio.duration > 0) {
                    audio.push({ asset: replica.audio.asset, at: t, offset: 0, duration: Math.min(replica.audio.duration, length) });
                }
                replicas.push({ start: t, end: t + length });
                t += length;
            }
        }
        const last = replicas.length ? replicas[replicas.length - 1].end : 0;
        return { duration: last + s.episodeTail, replicas, audio };
    });
    return { episodes, total: episodes.reduce((sum, e) => sum + e.duration, 0) };
}

// ---------------------------------------------------------------------------
// Состояния элементов по репликам.

export interface ReplicaState {
    before: Map<string, VisibilityState>; // до реплики (для первой реплики эпизода — конец прошлого эпизода)
    after: Map<string, VisibilityState>;
    highlight: Set<string>;
    highlightBefore: Set<string>;
}

// Начало эпизода: «приглушить» и «убрать» не трогают участников — это каркас схемы.
function enterEpisode(state: Map<string, VisibilityState>, start: Project['episodes'][number]['start'], participants: Set<string>): void {
    if (start === 'continue') return;
    for (const [id, value] of state) {
        if (participants.has(id)) continue;
        if (start === 'dim' && value === 'visible') state.set(id, 'dim');
        if (start === 'clear') state.set(id, 'hidden');
    }
}

export function computeStates(project: Project, ids: string[], participants: Set<string> = new Set()): ReplicaState[][] {
    const known = new Set(ids);
    let current = new Map<string, VisibilityState>(ids.map((id) => [id, 'hidden']));
    let lastHighlight = new Set<string>();
    return project.episodes.map((episode) =>
        episode.replicas.map((replica, index) => {
            const before = current;
            const next = new Map(current);
            if (index === 0) enterEpisode(next, episode.start, participants);
            for (const [id, state] of Object.entries(replica.set)) if (known.has(id)) next.set(id, state);
            const highlight = new Set(replica.highlight.filter((id) => known.has(id)));
            const result: ReplicaState = { before, after: next, highlight, highlightBefore: index === 0 ? new Set() : lastHighlight };
            current = next;
            lastHighlight = highlight;
            return result;
        })
    );
}

// Состояние, «унаследованное» репликой (до её собственных изменений) — для редактора.
export function inheritedState(
    states: ReplicaState[][],
    project: Project,
    episode: number,
    replica: number,
    participants: Set<string> = new Set()
): Map<string, VisibilityState> {
    const state = states[episode]?.[replica];
    if (!state) return new Map();
    const base = new Map(state.before);
    if (replica === 0) enterEpisode(base, project.episodes[episode].start, participants);
    return base;
}

// ---------------------------------------------------------------------------
// Кадр.

export interface Frame {
    episode: number;
    replica: number; // −1 — эпизод пуст
    local: number; // с от начала реплики
    camera: Rect;
    visualOf: (id: string) => Visual | null;
    text: string;
}

const LINE_TYPES = new Set(['message', 'divider']);
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

interface CameraKey {
    t: number; // с от начала эпизода
    rect: Rect;
}

export class Animator {
    readonly timeline: Timeline;
    readonly states: ReplicaState[][];
    readonly participants: Set<string>;
    private readonly reveals: Map<string, number>[][]; // время появления (с от начала реплики)
    private readonly cameraKeys: CameraKey[][];
    private readonly aspect: number;

    constructor(
        readonly project: Project,
        readonly layout: Layout
    ) {
        this.timeline = computeTimeline(project);
        this.participants = new Set(layout.participants.map((p) => p.id));
        this.states = computeStates(project, layout.order, this.participants);
        this.aspect = diagramAspect(project.settings);
        this.reveals = project.episodes.map((episode, e) => episode.replicas.map((replica, r) => this.revealTimes(e, r, replica)));
        this.cameraKeys = [];
        let last = this.startCamera();
        project.episodes.forEach((episode, e) => {
            const keys: CameraKey[] = [{ t: 0, rect: last }];
            episode.replicas.forEach((replica, r) => {
                for (const key of this.replicaCamera(e, r, replica, last)) {
                    keys.push(key);
                    last = key.rect;
                }
            });
            this.cameraKeys.push(keys);
        });
    }

    episodeCount(): number {
        return this.project.episodes.length;
    }

    duration(episode: number): number {
        return this.timeline.episodes[episode]?.duration ?? 0;
    }

    // Какая реплика идёт в момент t эпизода.
    replicaAt(episode: number, t: number): number {
        const timing = this.timeline.episodes[episode];
        if (!timing || !timing.replicas.length) return -1;
        for (let r = timing.replicas.length - 1; r >= 0; r--) if (t >= timing.replicas[r].start) return r;
        return 0;
    }

    frame(episode: number, t: number): Frame {
        const timing = this.timeline.episodes[episode];
        const r = this.replicaAt(episode, t);
        const camera = this.cameraAt(episode, t);
        if (!timing || r < 0) {
            const states = this.states[episode - 1];
            const end = states?.[states.length - 1]?.after;
            return { episode, replica: -1, local: 0, camera, text: '', visualOf: (id) => staticVisual(end?.get(id) ?? 'hidden', false) };
        }
        const replica = this.project.episodes[episode].replicas[r];
        const state = this.states[episode][r];
        const local = t - timing.replicas[r].start;
        const reveals = this.reveals[episode][r];
        const draw = this.project.settings.drawTime;
        const fade = clamp01(local / FADE);
        const visualOf = (id: string): Visual | null => {
            const before = state.before.get(id) ?? 'hidden';
            const after = state.after.get(id) ?? 'hidden';
            const hBefore = state.highlightBefore.has(id) ? 1 : 0;
            const hAfter = state.highlight.has(id) ? 1 : 0;
            const highlight = hBefore + (hAfter - hBefore) * fade;
            if (after === 'hidden') {
                if (before === 'hidden') return null;
                const opacity = 1 - fade;
                if (opacity <= 0) return null;
                return { opacity, progress: 1, dim: before === 'dim' ? 1 : 0, highlight: hBefore * (1 - fade) };
            }
            const dimAfter = after === 'dim' ? 1 : 0;
            if (before === 'hidden') {
                const at = reveals.get(id) ?? 0;
                const k = clamp01((local - at) / draw);
                if (k <= 0) return null;
                const line = LINE_TYPES.has(this.layout.geoms.get(id)?.type ?? '');
                return { opacity: line ? 1 : ease(k), progress: k, dim: dimAfter, highlight: hAfter };
            }
            const dimBefore = before === 'dim' ? 1 : 0;
            return { opacity: 1, progress: 1, dim: dimBefore + (dimAfter - dimBefore) * fade, highlight };
        };
        return { episode, replica: r, local, camera, visualOf, text: replica.text };
    }

    // Конечное состояние реплики — для редактора (без анимации).
    still(episode: number, replica: number): Frame {
        const timing = this.timeline.episodes[episode]?.replicas[replica];
        if (!timing) return this.frame(episode, 0);
        return this.frame(episode, Math.max(timing.start, timing.end - 0.0001));
    }

    // --- Появление элементов внутри реплики.
    private revealTimes(e: number, r: number, replica: Replica): Map<string, number> {
        const state = this.states[e][r];
        const timing = this.timeline.episodes[e].replicas[r];
        const length = timing.end - timing.start;
        const draw = this.project.settings.drawTime;
        const fresh = this.layout.order.filter((id) => (state.before.get(id) ?? 'hidden') === 'hidden' && (state.after.get(id) ?? 'hidden') !== 'hidden');
        const times = new Map<string, number>();
        const participants = fresh.filter((id) => this.layout.geoms.get(id)?.type === 'participant');
        const rest = fresh.filter((id) => this.layout.geoms.get(id)?.type !== 'participant');
        participants.forEach((id) => times.set(id, 0));
        const start = participants.length ? Math.min(0.35, length * 0.1) : 0;
        if (replica.reveal === 'together') {
            rest.forEach((id) => times.set(id, start + 0.1));
            return times;
        }
        const span = Math.max(0, length - draw - start - 0.15);
        const count = rest.length;
        rest.forEach((id, i) => {
            const share = count === 1 ? 0.03 : 0.03 + (0.82 * i) / (count - 1);
            times.set(id, start + Math.min(span, share * length));
        });
        return times;
    }

    // --- Камера.
    private pad(rect: Rect, padding: number): Rect {
        return { x: rect.x - padding, y: rect.y - padding, w: rect.w + 2 * padding, h: rect.h + 2 * padding };
    }

    // Расширяет прямоугольник до пропорций кадра вокруг центра.
    fitAspect(rect: Rect): Rect {
        const a = this.aspect;
        let { w, h } = rect;
        if (w / h > a) h = w / a;
        else w = h * a;
        return { x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2, w, h };
    }

    allCamera(): Rect {
        return this.fitAspect(this.layout.bounds);
    }

    // До первой реплики — верх диаграммы во всю ширину.
    startCamera(): Rect {
        const top = this.boundsOf(this.layout.participants.map((p) => p.id));
        return top ? this.autoCamera(top) : this.allCamera();
    }

    private boundsOf(ids: Iterable<string>): Rect | null {
        const rects: Rect[] = [];
        for (const id of ids) {
            const rect = this.layout.elementBounds.get(id);
            if (rect) rects.push(rect);
        }
        return unionRects(rects);
    }

    // Как в референсе: вся ширина схемы, по вертикали — следим за новыми
    // элементами; не помещаются — отъезжаем.
    autoCamera(focus: Rect): Rect {
        const full = this.layout.bounds;
        const w = full.w;
        const h = w / this.aspect;
        const pad = 36;
        const sticky = this.project.settings.stickyHeader;
        const headerBand = sticky ? this.layout.headerBottom - this.layout.headerTop + 26 : pad;
        if (h >= full.h) return { x: full.x, y: full.y + full.h / 2 - h / 2, w, h };
        if (focus.h + pad + headerBand <= h) {
            let y = Math.max(full.y, focus.y + focus.h + pad - h);
            if (y > full.y && focus.y - headerBand < y) y = focus.y - headerBand;
            y = Math.max(full.y, Math.min(y, full.y + full.h - h));
            return { x: full.x, y, w, h };
        }
        const zoomed = this.fitAspect(this.pad(focus, pad));
        return zoomed.w < w ? { ...zoomed, x: full.x + full.w / 2 - zoomed.w / 2, w: zoomed.w } : zoomed;
    }

    private fitCamera(ids: Iterable<string>, fallback: Rect): Rect {
        const rect = this.boundsOf(ids);
        if (!rect) return fallback;
        const padded = this.pad(rect, 40);
        const minW = Math.min(this.layout.bounds.w, 520);
        if (padded.w < minW) {
            padded.x -= (minW - padded.w) / 2;
            padded.w = minW;
        }
        return this.fitAspect(padded);
    }

    private replicaCamera(e: number, r: number, replica: Replica, previous: Rect): CameraKey[] {
        const timing = this.timeline.episodes[e].replicas[r];
        const state = this.states[e][r];
        const spec: CameraSpec = replica.camera ?? { mode: 'auto' };
        const at = timing.start;
        const fresh = this.layout.order.filter((id) => (state.before.get(id) ?? 'hidden') === 'hidden' && (state.after.get(id) ?? 'hidden') !== 'hidden');
        switch (spec.mode) {
            case 'keep':
                return [];
            case 'all':
                return [{ t: at, rect: this.allCamera() }];
            case 'manual':
                return [{ t: at, rect: this.fitAspect({ x: spec.x, y: spec.y, w: spec.w, h: spec.h }) }];
            case 'fit': {
                const ids = spec.ids.length ? spec.ids : [...fresh, ...state.highlight];
                return [{ t: at, rect: this.fitCamera(ids, previous) }];
            }
            case 'auto': {
                // С закреплённой шапкой участники видны всегда — за ними камера не ездит.
                const sticky = this.project.settings.stickyHeader;
                const focusable = (ids: string[]) => (sticky ? ids.filter((id) => !this.participants.has(id)) : ids);
                const highlight = focusable([...state.highlight]);
                const newcomers = fresh.filter((id) => !this.participants.has(id));
                if (!newcomers.length) {
                    const focus = this.boundsOf(highlight);
                    return focus ? [{ t: at, rect: this.autoCamera(focus) }] : [];
                }
                // Камера едет вслед за каждым новым элементом.
                const reveals = this.reveals[e][r];
                const keys: CameraKey[] = [];
                const seen: string[] = [...highlight];
                for (const id of newcomers) {
                    seen.push(id);
                    const focus = this.boundsOf(seen);
                    if (focus) keys.push({ t: at + (reveals.get(id) ?? 0), rect: this.autoCamera(focus) });
                }
                return keys;
            }
        }
    }

    cameraAt(episode: number, t: number): Rect {
        const keys = this.cameraKeys[episode];
        if (!keys || !keys.length) return this.allCamera();
        const T = this.project.settings.cameraTime;
        let from = keys[0].rect;
        let to = keys[0].rect;
        let since = -Infinity;
        for (const key of keys) {
            if (key.t > t) break;
            const current = lerpRect(from, to, ease((key.t - since) / T));
            from = current;
            to = key.rect;
            since = key.t;
        }
        return lerpRect(from, to, ease((t - since) / T));
    }
}

function staticVisual(state: VisibilityState, highlight: boolean): Visual | null {
    if (state === 'hidden') return null;
    return { opacity: 1, progress: 1, dim: state === 'dim' ? 1 : 0, highlight: highlight ? 1 : 0 };
}

export function lerpRect(a: Rect, b: Rect, k: number): Rect {
    if (k >= 1) return b;
    if (k <= 0) return a;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k };
}

// Прямоугольник камеры → преобразование в окно ширины W и высоты H (вписать).
export function viewTransform(camera: Rect, width: number, height: number): { scale: number; dx: number; dy: number } {
    const scale = Math.min(width / camera.w, height / camera.h);
    const dx = (width - camera.w * scale) / 2 - camera.x * scale;
    const dy = (height - camera.h * scale) / 2 - camera.y * scale;
    return { scale, dx, dy };
}
