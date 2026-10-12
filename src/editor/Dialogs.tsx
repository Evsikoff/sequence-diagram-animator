// Диалоги редактора: предпросмотр, нарезка сценария, экспорт видео,
// экспорт web-приложения (ZIP или сразу в GitHub).
import { zipSync } from 'fflate';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Layout } from '../core/layout';
import { Project } from '../core/project';
import { autoSplit, SplitOptions } from '../core/split';
import { publishToGitHub, GitHubResult } from '../export/github';
import { buildWebApp, ExportFile } from '../export/webapp';
import { Player, formatTime } from '../player/player';
import { download, fileSlug, readUrl } from './files';
import { store, useEditor } from './store';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
                <div className="modal-head">
                    <h2>{title}</h2>
                    <button className="close" onClick={onClose} aria-label="Закрыть">
                        ✕
                    </button>
                </div>
                <div className="modal-body">{children}</div>
            </div>
        </div>
    );
}

// --- Предпросмотр: тот же плеер, что попадёт в web-приложение.

export function PreviewModal({ project, episode, time, onClose }: { project: Project; episode: number; time: number; onClose: () => void }) {
    const host = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const player = new Player({ project, container: host.current!, episode, time, autoplay: true, onClose });
        return () => player.destroy();
        // Плеер создаётся на открытие окна.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <div className="preview-backdrop">
            <div className="preview-host" ref={host} />
        </div>
    );
}

// --- Нарезка диаграммы на эпизоды и реплики.

