// Собирает демонстрационный проект из сценария examples/partner-link-scenes.json
// (формат scenes.json, как в референсе) → public/examples/partner-link/project.json.
// Запуск: npm run example
//
// Записи диктора — public/examples/partner-link/<имя из сценария>.mp3. Файл есть —
// эпизод идёт под запись, нет — в темпе чтения текста.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { elementsOf } from '../src/core/diagram';
import { importItinder, ItinderStory } from '../src/core/itinder';
import { loadDiagram } from '../src/core/source';

const story = JSON.parse(readFileSync('examples/partner-link-scenes.json', 'utf8')) as ItinderStory;
const dir = 'public/examples/partner-link';

function duration(file: string): number {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    return Math.round(Number(out.trim()) * 1000) / 1000;
}

const missing: string[] = [];
const project = importItinder(story, {
    title: 'Связка профиля с партнёром',
    audio: (scene) => {
        if (!scene.audio) return null;
        const name = scene.audio.name;
        if (!existsSync(`${dir}/${name}`)) {
            missing.push(name);
            return null;
        }
        return {
            asset: name,
            duration: duration(`${dir}/${name}`),
            data: { name, type: 'audio/mpeg', url: `examples/partner-link/${name}` },
        };
    },
});
project.description = 'Пример: портал связывает профиль пользователя с аккаунтом у партнёра по OpenID Connect и забирает его достижения из реестра партнёра.';

// Подсветка: участник подсвечивается в репликах, где о нём говорит диктор.
const { diagram } = loadDiagram(project.diagram);
const byAlias = Object.fromEntries(elementsOf(diagram).filter((e) => e.type === 'participant').map((e) => [e.type === 'participant' ? e.alias : '', e.id]));
const rules: [RegExp, string][] = [
    [/Keycloak/, byAlias.idp],
    [/реестр/i, byAlias.registry],
    [/^Пользователь (вводит|видит|соглашается)/, byAlias.user],
];
for (const episode of project.episodes) {
    for (const replica of episode.replicas) {
        replica.highlight = rules.filter(([re]) => re.test(replica.text)).map(([, id]) => id);
    }
}

writeFileSync(`${dir}/project.json`, JSON.stringify(project, null, 2) + '\n');
console.log(`episodes: ${project.episodes.length}, replicas: ${project.episodes.reduce((n, e) => n + e.replicas.length, 0)}`);
if (missing.length) console.log(`Без записи (темп чтения): ${missing.join(', ')}`);
