// Собирает демонстрационный проект из сценария examples/partner-link-scenes.json
// (формат scenes.json, как в референсе) → public/examples/partner-link/project.json.
// Запуск: npm run example
//
// Записи диктора — public/examples/partner-link/<имя из сценария>.mp3. Файл есть —
// эпизод идёт под запись, нет — в темпе чтения текста. Сборка (npm run build)
// запускает этот скрипт сама, так что достаточно положить файлы и задеплоить.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { elementsOf } from '../src/core/diagram';
import { importItinder, ItinderStory } from '../src/core/itinder';
import { loadDiagram } from '../src/core/source';

const story = JSON.parse(readFileSync('examples/partner-link-scenes.json', 'utf8')) as ItinderStory;
const dir = 'public/examples/partner-link';

async function duration(file: string): Promise<number> {
    const input = new Input({ source: new BufferSource(readFileSync(file)), formats: ALL_FORMATS });
    return Math.round((await input.computeDuration()) * 1000) / 1000;
}

const durations = new Map<string, number>();
for (const scene of story.scenes) {
    const name = scene.audio?.name;
    if (name && existsSync(`${dir}/${name}`)) durations.set(name, await duration(`${dir}/${name}`));
}

const missing: string[] = [];
const project = importItinder(story, {
    title: 'Связка профиля с партнёром',
    audio: (scene) => {
        if (!scene.audio) return null;
        const name = scene.audio.name;
        const length = durations.get(name);
        if (!length) {
            missing.push(name);
            return null;
        }
        return {
            asset: name,
            duration: length,
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

// Постоянные id эпизодов и реплик: пересборка без изменений не меняет файл.
project.episodes.forEach((episode, e) => {
    episode.id = `ep${e + 1}`;
    episode.replicas.forEach((replica, r) => (replica.id = `ep${e + 1}-r${r + 1}`));
});

writeFileSync(`${dir}/project.json`, JSON.stringify(project, null, 2) + '\n');
console.log(`Пример: эпизодов ${project.episodes.length}, с записью ${durations.size}, реплик ${project.episodes.reduce((n, e) => n + e.replicas.length, 0)}`);
if (missing.length) console.log(`Без записи (темп чтения): ${missing.join(', ')}`);
