// Нарезка диаграммы на эпизоды и реплики: заготовка сценария, которую потом
// правят руками.
import { Diagram, elementsOf } from './diagram';
import { Episode, newEpisode, newReplica, Replica } from './project';

export interface SplitOptions {
    episodes: 'dividers' | 'single'; // новый эпизод на каждом разделителе или один эпизод
    perReplica: number; // сколько сообщений/заметок показывать за реплику
    highlightNew: boolean; // подсвечивать то, что появилось в реплике
}

// Разбивает текст диктора на предложения.
export function sentences(text: string): string[] {
    const parts = text
        .replace(/\s+/g, ' ')
        .trim()
        .match(/[^.!?…]+(?:[.!?…]+["»”)]*|$)/g);
    return (parts ?? []).map((p) => p.trim()).filter(Boolean);
}

export function autoSplit(diagram: Diagram, options: SplitOptions): Episode[] {
    const elements = elementsOf(diagram);
    const participants = elements.filter((e) => e.type === 'participant');
    const body = elements.filter((e) => e.type !== 'participant');
    const episodes: Episode[] = [];
    let episode: Episode | null = null;
    let pending: string[] = []; // фрагменты/ветки — появляются вместе со следующим сообщением
    let batch: string[] = [];

    const startEpisode = (title: string) => {
        episode = newEpisode({ title, start: episodes.length ? 'dim' : 'continue', replicas: [] });
        episodes.push(episode);
    };
    const flush = () => {
        if (!batch.length && !pending.length) return;
        if (!episode) startEpisode('Эпизод 1');
        const ids = [...pending, ...batch];
        const replica: Replica = newReplica({
            set: Object.fromEntries(ids.map((id) => [id, 'visible' as const])),
            highlight: options.highlightNew ? batch.slice() : [],
        });
        episode!.replicas.push(replica);
        pending = [];
        batch = [];
    };

    for (const element of body) {
        if (element.type === 'divider' && options.episodes === 'dividers') {
            flush();
            // «1. Вход» → «Вход»: номер эпизода плеер и видео ставят сами.
            startEpisode(element.text.replace(/^\s*\d+[.)]\s*/, '') || `Эпизод ${episodes.length + 1}`);
            pending.push(element.id);
            continue;
        }
        if (element.type === 'block' || element.type === 'branch' || element.type === 'divider') {
            pending.push(element.id);
            continue;
        }
        batch.push(element.id);
        if (batch.length >= Math.max(1, options.perReplica)) flush();
    }
    flush();

    if (!episodes.length) startEpisode('Эпизод 1');
    const first = episodes[0];
    if (!first.replicas.length) first.replicas.push(newReplica());
    // Участники видны с первой реплики.
    for (const p of participants) first.replicas[0].set[p.id] = 'visible';
    episodes.forEach((e, i) => {
        if (!e.title) e.title = `Эпизод ${i + 1}`;
        if (!e.replicas.length) e.replicas.push(newReplica());
    });
    return episodes;
}