export function SplitDialog({ onClose }: { onClose: () => void }) {
    const diagram = useEditor((s) => s.diagram);
    const project = useEditor((s) => s.project);
    const [options, setOptions] = useState<SplitOptions>({ episodes: 'dividers', perReplica: 1, highlightNew: true });
    const dividers = diagram.items.filter((i) => i.type === 'divider').length;
    const preview = autoSplit(diagram, options);
    const hasText = project.episodes.some((e) => e.replicas.some((r) => r.text.trim()));
    const apply = () => {
        if (hasText && !confirm('Текущий сценарий (с текстами реплик) будет заменён. Продолжить?')) return;
        store().update((p) => ({ ...p, episodes: preview }));
        store().focus(0, 0);
        store().setMode('animation');
        onClose();
    };
    return (
        <Modal title="Разбить диаграмму на эпизоды и реплики" onClose={onClose}>
            <p className="muted">Заготовка сценария: каждая реплика показывает следующие элементы диаграммы. Тексты диктора, подсветку и камеру потом правите сами.</p>
            <label className="field">
                <span>Эпизоды</span>
                <select value={options.episodes} onChange={(e) => setOptions({ ...options, episodes: e.target.value as SplitOptions['episodes'] })}>
                    <option value="dividers">новый эпизод на каждом разделителе ({dividers})</option>
                    <option value="single">один эпизод</option>
                </select>
            </label>
            <label className="field">
                <span>Сообщений и заметок на реплику</span>
                <input type="number" min={1} max={20} value={options.perReplica} onChange={(e) => setOptions({ ...options, perReplica: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
            <label className="check">
                <input type="checkbox" checked={options.highlightNew} onChange={(e) => setOptions({ ...options, highlightNew: e.target.checked })} />
                Подсвечивать то, что появилось в реплике
            </label>
            <p>
                Получится эпизодов: <b>{preview.length}</b>, реплик: <b>{preview.reduce((n, e) => n + e.replicas.length, 0)}</b>.
            </p>
            <div className="modal-actions">
                <button onClick={onClose}>Отмена</button>
                <button className="primary" onClick={apply}>
                    Разбить
                </button>
            </div>
        </Modal>
    );
}

// --- Видео.

const SIZES = [
    { label: '1920 × 1080 (Full HD)', width: 1920, height: 1080 },
    { label: '1280 × 720 (HD)', width: 1280, height: 720 },
    { label: '3840 × 2160 (4K)', width: 3840, height: 2160 },
    { label: '1080 × 1920 (вертикальное)', width: 1080, height: 1920 },
    { label: '1080 × 1080 (квадрат)', width: 1080, height: 1080 },
];

export function VideoDialog({ layout, onClose }: { layout: Layout; onClose: () => void }) {
    const project = useEditor((s) => s.project);
    const current = useEditor((s) => s.episode);
    const [scope, setScope] = useState<'all' | 'current'>('all');
    const [size, setSize] = useState(() => Math.max(0, SIZES.findIndex((s) => s.width === project.settings.width && s.height === project.settings.height)));
    const [fps, setFps] = useState(project.settings.fps);
    const [subtitles, setSubtitles] = useState(project.settings.subtitles);
    const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
    const [progress, setProgress] = useState<{ share: number; label: string } | null>(null);
    const [result, setResult] = useState<{ url: string; name: string; info: string } | null>(null);
    const [error, setError] = useState('');
    const abort = useRef<AbortController | null>(null);
    const supported = typeof VideoEncoder !== 'undefined';

    useEffect(() => () => abort.current?.abort(), []);
    useEffect(() => () => {
        if (result) URL.revokeObjectURL(result.url);
    }, [result]);

    const start = async () => {
        setError('');
        setResult(null);
        const controller = new AbortController();
        abort.current = controller;
        const { width, height } = SIZES[size];
        const started = performance.now();
        try {
            const { renderVideo } = await import('../export/video');
            const video = await renderVideo(project, layout, {
                episodes: scope === 'all' ? project.episodes.map((_, i) => i) : [current],
                width,
                height,
                fps,
                subtitles,
                format,
                resolveAsset: (id) => project.assets[id]?.url ?? null,
                onProgress: (share, label) => setProgress({ share, label }),
                signal: controller.signal,
            });
            const name = `${fileSlug(project.title)}${scope === 'current' ? `-episode-${current + 1}` : ''}${video.extension}`;
            const seconds = ((performance.now() - started) / 1000).toFixed(0);
            setResult({ url: URL.createObjectURL(video.blob), name, info: `${formatTime(video.duration)}, ${(video.blob.size / 1048576).toFixed(1)} МБ, ${video.mime}; собрано за ${seconds} с` });
            download(video.blob, name);
            store().update((p) => ({ ...p, settings: { ...p.settings, width, height, fps, subtitles } }));
        } catch (e) {
            if ((e as Error).name !== 'AbortError') setError((e as Error).message);
        } finally {
            setProgress(null);
            abort.current = null;
        }
    };

    return (
        <Modal title="Экспорт в видео" onClose={onClose}>
            {!supported && <p className="error">Этот браузер не поддерживает WebCodecs — откройте редактор в Chrome, Edge или Safari 17+.</p>}
            <label className="field">
                <span>Что экспортировать</span>
                <select value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'current')}>
                    <option value="all">всю презентацию ({project.episodes.length} эп.)</option>
                    <option value="current">только эпизод {current + 1}</option>
                </select>
            </label>
            <div className="field-row">
                <label className="field">
                    <span>Размер кадра</span>
                    <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
                        {SIZES.map((s, i) => (
                            <option key={s.label} value={i}>
                                {s.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="field">
                    <span>Кадров в секунду</span>
                    <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                        {[24, 25, 30, 50, 60].map((f) => (
                            <option key={f}>{f}</option>
                        ))}
                    </select>
                </label>
                <label className="field">
                    <span>Формат</span>
                    <select value={format} onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm')}>
                        <option value="mp4">MP4 (если браузер умеет)</option>
                        <option value="webm">WebM</option>
                    </select>
                </label>
            </div>
            <label className="check">
                <input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} />
                Субтитры с текстом диктора внизу кадра
            </label>
            {progress && (
                <div className="progress">
                    <div className="progress-bar">
                        <div style={{ width: `${progress.share * 100}%` }} />
                    </div>
                    <span className="muted small">{progress.label}</span>
                </div>
            )}
            {error && <p className="error">{error}</p>}
            {result && (
                <div className="result">
                    <video src={result.url} controls />
                    <p>
                        Готово: <a href={result.url} download={result.name}>{result.name}</a> — {result.info}
                    </p>
                </div>
            )}
            <div className="modal-actions">
                {progress ? (
                    <button onClick={() => abort.current?.abort()}>Отменить</button>
                ) : (
                    <>
                        <button onClick={onClose}>Закрыть</button>
                        <button className="primary" disabled={!supported} onClick={start}>
                            Создать видео
                        </button>
                    </>
                )}
            </div>
        </Modal>
    );
}

// --- Web-приложение.

async function exportFiles(project: Project, branch: string): Promise<ExportFile[]> {
    return buildWebApp(project, {
        branch,
        readStatic: (path) => readUrl(new URL(path, document.baseURI).href),
        readAsset: (url) => readUrl(url),
    });
}

export function WebAppDialog({ onClose }: { onClose: () => void }) {
    const project = useEditor((s) => s.project);
    const [tab, setTab] = useState<'zip' | 'github'>('github');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [log, setLog] = useState<string[]>([]);
    const [result, setResult] = useState<GitHubResult | null>(null);
    const [form, setForm] = useState(() => ({
        token: sessionStorage.getItem('sda-github-token') ?? '',
        remember: Boolean(sessionStorage.getItem('sda-github-token')),
        owner: localStorage.getItem('sda-github-owner') ?? '',
        repo: fileSlug(project.title),
        branch: 'main',
        privateRepo: false,
        replace: true,
        message: `Анимированная диаграмма: ${project.title}`,
    }));

    const zip = async () => {
        setBusy(true);
        setError('');
        try {
            const files = await exportFiles(project, 'main');
            const root = fileSlug(project.title);
            const archive = zipSync(Object.fromEntries(files.map((f) => [`${root}/${f.path}`, typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data])));
            download(new Blob([archive], { type: 'application/zip' }), `${root}.zip`);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const publish = async () => {
        setBusy(true);
        setError('');
        setResult(null);
        setLog([]);
        if (form.remember) sessionStorage.setItem('sda-github-token', form.token);
        else sessionStorage.removeItem('sda-github-token');
        if (form.owner) localStorage.setItem('sda-github-owner', form.owner);
        try {
            const files = await exportFiles(project, form.branch);
            const done = await publishToGitHub(files, {
                token: form.token.trim(),
                owner: form.owner,
                repo: form.repo,
                branch: form.branch.trim() || 'main',
                createIfMissing: true,
                privateRepo: form.privateRepo,
                replace: form.replace,
                message: form.message,
                description: project.description || project.title,
                onProgress: (text) => setLog((lines) => [...lines.slice(-30), text]),
            });
            setResult(done);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal title="Экспорт в web-приложение" onClose={onClose}>
            <p className="muted">
                Статический сайт с плеером: эпизоды переключаются кнопками, списком и клавишами ← →. Внутри — код диаграммы (Mermaid), сценарий (project.json),
                плеер, шрифты и записи, а также workflow для GitHub Pages.
            </p>
            <div className="tabs">
                <button className={tab === 'github' ? 'on' : ''} onClick={() => setTab('github')}>
                    Опубликовать на GitHub
                </button>
                <button className={tab === 'zip' ? 'on' : ''} onClick={() => setTab('zip')}>
                    Скачать ZIP
                </button>
            </div>
            {tab === 'zip' ? (
                <>
                    <p>Архив можно распаковать и открыть index.html, положить на любой хостинг или запушить в репозиторий самостоятельно.</p>
                    <div className="modal-actions">
                        <button onClick={onClose}>Закрыть</button>
                        <button className="primary" disabled={busy} onClick={zip}>
                            {busy ? 'Собираем…' : 'Скачать ZIP'}
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <label className="field">
                        <span>
                            Токен GitHub (fine-grained: Contents, Pages, Workflows — Read and write; для нового репозитория — Administration). Токен уходит только в
                            api.github.com.
                        </span>
                        <input type="password" value={form.token} autoComplete="off" onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="github_pat_…" />
                    </label>
                    <label className="check">
                        <input type="checkbox" checked={form.remember} onChange={(e) => setForm({ ...form, remember: e.target.checked })} />
                        Помнить токен до закрытия вкладки
                    </label>
                    <div className="field-row">
                        <label className="field">
                            <span>Владелец (пусто — вы)</span>
                            <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} placeholder="login или организация" />
                        </label>
                        <label className="field">
                            <span>Репозиторий</span>
                            <input value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
                        </label>
                        <label className="field">
                            <span>Ветка</span>
                            <input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
                        </label>
                    </div>
                    <label className="field">
                        <span>Сообщение коммита</span>
                        <input value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
                    </label>
                    <label className="check">
                        <input type="checkbox" checked={form.privateRepo} onChange={(e) => setForm({ ...form, privateRepo: e.target.checked })} />
                        Создать приватный репозиторий, если его нет (Pages для приватных — на платных тарифах)
                    </label>
                    <label className="check">
                        <input type="checkbox" checked={form.replace} onChange={(e) => setForm({ ...form, replace: e.target.checked })} />
                        Заменить содержимое ветки (иначе файлы добавятся поверх существующих)
                    </label>
                    {log.length > 0 && <pre className="log">{log.join('\n')}</pre>}
                    {error && <p className="error">{error}</p>}
                    {result && (
                        <div className="result">
                            <p>
                                Опубликовано: <a href={result.repoUrl} target="_blank" rel="noreferrer">{result.repoUrl}</a> (<a href={result.commitUrl} target="_blank" rel="noreferrer">коммит</a>)
                            </p>
                            <p>
                                Сайт: <a href={result.pagesUrl} target="_blank" rel="noreferrer">{result.pagesUrl}</a> — появится через минуту-две. {result.pagesNote}
                            </p>
                            {result.workflowSkipped && <p className="muted small">У токена нет права на workflows, поэтому .github/workflows/pages.yml не загружен.</p>}
                        </div>
                    )}
                    <div className="modal-actions">
                        <button onClick={onClose}>Закрыть</button>
                        <button className="primary" disabled={busy || !form.token || !form.repo} onClick={publish}>
                            {busy ? 'Публикуем…' : 'Опубликовать'}
                        </button>
                    </div>
                </>
            )}
        </Modal>
    );
}
