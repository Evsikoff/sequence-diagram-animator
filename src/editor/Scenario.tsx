// Сценарий: эпизоды → реплики. Для выбранной реплики — текст диктора,
// озвучка, длительность, камера и что из диаграммы показано/подсвечено.
import { useMemo, useRef, useState } from 'react';
import { Animator, inheritedState } from '../core/animate';
import { describe, Diagram, elementsOf, ELEMENT_KIND_TITLE } from '../core/diagram';
import { CameraSpec, Episode, estimateDuration, newEpisode, newReplica, Replica, VisibilityState } from '../core/project';
import { sentences } from '../core/split';
import { formatTime } from '../player/player';
import { audioAsset, Recorder } from './files';
import { store, useEditor } from './store';

const STATE_TITLES: Record<VisibilityState, string> = { hidden: 'Скрыт', visible: 'Показан', dim: 'Приглушён' };

function seconds(value: number): string {
    return `${value.toFixed(1)} с`;
}

interface Props {
    animator: Animator | null;
    onPreview: (episode: number, time: number) => void;
    onSplit: () => void;
}

export function Scenario({ animator, onPreview, onSplit }: Props) {
    const project = useEditor((s) => s.project);
    const episodeIndex = useEditor((s) => s.episode);
    const replicaIndex = useEditor((s) => s.replica);
    const episodes = project.episodes;
    const episode = episodes[episodeIndex];
    const replica = episode?.replicas[replicaIndex];

    const addEpisode = () => {
        store().update((p) => ({ ...p, episodes: [...p.episodes, newEpisode({ title: `Эпизод ${p.episodes.length + 1}` })] }));
        store().focus(episodes.length, 0);
    };
    const addReplica = (e: number, after: number) => {
        store().updateEpisode(e, (ep) => {
            const replicas = ep.replicas.slice();
            replicas.splice(after + 1, 0, newReplica());
            return { ...ep, replicas };
        });
        store().focus(e, after + 1);
    };

    return (
        <div className="scenario">
            <div className="panel-head">
                <h3>Сценарий</h3>
                <div className="spacer" />
                <button onClick={onSplit} title="Нарезать диаграмму на эпизоды и реплики">
                    Разбить…
                </button>
                <button onClick={addEpisode}>+ Эпизод</button>
            </div>
            <ol className="episode-list">
                {episodes.map((ep, e) => {
                    const timing = animator?.timeline.episodes[e];
                    return (
                        <li key={ep.id} className={e === episodeIndex ? 'current' : ''}>
                            <button className="episode-row" onClick={() => store().focus(e, e === episodeIndex ? replicaIndex : 0)}>
                                <span className="num">{e + 1}</span>
                                <span className="title">{ep.title || 'Без названия'}</span>
                                <span className="time">{timing ? formatTime(timing.duration) : ''}</span>
                            </button>
                            {e === episodeIndex && (
                                <ol className="replica-list">
                                    {ep.replicas.map((r, i) => (
                                        <li key={r.id}>
                                            <button className={`replica-row ${i === replicaIndex ? 'current' : ''}`} onClick={() => store().focus(e, i)}>
                                                <span className="num">{i + 1}</span>
                                                <span className="title">{r.text || <i>без текста</i>}</span>
                                                <span className="time">{timing?.replicas[i] ? seconds(timing.replicas[i].end - timing.replicas[i].start) : ''}</span>
                                            </button>
                                        </li>
                                    ))}
                                    <li>
                                        <button className="add-row" onClick={() => addReplica(e, ep.replicas.length - 1)}>
                                            + Реплика
                                        </button>
                                    </li>
                                </ol>
                            )}
                        </li>
                    );
                })}
            </ol>
            {episode && <EpisodePanel episode={episode} index={episodeIndex} animator={animator} onPreview={onPreview} />}
            {episode && replica && (
                <ReplicaPanel episode={episode} e={episodeIndex} replica={replica} r={replicaIndex} animator={animator} onPreview={onPreview} />
            )}
        </div>
    );
}

