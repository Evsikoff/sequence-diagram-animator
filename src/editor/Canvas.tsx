// Холст визуального редактора.
//   Режим «Диаграмма»: щелчок — выделить, двойной щелчок — править подпись,
//   перетаскивание плашки участника — порядок участников, перетаскивание
//   сообщения — порядок строк, инструмент «Стрелка» — протянуть сообщение от
//   линии жизни к линии жизни.
//   Режим «Анимация»: схема в состоянии конца выбранной реплики; скрытые
//   элементы — бледные. Инструменты: показать/скрыть, подсветить, приглушить,
//   кадр камеры (протянуть прямоугольник).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animator } from '../core/animate';
import { Diagram, DiagramElement, elementsOf, Item } from '../core/diagram';
import { insertMessage, moveItem, moveParticipant } from '../core/edit';
import { Layout, Rect } from '../core/layout';
import { VisibilityState } from '../core/project';
import { primsToSvg } from '../core/render';
import { buildScene, FULL, Visual } from '../core/scene';
import { inheritedState } from '../core/animate';
import { store, Tool, useEditor } from './store';

interface View {
    x: number; // мировая координата левого верхнего угла
    y: number;
    scale: number;
}

type Drag =
    | { kind: 'pan'; startX: number; startY: number; view: View; moved: boolean }
    | { kind: 'participant'; id: string; startX: number; x: number; moved: boolean }
    | { kind: 'item'; id: string; startY: number; y: number; moved: boolean }
    | { kind: 'connect'; from: string; x0: number; y0: number; x: number; y: number }
    | { kind: 'camera'; x0: number; y0: number; x: number; y: number }
    | { kind: 'click'; id: string; moved: boolean };

interface InlineEdit {
    id: string;
    value: string;
    rect: { left: number; top: number; width: number; height: number };
}

const GHOST: Visual = { opacity: 0.16, progress: 1, dim: 0, highlight: 0 };

// Верхняя граница каждой строки тела (и низ последней) — для вставки и переноса.
export function rowStops(diagram: Diagram, layout: Layout): number[] {
    const stops: (number | null)[] = [];
    const blocks: string[] = [];
    for (const item of diagram.items) {
        if ('id' in item && layout.geoms.has(item.id)) {
            const g = layout.geoms.get(item.id)!;
            stops.push('top' in g ? g.top : null);
            if (item.type === 'block') blocks.push(item.id);
        } else if (item.type === 'end') {
            const id = blocks.pop();
            const g = id ? layout.geoms.get(id) : undefined;
            stops.push(g && g.type === 'block' ? g.bottom - 4 : null);
        } else stops.push(null);
    }
    stops.push(layout.contentBottom);
    // Невидимые строки (activate, комментарии) — на уровне следующей видимой.
    for (let i = stops.length - 2; i >= 0; i--) if (stops[i] === null) stops[i] = stops[i + 1];
    return stops as number[];
}

function insertionIndex(stops: number[], y: number): number {
    for (let i = 0; i < stops.length - 1; i++) {
        const mid = (stops[i] + stops[i + 1]) / 2;
        if (y < mid) return i;
    }
    return stops.length - 1;
}

function editableText(element: DiagramElement): string | null {
    switch (element.type) {
        case 'participant':
            return element.description ? `${element.label}\n${element.description}` : element.label;
        case 'message':
        case 'note':
        case 'divider':
            return element.text;
        case 'block':
        case 'branch':
            return element.label;
    }
}

export function applyText(diagram: Diagram, id: string, value: string): void {
    const participant = diagram.participants.find((p) => p.id === id);
    if (participant) {
        const [label, ...rest] = value.split('\n');
        participant.label = label.trim() || participant.alias;
        participant.description = rest.join('\n').trim();
        participant.explicit = true;
        return;
    }
    const item = diagram.items.find((x) => 'id' in x && x.id === id) as Item | undefined;
    if (!item) return;
    if (item.type === 'message' || item.type === 'note') item.text = value.trim();
    else if (item.type === 'divider') item.text = value.replace(/\n/g, ' ').trim();
    else if (item.type === 'block' || item.type === 'branch') item.label = value.replace(/\n/g, ' ').trim();
}

interface Props {
    layout: Layout;
    animator: Animator | null;
    connectTool: boolean;
    onConnectDone: () => void;
    fitRequest: number;
}

