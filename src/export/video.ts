// Экспорт в видео прямо в браузере: кадры рисуются на канвасе тем же
// рендером, что и в плеере, кодируются WebCodecs (через mediabunny), речь
// диктора сводится в одну дорожку OfflineAudioContext'ом. MP4 (H.264/AAC),
// если браузер умеет, иначе WebM (VP9/Opus).
import {
    AudioBufferSource,
    AudioCodec,
    BufferTarget,
    CanvasSource,
    getFirstEncodableAudioCodec,
    getFirstEncodableVideoCodec,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
    QUALITY_MEDIUM,
    VideoCodec,
    WebMOutputFormat,
} from 'mediabunny';
import { Animator, viewTransform } from '../core/animate';
import { Layout, Rect } from '../core/layout';
import { Project, subtitleBand } from '../core/project';
import { drawPrims } from '../core/render';
import { buildScene } from '../core/scene';

export interface VideoOptions {
    episodes: number[]; // какие эпизоды и в каком порядке
    width: number;
    height: number;
    fps: number;
    subtitles: boolean;
    format: 'mp4' | 'webm';
    resolveAsset: (asset: string) => string | null;
    onProgress?: (share: number, label: string) => void;
    signal?: AbortSignal;
}

export interface VideoResult {
    blob: Blob;
    extension: string;
    mime: string;
    duration: number;
}

interface Piece {
    episode: number;
    start: number; // с от начала видео
    duration: number;
}

function check(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException('Экспорт отменён', 'AbortError');
}

// Сводит записи выбранных эпизодов в одну стереодорожку.
async function mixAudio(animator: Animator, pieces: Piece[], total: number, resolve: VideoOptions['resolveAsset'], signal?: AbortSignal): Promise<AudioBuffer | null> {
    const segments = pieces.flatMap((piece) => (animator.timeline.episodes[piece.episode]?.audio ?? []).map((s) => ({ ...s, at: piece.start + s.at })));
    if (!segments.length) return null;
    const rate = 48000;
    const context = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * rate)), rate);
    const decoded = new Map<string, AudioBuffer | null>();
    for (const segment of segments) {
        check(signal);
        if (!decoded.has(segment.asset)) {
            const url = resolve(segment.asset);
            let buffer: AudioBuffer | null = null;
            if (url) {
                try {
                    const bytes = await (await fetch(url)).arrayBuffer();
                    buffer = await context.decodeAudioData(bytes);
                } catch {
                    buffer = null; // битая или недоступная запись — пропускаем
                }
            }
            decoded.set(segment.asset, buffer);
        }
        const buffer = decoded.get(segment.asset);
        if (!buffer) continue;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start(segment.at, segment.offset, Math.min(segment.duration, buffer.duration - segment.offset));
    }
    return context.startRendering();
}

// Переносит текст по словам под ширину.
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
        let line = '';
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
            const candidate = line ? `${line} ${word}` : word;
            if (ctx.measureText(candidate).width <= width || !line) line = candidate;
            else {
                lines.push(line);
                line = word;
            }
        }
        if (line) lines.push(line);
    }
    return lines;
}

export function drawVideoFrame(
    ctx: CanvasRenderingContext2D,
    animator: Animator,
    layout: Layout,
    episode: number,
    time: number,
    options: { width: number; height: number; subtitles: boolean; titles: string[] }
): void {
    const { width, height } = options;
    const theme = layout.theme;
    const band = options.subtitles ? subtitleBand({ ...animator.project.settings, height, subtitles: true }) : 0;
    const frame = animator.frame(episode, time);
    const viewH = height - band;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.colors.background;
    ctx.fillRect(0, 0, width, height);

    // Камеру — под пропорции области диаграммы, чтобы закреплённая шапка шла во всю ширину.
    const aspect = width / viewH;
    const c = frame.camera;
    const w = Math.max(c.w, c.h * aspect);
    const h = Math.max(c.h, c.w / aspect);
    const camera: Rect = { x: c.x + c.w / 2 - w / 2, y: c.y + c.h / 2 - h / 2, w, h };
    const { scale, dx, dy } = viewTransform(camera, width, viewH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, viewH);
    ctx.clip();
    ctx.setTransform(scale, 0, 0, scale, dx, dy);
    drawPrims(ctx, buildScene(layout, frame.visualOf, { camera, stickyHeader: animator.project.settings.stickyHeader }), theme);
    ctx.restore();

    if (band) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = theme.colors.subtitleBg;
        ctx.fillRect(0, viewH, width, band);
        const pad = Math.round(width * 0.03);
        const size = Math.round(band * 0.2);
        const titleSize = Math.round(size * 0.78);
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        ctx.fillStyle = theme.colors.subtitleText;
        ctx.globalAlpha = 0.7;
        ctx.font = `600 ${titleSize}px ${theme.font}`;
        const title = options.titles[episode] ?? '';
        ctx.fillText(`${episode + 1}. ${title}`, pad, viewH + pad * 0.45 + titleSize);
        ctx.globalAlpha = 1;
        ctx.font = `400 ${size}px ${theme.font}`;
        const lines = wrap(ctx, frame.text, width - pad * 2).slice(0, 3);
        const lineH = size * 1.3;
        const top = viewH + pad * 0.45 + titleSize + lineH * 0.25;
        lines.forEach((line, i) => ctx.fillText(line, pad, top + lineH * (i + 1)));
    }
}