function EpisodePanel({ episode, index, animator, onPreview }: { episode: Episode; index: number; animator: Animator | null; onPreview: Props['onPreview'] }) {
    const count = useEditor((s) => s.project.episodes.length);
    const [busy, setBusy] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const update = (fn: (e: Episode) => Episode, group: string | null = null) => store().updateEpisode(index, fn, group);
    const move = (step: number) => {
        const target = index + step;
        if (target < 0 || target >= count) return;
        store().update((p) => {
            const episodes = p.episodes.slice();
            [episodes[index], episodes[target]] = [episodes[target], episodes[index]];
            return { ...p, episodes };
        });
        store().focus(target, 0);
    };
    const remove = () => {
        if (count <= 1) return store().notify('Последний эпизод удалить нельзя', 'error');
        if (!confirm(`Удалить эпизод «${episode.title}» со всеми репликами?`)) return;
        store().update((p) => ({ ...p, episodes: p.episodes.filter((_, i) => i !== index) }));
        store().focus(Math.max(0, index - 1), 0);
    };
    const upload = async (file: File) => {
        setBusy(true);
        try {
            const { id, asset, duration } = await audioAsset(file, file.name);
            store().update((p) => ({
                ...p,
                assets: { ...p.assets, [id]: asset },
                episodes: p.episodes.map((e, i) => (i === index ? { ...e, audio: { asset: id, duration } } : e)),
            }));
        } catch (error) {
            store().notify(`Не удалось прочитать запись: ${(error as Error).message}`, 'error');
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className="box">
            <div className="panel-head">
                <h4>Эпизод {index + 1}</h4>
                <div className="spacer" />
                <button onClick={() => move(-1)} disabled={index === 0} title="Выше">
                    ↑
                </button>
                <button onClick={() => move(1)} disabled={index === count - 1} title="Ниже">
                    ↓
                </button>
                <button onClick={() => onPreview(index, 0)} title="Смотреть эпизод">
                    ▶
                </button>
                <button className="danger" onClick={remove} title="Удалить эпизод">
                    ✕
                </button>
            </div>
            <label className="field">
                <span>Название</span>
                <input value={episode.title} onChange={(e) => update((ep) => ({ ...ep, title: e.target.value }), `ep-title:${episode.id}`)} />
            </label>
            <label className="field">
                <span>Что было показано в прошлых эпизодах</span>
                <select value={episode.start} onChange={(e) => update((ep) => ({ ...ep, start: e.target.value as Episode['start'] }))}>
                    <option value="dim">приглушить (как в референсе)</option>
                    <option value="continue">оставить как есть</option>
                    <option value="clear">убрать (участники остаются)</option>
                </select>
            </label>
            <div className="field">
                <span>Одна запись на весь эпизод (тогда реплики — метки в ней)</span>
                <div className="button-row">
                    {episode.audio ? (
                        <>
                            <span className="muted">запись: {seconds(episode.audio.duration)}</span>
                            <button
                                onClick={() => update((ep) => ({ ...ep, replicas: ep.replicas.map((r) => ({ ...r, cue: null })) }))}
                                title="Расставить начала реплик пропорционально длине текста"
                            >
                                Метки по тексту
                            </button>
                            <button className="danger" onClick={() => update((ep) => ({ ...ep, audio: null }))}>
                                Убрать
                            </button>
                        </>
                    ) : (
                        <button disabled={busy} onClick={() => fileInput.current?.click()}>
                            {busy ? 'Читаем…' : 'Загрузить запись эпизода'}
                        </button>
                    )}
                    <input ref={fileInput} type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                </div>
            </div>
            {animator && <p className="muted small">Длительность эпизода: {formatTime(animator.duration(index))}</p>}
        </section>
    );
}

function ReplicaPanel({ episode, e, replica, r, animator, onPreview }: { episode: Episode; e: number; replica: Replica; r: number; animator: Animator | null; onPreview: Props['onPreview'] }) {
    const diagram = useEditor((s) => s.diagram);
    const project = useEditor((s) => s.project);
    const selection = useEditor((s) => s.selection);
    const tool = useEditor((s) => s.tool);
    const [busy, setBusy] = useState<string | null>(null);
    const [recorder, setRecorder] = useState<Recorder | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const update = (fn: (x: Replica) => Replica, group: string | null = null) => store().updateReplica(e, r, fn, group);
    const timing = animator?.timeline.episodes[e]?.replicas[r];

    const attach = async (blob: Blob, name: string) => {
        setBusy('Читаем запись…');
        try {
            const { id, asset, duration } = await audioAsset(blob, name);
            store().update((p) => ({
                ...p,
                assets: { ...p.assets, [id]: asset },
                episodes: p.episodes.map((ep, i) => (i === e ? { ...ep, replicas: ep.replicas.map((x, k) => (k === r ? { ...x, audio: { asset: id, duration }, duration: null } : x)) } : ep)),
            }));
        } catch (error) {
            store().notify(`Не удалось прочитать запись: ${(error as Error).message}`, 'error');
        } finally {
            setBusy(null);
        }
    };
    const record = async () => {
        if (recorder) {
            const blob = await recorder.stop();
            setRecorder(null);
            if (blob.size) await attach(blob, `replica-${e + 1}-${r + 1}.webm`);
            return;
        }
        try {
            const next = new Recorder();
            await next.start();
            setRecorder(next);
        } catch (error) {
            store().notify(`Микрофон недоступен: ${(error as Error).message}`, 'error');
        }
    };
    const listen = () => {
        const asset = replica.audio ? project.assets[replica.audio.asset] : null;
        if (asset) void new Audio(asset.url).play();
        else if (episode.audio && timing) {
            const audio = new Audio(project.assets[episode.audio.asset]?.url);
            audio.currentTime = timing.start;
            void audio.play();
            setTimeout(() => audio.pause(), (timing.end - timing.start) * 1000);
        } else if ('speechSynthesis' in window && replica.text) {
            const utterance = new SpeechSynthesisUtterance(replica.text);
            utterance.lang = 'ru-RU';
            speechSynthesis.cancel();
            speechSynthesis.speak(utterance);
        }
    };

    const move = (step: number) => {
        const target = r + step;
        if (target < 0 || target >= episode.replicas.length) return;
        store().updateEpisode(e, (ep) => {
            const replicas = ep.replicas.slice();
            [replicas[r], replicas[target]] = [replicas[target], replicas[r]];
            return { ...ep, replicas };
        });
        store().focus(e, target);
    };
    const remove = () => {
        if (episode.replicas.length <= 1) return store().notify('В эпизоде должна остаться хотя бы одна реплика', 'error');
        store().updateEpisode(e, (ep) => ({ ...ep, replicas: ep.replicas.filter((_, i) => i !== r) }));
        store().focus(e, Math.max(0, r - 1));
    };
    // Длинная реплика → по реплике на предложение; изменения показа делятся между ними по порядку.
    const split = () => {
        const parts = sentences(replica.text);
        if (parts.length < 2) return store().notify('В тексте одно предложение — делить нечего');
        const order = animator?.layout.order ?? [];
        const changes = Object.entries(replica.set).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
        const per = Math.ceil(changes.length / parts.length);
        const pieces = parts.map((text, k) =>
            newReplica({
                ...replica,
                text,
                audio: k === 0 ? replica.audio : null,
                set: Object.fromEntries(changes.slice(k * per, (k + 1) * per)),
                highlight: replica.highlight,
                duration: null,
                cue: k === 0 ? replica.cue : null,
            })
        );
        store().updateEpisode(e, (ep) => {
            const replicas = ep.replicas.slice();
            replicas.splice(r, 1, ...pieces);
            return { ...ep, replicas };
        });
    };
    const duplicate = () => {
        store().updateEpisode(e, (ep) => {
            const replicas = ep.replicas.slice();
            replicas.splice(r + 1, 0, newReplica({ ...replica, set: {}, audio: null, cue: null }));
            return { ...ep, replicas };
        });
        store().focus(e, r + 1);
    };

    const setCamera = (camera: CameraSpec) => update((x) => ({ ...x, camera }));

    return (
        <section className="box">
            <div className="panel-head">
                <h4>
                    Реплика {r + 1} из {episode.replicas.length}
                </h4>
                <div className="spacer" />
                <button onClick={() => move(-1)} disabled={r === 0} title="Выше">
                    ↑
                </button>
                <button onClick={() => move(1)} disabled={r === episode.replicas.length - 1} title="Ниже">
                    ↓
                </button>
                <button onClick={() => timing && onPreview(e, timing.start)} title="Смотреть с этой реплики">
                    ▶
                </button>
                <button className="danger" onClick={remove} title="Удалить реплику">
                    ✕
                </button>
            </div>
            <label className="field">
                <span>Текст диктора (он же субтитр)</span>
                <textarea rows={4} value={replica.text} onChange={(ev) => update((x) => ({ ...x, text: ev.target.value }), `replica-text:${replica.id}`)} />
            </label>
            <div className="button-row">
                <button onClick={split} title="По реплике на каждое предложение">
                    Разделить по предложениям
                </button>
                <button onClick={duplicate}>Копия ниже</button>
            </div>

            <div className="field">
                <span>Озвучка</span>
                {episode.audio ? (
                    <div className="button-row">
                        <label className="inline">
                            начало в записи эпизода, с
                            <input
                                type="number"
                                step="0.1"
                                min="0"
                                disabled={r === 0}
                                value={r === 0 ? 0 : replica.cue ?? Number(timing?.start.toFixed(1) ?? 0)}
                                onChange={(ev) => update((x) => ({ ...x, cue: ev.target.value === '' ? null : Number(ev.target.value) }), `cue:${replica.id}`)}
                            />
                        </label>
                        <button onClick={listen}>▶ Слушать</button>
                        {replica.cue !== null && r > 0 && <button onClick={() => update((x) => ({ ...x, cue: null }))}>По тексту</button>}
                    </div>
                ) : (
                    <div className="button-row">
                        {replica.audio ? <span className="muted">запись: {seconds(replica.audio.duration)}</span> : <span className="muted">нет записи</span>}
                        <button disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>
                            Загрузить
                        </button>
                        <button className={recorder ? 'recording' : ''} disabled={Boolean(busy)} onClick={record}>
                            {recorder ? '■ Стоп' : '● Записать'}
                        </button>
                        <button onClick={listen} title={replica.audio ? 'Прослушать запись' : 'Прочитать синтезатором браузера'}>
                            ▶
                        </button>
                        {replica.audio && (
                            <button className="danger" onClick={() => update((x) => ({ ...x, audio: null }))}>
                                ✕
                            </button>
                        )}
                        <input ref={fileInput} type="file" accept="audio/*" hidden onChange={(ev) => ev.target.files?.[0] && attach(ev.target.files[0], ev.target.files[0].name)} />
                    </div>
                )}
                {busy && <span className="muted small">{busy}</span>}
            </div>

            {!episode.audio && (
                <div className="field-row">
                    <label className="field">
                        <span>Длительность, с</span>
                        <input
                            type="number"
                            min="0.5"
                            step="0.5"
                            placeholder={replica.audio ? `${replica.audio.duration.toFixed(1)} (по записи)` : `${estimateDuration(replica.text, project.settings).toFixed(1)} (по тексту)`}
                            value={replica.duration ?? ''}
                            onChange={(ev) => update((x) => ({ ...x, duration: ev.target.value === '' ? null : Math.max(0.5, Number(ev.target.value)) }), `dur:${replica.id}`)}
                        />
                    </label>
                    <label className="field">
                        <span>Новые элементы</span>
                        <select value={replica.reveal} onChange={(ev) => update((x) => ({ ...x, reveal: ev.target.value as Replica['reveal'] }))}>
                            <option value="stagger">по очереди</option>
                            <option value="together">разом</option>
                        </select>
                    </label>
                </div>
            )}

            <div className="field">
                <span>Камера</span>
                <div className="field-row">
                    <select
                        value={replica.camera.mode}
                        onChange={(ev) => {
                            const mode = ev.target.value as CameraSpec['mode'];
                            if (mode === 'manual') {
                                const rect = animator && timing ? animator.cameraAt(e, timing.end - 0.001) : { x: 0, y: 0, w: 800, h: 450 };
                                setCamera({ mode: 'manual', x: rect.x, y: rect.y, w: rect.w, h: rect.h });
                            } else if (mode === 'fit') setCamera({ mode: 'fit', ids: [] });
                            else setCamera({ mode } as CameraSpec);
                        }}
                    >
                        <option value="auto">следить за новым (авто)</option>
                        <option value="fit">вписать элементы</option>
                        <option value="manual">кадр вручную</option>
                        <option value="all">вся диаграмма</option>
                        <option value="keep">как в прошлой реплике</option>
                    </select>
                    <button className={tool === 'camera' ? 'active' : ''} onClick={() => store().setTool(tool === 'camera' ? 'select' : 'camera')} title="Нарисовать кадр на схеме">
                        ⬚ Рамкой
                    </button>
                </div>
                {replica.camera.mode === 'fit' && (
                    <div className="button-row">
                        <span className="muted small">
                            {replica.camera.ids.length ? `${replica.camera.ids.length} элем.` : 'новые и подсвеченные элементы реплики'}
                        </span>
                        <button disabled={!selection} onClick={() => selection && setCamera({ mode: 'fit', ids: [...new Set([...(replica.camera.mode === 'fit' ? replica.camera.ids : []), selection])] })}>
                            + Выделенный
                        </button>
                        {replica.camera.ids.length > 0 && <button onClick={() => setCamera({ mode: 'fit', ids: [] })}>Сбросить</button>}
                    </div>
                )}
            </div>

            <ElementStates diagram={diagram} animator={animator} e={e} r={r} replica={replica} />
        </section>
    );
}

function ElementStates({ diagram, animator, e, r, replica }: { diagram: Diagram; animator: Animator | null; e: number; r: number; replica: Replica }) {
    const project = useEditor((s) => s.project);
    const selection = useEditor((s) => s.selection);
    const [filter, setFilter] = useState<'all' | 'shown' | 'changed'>('all');
    const elements = useMemo(() => elementsOf(diagram), [diagram]);
    const inherited = useMemo(() => (animator ? inheritedState(animator.states, project, e, r, animator.participants) : new Map<string, VisibilityState>()), [animator, project, e, r]);
    const shownAnywhere = useMemo(() => {
        const ids = new Set<string>();
        for (const ep of project.episodes) for (const x of ep.replicas) for (const [id, state] of Object.entries(x.set)) if (state !== 'hidden') ids.add(id);
        return ids;
    }, [project.episodes]);

    const stateOf = (id: string): VisibilityState => (replica.set[id] as VisibilityState | undefined) ?? inherited.get(id) ?? 'hidden';
    const set = (id: string, state: VisibilityState) => store().setElementState(e, r, id, state, inherited.get(id) ?? 'hidden');
    const rows = elements.filter((el) => {
        if (filter === 'changed') return el.id in replica.set || replica.highlight.includes(el.id);
        if (filter === 'shown') return stateOf(el.id) !== 'hidden';
        return true;
    });
    const showNext = () => {
        const next = elements.find((el) => el.type !== 'participant' && stateOf(el.id) === 'hidden') ?? elements.find((el) => stateOf(el.id) === 'hidden');
        if (next) {
            set(next.id, 'visible');
            store().select(next.id);
        } else store().notify('Все элементы уже показаны');
    };
    // «Показать все» / «Приглушить все» (кроме участников) / «Скрыть все».
    const bulk = (target: VisibilityState) => {
        store().updateReplica(e, r, (x) => {
            const changes = { ...x.set };
            for (const el of elements) {
                const current = stateOf(el.id);
                const next = target === 'dim' ? (el.type === 'participant' || current === 'hidden' ? current : 'dim') : target;
                if (next === (inherited.get(el.id) ?? 'hidden')) delete changes[el.id];
                else changes[el.id] = next;
            }
            return { ...x, set: changes, highlight: target === 'hidden' ? [] : x.highlight };
        });
    };

    return (
        <div className="field element-states">
            <div className="panel-head">
                <span>Элементы в реплике</span>
                <div className="spacer" />
                <select value={filter} onChange={(ev) => setFilter(ev.target.value as typeof filter)}>
                    <option value="all">все</option>
                    <option value="shown">видимые</option>
                    <option value="changed">изменены здесь</option>
                </select>
            </div>
            <div className="button-row">
                <button onClick={showNext} title="Показать следующий по порядку скрытый элемент">
                    + Следующий элемент
                </button>
                <button onClick={() => bulk('visible')}>Показать все</button>
                <button onClick={() => bulk('dim')}>Приглушить все</button>
                <button onClick={() => bulk('hidden')}>Скрыть все</button>
            </div>
            <table className="states">
                <tbody>
                    {rows.map((el) => {
                        const state = stateOf(el.id);
                        const own = el.id in replica.set;
                        const highlighted = replica.highlight.includes(el.id);
                        return (
                            <tr key={el.id} className={`${el.id === selection ? 'selected' : ''} ${own ? 'own' : ''}`} onClick={() => store().select(el.id)}>
                                <td className="name" title={`${ELEMENT_KIND_TITLE[el.type]} ${el.id}${shownAnywhere.has(el.id) ? '' : ' — не показан ни в одной реплике'}`}>
                                    <span className={`kind kind-${el.type}`} />
                                    {describe(el, diagram)}
                                    {!shownAnywhere.has(el.id) && <span className="warn" title="Не показан ни в одной реплике">!</span>}
                                </td>
                                <td className="state">
                                    <div className="segmented">
                                        {(['hidden', 'visible', 'dim'] as VisibilityState[]).map((s) => (
                                            <button
                                                key={s}
                                                className={state === s ? 'on' : ''}
                                                title={STATE_TITLES[s]}
                                                onClick={(ev) => {
                                                    ev.stopPropagation();
                                                    set(el.id, s);
                                                }}
                                            >
                                                {s === 'hidden' ? '○' : s === 'visible' ? '●' : '◐'}
                                            </button>
                                        ))}
                                    </div>
                                </td>
                                <td>
                                    <button
                                        className={`star ${highlighted ? 'on' : ''}`}
                                        title="Подсветить в этой реплике"
                                        disabled={state === 'hidden'}
                                        onClick={(ev) => {
                                            ev.stopPropagation();
                                            store().toggleHighlight(e, r, el.id);
                                        }}
                                    >
                                        ★
                                    </button>
                                </td>
                                <td>
                                    {own && (
                                        <button
                                            className="reset"
                                            title="Вернуть унаследованное состояние"
                                            onClick={(ev) => {
                                                ev.stopPropagation();
                                                set(el.id, inherited.get(el.id) ?? 'hidden');
                                            }}
                                        >
                                            ↺
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <p className="muted small">● показан · ◐ приглушён · ○ скрыт · ★ подсвечен в этой реплике. Жирным — изменено в этой реплике, остальное унаследовано.</p>
        </div>
    );
}