export function Canvas({ layout, animator, connectTool, onConnectDone, fitRequest }: Props) {
    const diagram = useEditor((s) => s.diagram);
    const mode = useEditor((s) => s.mode);
    const tool = useEditor((s) => s.tool);
    const selection = useEditor((s) => s.selection);
    const episode = useEditor((s) => s.episode);
    const replica = useEditor((s) => s.replica);
    const project = useEditor((s) => s.project);

    const wrap = useRef<HTMLDivElement>(null);
    const svg = useRef<SVGSVGElement>(null);
    const [size, setSize] = useState({ width: 800, height: 600 });
    const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
    const [drag, setDrag] = useState<Drag | null>(null);
    const [hover, setHover] = useState<string | null>(null);
    const [edit, setEdit] = useState<InlineEdit | null>(null);
    const fitted = useRef(false);

    useEffect(() => {
        const element = wrap.current!;
        const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const fit = useCallback(
        (rect: Rect = layout.bounds) => {
            if (!size.width || !size.height) return;
            const s = Math.min(2, Math.min(size.width / rect.w, size.height / rect.h) * 0.94);
            setView({ x: rect.x + rect.w / 2 - size.width / s / 2, y: rect.y + rect.h / 2 - size.height / s / 2, scale: s });
        },
        [layout.bounds, size.width, size.height]
    );

    useEffect(() => {
        if (!fitted.current && size.width > 10) {
            fitted.current = true;
            // Длинную диаграмму вписываем по ширине и показываем сверху.
            const b = layout.bounds;
            const s = Math.min(1.3, (size.width / b.w) * 0.96);
            if (b.h * s > size.height) setView({ x: b.x + b.w / 2 - size.width / s / 2, y: b.y, scale: s });
            else fit();
        }
    }, [size, layout.bounds, fit]);

    useEffect(() => {
        if (fitRequest) fit();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fitRequest]);

    // Выделенный элемент (из кода, из списка, только что созданный) — в поле зрения.
    useEffect(() => {
        const b = selection ? layout.elementBounds.get(selection) : undefined;
        if (!b) return;
        setView((v) => {
            const w = size.width / v.scale;
            const h = size.height / v.scale;
            let { x, y } = v;
            if (b.x < v.x || b.x + b.w > v.x + w) x = b.w > w ? b.x - 20 : Math.min(Math.max(v.x, b.x + b.w + 30 - w), b.x - 30);
            if (b.y < v.y || b.y + b.h > v.y + h) y = b.h > h ? b.y - 20 : Math.min(Math.max(v.y, b.y + b.h + 40 - h), b.y - 40);
            return x === v.x && y === v.y ? v : { ...v, x, y };
        });
    }, [selection, layout, size.width, size.height]);

    const viewBox = { x: view.x, y: view.y, w: size.width / view.scale, h: size.height / view.scale };
    const toWorld = (clientX: number, clientY: number) => {
        const rect = svg.current!.getBoundingClientRect();
        return { x: view.x + (clientX - rect.left) / view.scale, y: view.y + (clientY - rect.top) / view.scale };
    };

    // --- Что рисуем.
    const timing = animator?.timeline.episodes[episode]?.replicas[replica];
    const frame = useMemo(() => (mode === 'animation' && animator && timing ? animator.still(episode, replica) : null), [mode, animator, episode, replica, timing]);
    const inherited = useMemo(
        () => (mode === 'animation' && animator ? inheritedState(animator.states, project, episode, replica, animator.participants) : null),
        [mode, animator, project, episode, replica]
    );
    const sceneSvg = useMemo(() => {
        const visualOf = frame ? (id: string) => frame.visualOf(id) ?? GHOST : () => FULL;
        return primsToSvg(buildScene(layout, visualOf, { hits: true }), layout.theme);
    }, [layout, frame]);

    const cameraRect = mode === 'animation' && animator && timing ? animator.cameraAt(episode, timing.end - 0.001) : null;
    const stops = useMemo(() => rowStops(diagram, layout), [diagram, layout]);
    const elements = useMemo(() => new Map(elementsOf(diagram).map((e) => [e.id, e])), [diagram]);

    // --- Анимационные инструменты.
    const applyTool = (id: string, active: Tool) => {
        const state = store().get();
        const anim = animator;
        if (!anim || !inherited) return;
        const r = state.project.episodes[state.episode]?.replicas[state.replica];
        if (!r) return;
        const base = inherited.get(id) ?? 'hidden';
        const current: VisibilityState = (r.set[id] as VisibilityState | undefined) ?? base;
        if (active === 'show') store().setElementState(state.episode, state.replica, id, current === 'hidden' ? 'visible' : current === 'dim' ? 'visible' : 'hidden', base);
        else if (active === 'dim') store().setElementState(state.episode, state.replica, id, current === 'dim' ? 'visible' : 'dim', base);
        else if (active === 'highlight') {
            if (current === 'hidden') store().setElementState(state.episode, state.replica, id, 'visible', base);
            store().toggleHighlight(state.episode, state.replica, id);
        }
        store().select(id);
    };

    // --- Указатель.
    const elementAt = (target: EventTarget | null): string | null => {
        const group = (target as Element | null)?.closest?.('[data-id]');
        const id = group?.getAttribute('data-id') ?? null;
        return id && elements.has(id) ? id : null;
    };
    const lifelineAt = (x: number, y: number): string | null => {
        let best: string | null = null;
        let distance = 18 / Math.min(1, view.scale);
        for (const p of layout.participants) {
            if (y < p.top || y > p.lifeBottom + 10) continue;
            const d = Math.abs(p.x - x);
            if (d < distance) {
                distance = d;
                best = p.id;
            }
        }
        return best;
    };

    const onPointerDown = (event: React.PointerEvent) => {
        if (event.button !== 0 && event.button !== 1) return;
        setEdit(null);
        svg.current!.setPointerCapture(event.pointerId);
        const world = toWorld(event.clientX, event.clientY);
        const id = elementAt(event.target);
        if (event.button === 1 || (event.shiftKey && !id)) {
            setDrag({ kind: 'pan', startX: event.clientX, startY: event.clientY, view, moved: false });
            return;
        }
        if (mode === 'diagram' && connectTool) {
            const from = lifelineAt(world.x, world.y);
            if (from) {
                setDrag({ kind: 'connect', from, x0: world.x, y0: world.y, x: world.x, y: world.y });
                return;
            }
        }
        if (mode === 'animation' && tool === 'camera') {
            setDrag({ kind: 'camera', x0: world.x, y0: world.y, x: world.x, y: world.y });
            return;
        }
        if (id) {
            const element = elements.get(id)!;
            if (mode === 'diagram' && element.type === 'participant') setDrag({ kind: 'participant', id, startX: world.x, x: world.x, moved: false });
            else if (mode === 'diagram') setDrag({ kind: 'item', id, startY: world.y, y: world.y, moved: false });
            else setDrag({ kind: 'click', id, moved: false });
            return;
        }
        setDrag({ kind: 'pan', startX: event.clientX, startY: event.clientY, view, moved: false });
    };

    const onPointerMove = (event: React.PointerEvent) => {
        if (!drag) {
            const id = elementAt(event.target);
            if (id !== hover) setHover(id);
            return;
        }
        const world = toWorld(event.clientX, event.clientY);
        switch (drag.kind) {
            case 'pan': {
                const dx = event.clientX - drag.startX;
                const dy = event.clientY - drag.startY;
                setView({ ...drag.view, x: drag.view.x - dx / drag.view.scale, y: drag.view.y - dy / drag.view.scale });
                if (Math.abs(dx) + Math.abs(dy) > 3 && !drag.moved) setDrag({ ...drag, moved: true });
                break;
            }
            case 'participant':
                setDrag({ ...drag, x: world.x, moved: drag.moved || Math.abs(world.x - drag.startX) > 6 });
                break;
            case 'item':
                setDrag({ ...drag, y: world.y, moved: drag.moved || Math.abs(world.y - drag.startY) > 6 });
                break;
            case 'connect':
            case 'camera':
                setDrag({ ...drag, x: world.x, y: world.y });
                break;
            case 'click':
                break;
        }
    };

    const onPointerUp = (event: React.PointerEvent) => {
        const current = drag;
        setDrag(null);
        if (!current) return;
        const world = toWorld(event.clientX, event.clientY);
        switch (current.kind) {
            case 'pan':
                if (!current.moved) store().select(null);
                break;
            case 'participant': {
                if (!current.moved) {
                    select(current.id);
                    break;
                }
                const others = layout.participants.filter((p) => p.id !== current.id);
                const index = others.filter((p) => p.x < world.x).length;
                store().editDiagram((d) => {
                    moveParticipant(d, current.id, index);
                    return current.id;
                });
                break;
            }
            case 'item': {
                if (!current.moved) {
                    select(current.id);
                    break;
                }
                const target = insertionIndex(stops, world.y);
                store().editDiagram((d) => {
                    moveItem(d, current.id, target);
                    return current.id;
                });
                break;
            }
            case 'connect': {
                const to = lifelineAt(world.x, world.y);
                const from = layout.participants.find((p) => p.id === current.from)!;
                const target = to ? layout.participants.find((p) => p.id === to)! : null;
                if (!target) break;
                if (target === from && Math.abs(world.y - current.y0) < 12) break;
                const at = insertionIndex(stops, current.y0);
                store().editDiagram((d) => insertMessage(d, from.alias, target.alias, at, target === from ? 'Действие' : 'Сообщение', 'sync'));
                onConnectDone();
                break;
            }
            case 'camera': {
                const x = Math.min(current.x0, world.x);
                const y = Math.min(current.y0, world.y);
                const w = Math.abs(world.x - current.x0);
                const h = Math.abs(world.y - current.y0);
                if (w < 30 || h < 20) break;
                const state = store().get();
                store().updateReplica(state.episode, state.replica, (r) => ({ ...r, camera: { mode: 'manual', x, y, w, h } }));
                break;
            }
            case 'click':
                if (mode === 'animation' && tool !== 'select') applyTool(current.id, tool);
                else select(current.id);
                break;
        }
    };

    const select = (id: string) => store().select(id);

    const onDoubleClick = (event: React.MouseEvent) => {
        if (mode !== 'diagram') return;
        // Указатель захвачен холстом — элемент ищем по координатам.
        const id = elementAt(document.elementFromPoint(event.clientX, event.clientY));
        if (!id) return;
        const element = elements.get(id)!;
        const value = editableText(element);
        if (value === null) return;
        const bounds = layout.elementBounds.get(id)!;
        const wrapRect = wrap.current!.getBoundingClientRect();
        const svgRect = svg.current!.getBoundingClientRect();
        const left = svgRect.left - wrapRect.left + (bounds.x - view.x) * view.scale;
        const top = svgRect.top - wrapRect.top + (bounds.y - view.y) * view.scale;
        setEdit({ id, value, rect: { left, top, width: Math.max(180, bounds.w * view.scale), height: Math.max(48, Math.min(160, bounds.h * view.scale)) } });
    };

    const commitEdit = () => {
        if (!edit) return;
        const { id, value } = edit;
        setEdit(null);
        store().editDiagram((d) => {
            applyText(d, id, value);
            return id;
        });
    };

    const onWheel = useCallback(
        (event: WheelEvent) => {
            event.preventDefault();
            const rect = svg.current!.getBoundingClientRect();
            setView((v) => {
                if (event.ctrlKey || event.metaKey) {
                    const factor = Math.exp(-event.deltaY * 0.0022);
                    const scale = Math.max(0.1, Math.min(4, v.scale * factor));
                    const wx = v.x + (event.clientX - rect.left) / v.scale;
                    const wy = v.y + (event.clientY - rect.top) / v.scale;
                    return { scale, x: wx - (event.clientX - rect.left) / scale, y: wy - (event.clientY - rect.top) / scale };
                }
                return { ...v, x: v.x + event.deltaX / v.scale, y: v.y + event.deltaY / v.scale };
            });
        },
        []
    );
    useEffect(() => {
        const element = svg.current!;
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => element.removeEventListener('wheel', onWheel);
    }, [onWheel]);

    const zoom = (factor: number) => {
        setView((v) => {
            const scale = Math.max(0.1, Math.min(4, v.scale * factor));
            const cx = v.x + size.width / v.scale / 2;
            const cy = v.y + size.height / v.scale / 2;
            return { scale, x: cx - size.width / scale / 2, y: cy - size.height / scale / 2 };
        });
    };

    // --- Наложение: выделение, подсказки перетаскивания, кадр камеры.
    const px = 1 / view.scale;
    const outline = (id: string | null, cls: string) => {
        const b = id ? layout.elementBounds.get(id) : null;
        if (!b) return null;
        return <rect className={cls} x={b.x - 5} y={b.y - 4} width={b.w + 10} height={b.h + 8} rx={4 * px} strokeWidth={1.6 * px} />;
    };
    let dragHint: React.ReactNode = null;
    if (drag?.kind === 'participant' && drag.moved) {
        const others = layout.participants.filter((p) => p.id !== drag.id);
        const index = others.filter((p) => p.x < drag.x).length;
        const left = others[index - 1];
        const right = others[index];
        const x = left && right ? (left.x + right.x) / 2 : left ? left.x + left.w / 2 + 20 : right ? right.x - right.w / 2 - 20 : drag.x;
        dragHint = <line className="drop-line" x1={x} x2={x} y1={layout.headerTop - 8} y2={layout.contentBottom} strokeWidth={3 * px} />;
    } else if (drag?.kind === 'item' && drag.moved) {
        const y = stops[insertionIndex(stops, drag.y)];
        dragHint = <line className="drop-line" x1={layout.bounds.x + 10} x2={layout.bounds.x + layout.bounds.w - 10} y1={y} y2={y} strokeWidth={3 * px} />;
    } else if (drag?.kind === 'connect') {
        const from = layout.participants.find((p) => p.id === drag.from)!;
        const to = lifelineAt(drag.x, drag.y);
        const target = to ? layout.participants.find((p) => p.id === to) : null;
        const x2 = target ? target.x : drag.x;
        dragHint = (
            <g className="connect-hint">
                <line x1={from.x} y1={drag.y0} x2={x2} y2={target && target !== from ? drag.y0 : drag.y} strokeWidth={2 * px} />
                <circle cx={from.x} cy={drag.y0} r={4 * px} />
            </g>
        );
    } else if (drag?.kind === 'camera') {
        dragHint = (
            <rect className="camera-draft" x={Math.min(drag.x0, drag.x)} y={Math.min(drag.y0, drag.y)} width={Math.abs(drag.x - drag.x0)} height={Math.abs(drag.y - drag.y0)} strokeWidth={2 * px} />
        );
    }

    const cursor =
        drag?.kind === 'pan' ? 'grabbing' : mode === 'diagram' && connectTool ? 'crosshair' : mode === 'animation' && tool === 'camera' ? 'crosshair' : mode === 'animation' && tool !== 'select' ? 'pointer' : 'default';

    return (
        <div className={`canvas-wrap mode-${mode}`} ref={wrap} style={{ background: layout.theme.colors.background }}>
            <svg
                ref={svg}
                className="canvas-svg"
                viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
                style={{ cursor }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={() => setHover(null)}
                onDoubleClick={onDoubleClick}
            >
                <g dangerouslySetInnerHTML={{ __html: sceneSvg }} />
                <g className="overlay" pointerEvents="none">
                    {hover !== selection && outline(hover, 'hover-outline')}
                    {outline(selection, 'selection-outline')}
                    {cameraRect && (
                        <g className="camera-frame">
                            <rect x={cameraRect.x} y={cameraRect.y} width={cameraRect.w} height={cameraRect.h} strokeWidth={2.5 * px} />
                            <text x={cameraRect.x + 8 * px} y={cameraRect.y + 18 * px} fontSize={13 * px}>
                                Кадр реплики {replica + 1}
                            </text>
                        </g>
                    )}
                    {dragHint}
                </g>
            </svg>
            {edit && (
                <textarea
                    className="inline-edit"
                    style={edit.rect}
                    autoFocus
                    value={edit.value}
                    onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            commitEdit();
                        } else if (e.key === 'Escape') setEdit(null);
                        e.stopPropagation();
                    }}
                />
            )}
            <div className="zoom-controls">
                <button onClick={() => zoom(1 / 1.2)} title="Отдалить">−</button>
                <button onClick={() => fit()} title="Вписать диаграмму">{Math.round(view.scale * 100)}%</button>
                <button onClick={() => zoom(1.2)} title="Приблизить">+</button>
                {cameraRect && (
                    <button onClick={() => fit(cameraRect)} title="Показать кадр реплики">
                        Кадр
                    </button>
                )}
            </div>
            {mode === 'diagram' && connectTool && <div className="canvas-hint">Протяните стрелку от линии жизни одного участника к другому (к той же линии — вызов самого себя)</div>}
            {mode === 'animation' && tool === 'camera' && <div className="canvas-hint">Протяните прямоугольник — это кадр камеры в выбранной реплике</div>}
        </div>
    );
}

