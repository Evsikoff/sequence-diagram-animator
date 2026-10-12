import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isStaleDemo } from '../src/core/demo';
import { normalizeProject, Project } from '../src/core/project';

const demo = () => normalizeProject(JSON.parse(readFileSync('public/examples/partner-link/project.json', 'utf8')));

describe('копия примера в браузере', () => {
    it('в примере есть записи диктора всех эпизодов', () => {
        const project = demo();
        expect(project.episodes.every((e) => e.audio && e.audio.duration > 0)).toBe(true);
        for (const e of project.episodes) expect(project.assets[e.audio!.asset].url).toMatch(/^examples\/partner-link\/.+\.mp3$/);
    });

    it('нетронутая копия без записей устарела', () => {
        const saved: Project = { ...demo(), assets: {}, episodes: demo().episodes.map((e) => ({ ...e, id: 'x', audio: null })) };
        expect(isStaleDemo(saved, demo())).toBe(true);
    });

    it('копия с правками пользователя остаётся', () => {
        const saved = demo();
        saved.episodes[0].replicas[0].text = 'Мой текст';
        expect(isStaleDemo(saved, demo())).toBe(false);
        expect(isStaleDemo({ ...demo(), diagram: { ...demo().diagram, code: demo().diagram.code + '    user->>portal: ещё\n' } }, demo())).toBe(false);
    });

    it('копия со ссылками на удалённые файлы старого примера устарела', () => {
        const saved = demo();
        saved.title = 'Старый пример';
        saved.assets = { a: { name: 'a.mp3', type: 'audio/mpeg', url: 'examples/fsp-link/01.mp3' } };
        expect(isStaleDemo(saved, demo())).toBe(true);
    });

    it('чужой проект не трогаем', () => {
        const other = { ...demo(), title: 'Мой проект', assets: { a: { name: 'a.mp3', type: 'audio/mpeg', url: 'data:audio/mpeg;base64,AA' } } };
        expect(isStaleDemo(other, demo())).toBe(false);
    });
});
