// Импорт презентации в формате референса ITinder
// (app/assets/presentation/fsp_link/scenes.json): участники, сцены с текстом
// диктора, записью и сообщениями. Сцена становится эпизодом, а её текст
// делится на реплики по предложениям; сообщения раскладываются по репликам
// в том же темпе, в каком их рисовал референс (FspSequence.tsx).
import { elementsOf } from './diagram';
import { encodeText } from './mermaid';
import { Asset, DEFAULT_SETTINGS, Episode, newEpisode, newReplica, Project } from './project';
import { loadDiagram, sourceOf } from './source';
import { sentences } from './split';

export interface ItinderArrow {
    from: string;
    to: string;
    kind: 'call' | 'reply' | 'event';
    label: string;
    detail?: string;
    at?: number;
}

export interface ItinderNote {
    note: string;
    over: string[];
}

export interface ItinderStory {
    participants: { id: string; name: string; note?: string }[];
    scenes: {
        number: number;
        title: string;
        speaker_text: string;
        audio?: { name: string; url: string };
        messages: (ItinderArrow | ItinderNote)[];
    }[];
}

export interface ItinderImportOptions {
    title?: string;
    // Запись сцены: ключ ассета и длительность, если файл есть.
    audio?: (scene: ItinderStory['scenes'][number]) => { asset: string; duration: number; data?: Asset } | null;
    splitSentences?: boolean;
}

const KIND_ARROW = { call: '->>', reply: '-->>', event: '-)' } as const;

function isNote(message: ItinderArrow | ItinderNote): message is ItinderNote {
    return 'note' in message;
}

function alias(id: string): string {
    return /^[A-Za-z_][\w]*$/.test(id) ? id : id.replace(/\W+/g, '_');
}

export function storyToMermaid(story: ItinderStory): string {
    const lines = ['sequenceDiagram'];
    for (const p of story.participants) {
        const label = p.note ? `${p.name}\n${p.note}` : p.name;
        lines.push(`    participant ${alias(p.id)} as ${encodeText(label)}`);
    }
    for (const scene of story.scenes) {
        lines.push(`    %% == ${scene.number}. ${scene.title} ==`);
        for (const message of scene.messages) {
            if (isNote(message)) {
                lines.push(`    Note over ${message.over.map(alias).join(',')}: ${encodeText(message.note)}`);
            } else {
                const text = message.detail ? `${message.label}\n${message.detail}` : message.label;
                lines.push(`    ${alias(message.from)}${KIND_ARROW[message.kind] ?? '->>'}${alias(message.to)}: ${encodeText(text)}`);
            }
        }
    }
    return lines.join('\n') + '\n';
}

export function importItinder(story: ItinderStory, options: ItinderImportOptions = {}): Project {
    const code = storyToMermaid(story);
    const { diagram } = loadDiagram({ code, ids: [] });
    const elements = elementsOf(diagram);
    const participants = elements.filter((e) => e.type === 'participant').map((e) => e.id);
    const body = elements.filter((e) => e.type !== 'participant');
    const assets: Record<string, Asset> = {};

    let cursor = 0; // по телу диаграммы: разделитель сцены, затем её сообщения
    const episodes: Episode[] = story.scenes.map((scene, index) => {
        const divider = body[cursor++];
        const messageIds = scene.messages.map(() => body[cursor++].id);
        const audio = options.audio?.(scene) ?? null;
        if (audio?.data) assets[audio.asset] = audio.data;

        const texts = options.splitSentences === false ? [scene.speaker_text] : sentences(scene.speaker_text);
        const weights = texts.map((t) => Math.max(8, t.length));
        const total = weights.reduce((a, b) => a + b, 0);
        // Доля сцены, с которой начинается каждая реплика.
        const starts: number[] = [];
        let acc = 0;
        for (const w of weights) {
            starts.push(acc / total);
            acc += w;
        }
        const replicas = texts.map((text) => newReplica({ text }));
        if (!replicas.length) replicas.push(newReplica());

        // Сообщение i появляется на доле 0.03 + 0.82·i/(n−1) сцены (как в референсе).
        const count = messageIds.length;
        scene.messages.forEach((message, i) => {
            const share = !isNote(message) && typeof message.at === 'number' ? message.at : count === 1 ? 0.03 : 0.03 + (0.82 * i) / (count - 1);
            let r = 0;
            while (r + 1 < starts.length && starts[r + 1] <= share) r++;
            replicas[r].set[messageIds[i]] = 'visible';
        });
        replicas[0].set[divider.id] = 'visible';
        if (index === 0) for (const id of participants) replicas[0].set[id] = 'visible';

        return newEpisode({
            title: scene.title,
            start: index === 0 ? 'continue' : 'dim',
            audio: audio ? { asset: audio.asset, duration: audio.duration } : null,
            replicas: audio ? replicas.map((r, k) => ({ ...r, cue: k === 0 ? 0 : null })) : replicas,
        });
    });

    return {
        format: 'sequence-diagram-animator',
        version: 1,
        title: options.title ?? 'Импорт из ITinder',
        description: '',
        diagram: sourceOf(diagram),
        episodes,
        settings: { ...DEFAULT_SETTINGS, theme: 'itinder' },
        assets,
    };
}
