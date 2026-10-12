// Собирает демонстрационный проект из сценария референса ITinder
// (examples/fsp-link-scenes.json) → public/examples/fsp-link/project.json.
// Запуск: npx tsx scripts/build-example.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { importItinder, ItinderStory } from '../src/core/itinder';
import { loadDiagram } from '../src/core/source';
import { elementsOf } from '../src/core/diagram';

const story = JSON.parse(readFileSync('examples/fsp-link-scenes.json', 'utf8')) as ItinderStory;
const dir = 'public/examples/fsp-link';

function duration(file: string): number {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    return Math.round(Number(out.trim()) * 1000) / 1000;
}

const project = importItinder(story, {
    title: 'Связка профиля ITinder с ФСП',
    audio: (scene) => {
        if (!scene.audio) return null;
        const name = scene.audio.name;
        return {
            asset: name,
            duration: duration(`${dir}/${name}`),
            data: { name, type: 'audio/mpeg', url: `examples/fsp-link/${name}` },
        };
    },
});
project.description = 'Демонстрация: выдуманная интеграция ITinder с ФСП через Keycloak (сценарий из репозитория Evsikoff/itinder).';

// Подсветка: участник подсвечивается в репликах, где о нём говорит диктор.
const { diagram } = loadDiagram(project.diagram);
const byAlias = Object.fromEntries(elementsOf(diagram).filter((e) => e.type === 'participant').map((e) => [e.type === 'participant' ? e.alias : '', e.id]));
const rules: [RegExp, string][] = [
    [/Keycloak|страниц[уе] входа ФСП ID|в ФСП ID/i, byAlias.keycloak],
    [/реестр/i, byAlias.registry],
    [/Кандидат (вводит|видит|соглашается)|кандидату/i, byAlias.user],
];
for (const episode of project.episodes) {
    for (const replica of episode.replicas) {
        replica.highlight = rules.filter(([re]) => re.test(replica.text)).map(([, id]) => id);
    }
}

writeFileSync(`${dir}/project.json`, JSON.stringify(project, null, 2) + '\n');
console.log(`episodes: ${project.episodes.length}, replicas: ${project.episodes.reduce((n, e) => n + e.replicas.length, 0)}`);
