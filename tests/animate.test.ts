import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Animator, computeTimeline } from '../src/core/animate';
import { elementsOf } from '../src/core/diagram';
import { importItinder, ItinderStory } from '../src/core/itinder';
import { layoutDiagram } from '../src/core/layout';
import { newEpisode, newProject, newReplica, Project } from '../src/core/project';
import { loadDiagram } from '../src/core/source';
import { autoSplit, sentences } from '../src/core/split';
import { themeById } from '../src/core/theme';

function setup(project: Project) {
    const { diagram } = loadDiagram(project.diagram);
    project.diagram.ids = elementsOf(diagram).map((e) => e.id);
    const layout = layoutDiagram(diagram, themeById(project.settings.theme));
    return { diagram, layout, animator: new Animator(project, layout) };
}

const CODE = 'sequenceDiagram\nA->>B: one\nB-->>A: two\nA->>C: three\n';

describe('timeline', () => {
    it('длительность реплики: вручную, по записи, по тексту', () => {
        const project = newProject(CODE);
        project.settings.episodeTail = 0;
        project.episodes = [
            newEpisode({
                replicas: [
                    newReplica({ duration: 5 }),
                    newReplica({ audio: { asset: 'a', duration: 4 } }),
                    newReplica({ text: 'x'.repeat(140) }),
                ],
            }),
        ];
        const { episodes } = computeTimeline(project);
        expect(episodes[0].replicas.map((r) => [r.start, r.end])).toEqual([
            [0, 5],
            [5, 9.35],
            [9.35, 19.35],
        ]);
        expect(episodes[0].audio).toEqual([{ asset: 'a', at: 5, offset: 0, duration: 4 }]);
    });

    it('запись эпизода: реплики — метки, без меток — пропорционально тексту', () => {
        const project = newProject(CODE);
        project.settings.episodeTail = 0;
        project.episodes = [
            newEpisode({
                audio: { asset: 'ep', duration: 30 },
                replicas: [newReplica({ text: 'a'.repeat(10) }), newReplica({ text: 'b'.repeat(10) }), newReplica({ text: 'c'.repeat(10), cue: 20 }), newReplica({ text: 'd'.repeat(10) })],
            }),
        ];
        const { episodes } = computeTimeline(project);
        expect(episodes[0].replicas.map((r) => r.start)).toEqual([0, 10, 20, 25]);
        expect(episodes[0].duration).toBe(30);
    });
});

describe('Animator', () => {
    it('показывает, приглушает и подсвечивает по репликам', () => {
        const project = newProject(CODE);
        const { animator, layout } = setup(project);
        const [pA, pB, pC, m1, m2, m3] = layout.order;
        project.episodes = [
            newEpisode({
                start: 'continue',
                replicas: [newReplica({ duration: 4, set: { [pA]: 'visible', [pB]: 'visible', [m1]: 'visible' } }), newReplica({ duration: 4, set: { [m2]: 'visible' }, highlight: [m2] })],
            }),
            newEpisode({ start: 'dim', replicas: [newReplica({ duration: 4, set: { [pC]: 'visible', [m3]: 'visible' } })] }),
        ];
        const anim = new Animator(project, animator.layout);
        // Начало: m1 ещё не дорисован.
        expect(anim.frame(0, 0)?.visualOf(m1)).toBeNull();
        expect(anim.frame(0, 3.9).visualOf(m1)).toMatchObject({ opacity: 1, progress: 1 });
        expect(anim.frame(0, 3.9).visualOf(m2)).toBeNull();
        const second = anim.frame(0, 7.9);
        expect(second.replica).toBe(1);
        expect(second.visualOf(m2)).toMatchObject({ progress: 1, highlight: 1 });
        // Второй эпизод: прошлые сообщения приглушены, участники — нет.
        const third = anim.frame(1, 3.9);
        expect(third.visualOf(m1)).toMatchObject({ dim: 1 });
        expect(third.visualOf(pA)).toMatchObject({ dim: 0 });
        expect(third.visualOf(m2)).toMatchObject({ dim: 1, highlight: 0 });
        expect(third.visualOf(m3)).toMatchObject({ dim: 0, progress: 1 });
    });

    it('камера: вся диаграмма, ручная и плавный переезд', () => {
        const project = newProject(CODE);
        const { layout } = setup(project);
        project.settings.cameraTime = 1;
        project.episodes = [
            newEpisode({
                replicas: [
                    newReplica({ duration: 3, camera: { mode: 'all' }, set: Object.fromEntries(layout.order.map((id) => [id, 'visible'])) }),
                    newReplica({ duration: 3, camera: { mode: 'manual', x: 0, y: 0, w: 100, h: 50 } }),
                ],
            }),
        ];
        const anim = new Animator(project, layout);
        const all = anim.allCamera();
        expect(anim.cameraAt(0, 2.5)).toEqual(all);
        const manual = anim.fitAspect({ x: 0, y: 0, w: 100, h: 50 });
        expect(anim.cameraAt(0, 4.5)).toEqual(manual);
        const mid = anim.cameraAt(0, 3.5);
        expect(mid.w).toBeLessThan(all.w);
        expect(mid.w).toBeGreaterThan(manual.w);
    });
});

describe('нарезка и импорт', () => {
    it('autoSplit: эпизоды по разделителям, реплики по сообщениям', () => {
        const { diagram } = loadDiagram({ code: 'sequenceDiagram\n%% == Один ==\nA->>B: 1\nB->>A: 2\n%% == Два ==\nA->>B: 3\n', ids: [] });
        const episodes = autoSplit(diagram, { episodes: 'dividers', perReplica: 1, highlightNew: true });
        expect(episodes.map((e) => e.title)).toEqual(['Один', 'Два']);
        expect(episodes.map((e) => e.replicas.length)).toEqual([2, 1]);
        expect(episodes[0].replicas[0].highlight).toHaveLength(1);
    });

    it('sentences делит текст на предложения', () => {
        expect(sentences('Раз. Два! Три? Четыре…')).toEqual(['Раз.', 'Два!', 'Три?', 'Четыре…']);
    });

    it('импорт сценария в формате scenes.json сохраняет все сообщения и сцены', () => {
        const story = JSON.parse(readFileSync('examples/partner-link-scenes.json', 'utf8')) as ItinderStory;
        const project = importItinder(story, { audio: (scene) => ({ asset: scene.audio!.name, duration: 25 }) });
        const { diagram, errors } = loadDiagram(project.diagram);
        expect(errors).toEqual([]);
        expect(diagram.participants).toHaveLength(4);
        const messages = story.scenes.reduce((n, s) => n + s.messages.length, 0);
        expect(diagram.items.filter((i) => i.type === 'message' || i.type === 'note')).toHaveLength(messages);
        expect(project.episodes).toHaveLength(6);
        // Каждый элемент диаграммы появляется хотя бы в одной реплике.
        const shown = new Set(project.episodes.flatMap((e) => e.replicas.flatMap((r) => Object.keys(r.set))));
        expect(elementsOf(diagram).every((e) => shown.has(e.id))).toBe(true);
        const { animator } = setup(project);
        expect(animator.timeline.episodes.every((e) => Math.abs(e.duration - 25.8) < 1e-9)).toBe(true);
    });
});
