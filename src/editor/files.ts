// Файлы: автосохранение в браузере, открытие и сохранение проекта, записи.
import { strFromU8, unzipSync } from 'fflate';
import { importItinder, ItinderStory } from '../core/itinder';
import { Asset, newProject, normalizeProject, Project, uid } from '../core/project';
import { slugify } from '../export/webapp';

// --- Автосохранение (IndexedDB): проект с записями переживает перезагрузку.

const DB_NAME = 'sequence-diagram-animator';
const STORE = 'projects';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveCurrent(project: Project): Promise<void> {
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(project, 'current');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    } catch {
        // Хранилище недоступно (приватный режим) — работаем без автосохранения.
    }
}

export async function loadCurrent(): Promise<Project | null> {
    try {
        const db = await openDb();
        const value = await new Promise<unknown>((resolve, reject) => {
            const request = db.transaction(STORE, 'readonly').objectStore(STORE).get('current');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        db.close();
        return value ? normalizeProject(value) : null;
    } catch {
        return null;
    }
}

// --- Байты и data:-адреса.

export async function readUrl(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Не удалось прочитать ${url}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
}

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
}

export function bytesToDataUrl(bytes: Uint8Array, type: string): string {
    return `data:${type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

export function download(data: Blob, name: string): void {
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// Имя для скачиваемого файла: латиницей — не все браузеры принимают кириллицу в download.
export function fileSlug(title: string): string {
    return slugify(title, 'diagram');
}

// Проект одним файлом: записи встраиваются как data:-адреса.
export async function projectFile(project: Project): Promise<Blob> {
    const copy: Project = { ...project, assets: {} };
    for (const [id, asset] of Object.entries(project.assets)) {
        const url = asset.url.startsWith('data:') ? asset.url : bytesToDataUrl(await readUrl(asset.url), asset.type);
        copy.assets[id] = { ...asset, url };
    }
    return new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
}

// --- Открытие файлов: проект (.json), экспорт web-приложения (.zip),
// код Mermaid (.mmd, .txt), сценарий ITinder (scenes.json).

export async function openFile(file: File): Promise<Project> {
    const name = file.name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (name.endsWith('.zip')) return openZip(bytes);
    const text = new TextDecoder().decode(bytes);
    if (name.endsWith('.mmd') || name.endsWith('.mermaid') || name.endsWith('.txt') || /^\s*(%%|sequenceDiagram|---)/.test(text)) {
        return newProject(text, file.name.replace(/\.[^.]+$/, ''));
    }
    const data = JSON.parse(text) as Record<string, unknown>;
    if (Array.isArray(data.scenes) && Array.isArray(data.participants)) {
        return importItinder(data as unknown as ItinderStory, { title: file.name.replace(/\.[^.]+$/, '') });
    }
    return normalizeProject(data);
}

const MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', m4a: 'audio/mp4', aac: 'audio/aac' };

function openZip(bytes: Uint8Array): Project {
    const files = unzipSync(bytes);
    const entry = Object.keys(files)
        .filter((path) => path.endsWith('project.json'))
        .sort((a, b) => a.length - b.length)[0];
    if (!entry) throw new Error('В архиве нет project.json');
    const prefix = entry.slice(0, entry.length - 'project.json'.length);
    const project = normalizeProject(JSON.parse(strFromU8(files[entry])));
    const assets: Record<string, Asset> = {};
    for (const [id, asset] of Object.entries(project.assets)) {
        const data = files[prefix + asset.url];
        if (!data) {
            assets[id] = asset;
            continue;
        }
        const ext = asset.url.split('.').pop()?.toLowerCase() ?? '';
        const type = asset.type || MIME[ext] || 'application/octet-stream';
        assets[id] = { ...asset, type, url: bytesToDataUrl(data, type) };
    }
    return { ...project, assets };
}

// --- Записи диктора.

let context: AudioContext | null = null;

export async function audioDuration(bytes: ArrayBuffer): Promise<number> {
    context ??= new AudioContext();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    return Math.round(buffer.duration * 1000) / 1000;
}

export async function audioAsset(blob: Blob, name: string): Promise<{ id: string; asset: Asset; duration: number }> {
    const bytes = await blob.arrayBuffer();
    const duration = await audioDuration(bytes);
    const type = blob.type || MIME[name.split('.').pop()?.toLowerCase() ?? ''] || 'audio/mpeg';
    const url = bytesToDataUrl(new Uint8Array(bytes), type);
    return { id: uid('a'), asset: { name, type, url }, duration };
}

// Запись с микрофона.
export class Recorder {
    private recorder: MediaRecorder | null = null;
    private chunks: Blob[] = [];
    private stream: MediaStream | null = null;

    async start(): Promise<void> {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t));
        this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
        this.chunks = [];
        this.recorder.ondataavailable = (event) => {
            if (event.data.size) this.chunks.push(event.data);
        };
        this.recorder.start();
    }

    stop(): Promise<Blob> {
        return new Promise((resolve) => {
            const recorder = this.recorder;
            if (!recorder) return resolve(new Blob());
            recorder.onstop = () => {
                this.stream?.getTracks().forEach((track) => track.stop());
                resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
            };
            recorder.stop();
        });
    }
}