export async function renderVideo(project: Project, layout: Layout, options: VideoOptions): Promise<VideoResult> {
    const settings = { ...project.settings, width: options.width, height: options.height, fps: options.fps, subtitles: options.subtitles };
    const animator = new Animator({ ...project, settings }, layout);
    const pieces: Piece[] = [];
    let total = 0;
    for (const episode of options.episodes) {
        const duration = animator.duration(episode);
        if (duration <= 0) continue;
        pieces.push({ episode, start: total, duration });
        total += duration;
    }
    if (!pieces.length) throw new Error('Нечего экспортировать: в выбранных эпизодах нет реплик');
    const progress = options.onProgress ?? (() => {});

    progress(0, 'Сводим озвучку…');
    const audio = await mixAudio(animator, pieces, total, options.resolveAsset, options.signal);
    check(options.signal);

    // Формат и кодеки: что умеет этот браузер.
    const size = { width: options.width, height: options.height };
    let format: Mp4OutputFormat | WebMOutputFormat = new Mp4OutputFormat({ fastStart: 'in-memory' });
    let videoCodec: VideoCodec | null = null;
    let audioCodec: AudioCodec | null = null;
    if (options.format === 'mp4') {
        videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'hevc'], size);
        audioCodec = audio ? await getFirstEncodableAudioCodec(['aac', 'opus']) : null;
    }
    if (!videoCodec || (audio && !audioCodec)) {
        format = new WebMOutputFormat();
        videoCodec = await getFirstEncodableVideoCodec(['vp9', 'vp8', 'av1'], size);
        audioCodec = audio ? await getFirstEncodableAudioCodec(['opus', 'vorbis']) : null;
    }
    if (!videoCodec) throw new Error('Браузер не умеет кодировать видео (нужен WebCodecs: Chrome, Edge или Safari 17+)');

    const canvas = document.createElement('canvas');
    canvas.width = options.width;
    canvas.height = options.height;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const output = new Output({ format, target: new BufferTarget() });
    const video = new CanvasSource(canvas, { codec: videoCodec, quality: QUALITY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: options.fps });
    let audioSource: AudioBufferSource | null = null;
    if (audio && audioCodec) {
        audioSource = new AudioBufferSource({ codec: audioCodec, quality: QUALITY_MEDIUM });
        output.addAudioTrack(audioSource);
    }
    await output.start();

    const titles = project.episodes.map((e) => e.title);
    try {
        if (audioSource && audio) await audioSource.add(audio);
        const frames = Math.ceil(total * options.fps);
        const step = 1 / options.fps;
        let piece = 0;
        for (let i = 0; i < frames; i++) {
            check(options.signal);
            const t = i * step;
            while (piece < pieces.length - 1 && t >= pieces[piece].start + pieces[piece].duration) piece++;
            const current = pieces[piece];
            drawVideoFrame(ctx, animator, layout, current.episode, Math.min(t - current.start, current.duration), {
                width: options.width,
                height: options.height,
                subtitles: options.subtitles,
                titles,
            });
            await video.add(t, step);
            if (i % 15 === 0) progress(i / frames, `Кадр ${i + 1} из ${frames}`);
        }
        progress(1, 'Собираем файл…');
        await output.finalize();
    } catch (error) {
        await output.cancel().catch(() => {});
        throw error;
    }
    const buffer = (output.target as BufferTarget).buffer!;
    const mime = format.mimeType;
    return { blob: new Blob([buffer], { type: mime }), extension: format.fileExtension, mime, duration: total };
}
