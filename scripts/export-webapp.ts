// Экспорт проекта в web-приложение из командной строки.
//   npx tsx scripts/export-webapp.ts public/examples/fsp-link/project.json out/fsp
// Относительные пути записей в проекте считаются от папки public/ (как в редакторе).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { normalizeProject } from '../src/core/project';
import { buildWebApp } from '../src/export/webapp';

const [input, output, base = 'public'] = process.argv.slice(2);
if (!input || !output) {
    console.error('Использование: tsx scripts/export-webapp.ts project.json папка-результата [корень-ассетов]');
    process.exit(1);
}
const project = normalizeProject(JSON.parse(readFileSync(input, 'utf8')));
const files = await buildWebApp(project, {
    readStatic: async (path) => readFileSync(join('public', path)),
    readAsset: async (url) => {
        if (url.startsWith('data:')) return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
        return readFileSync(resolve(base, url));
    },
});
for (const file of files) {
    const target = join(output, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.data);
}
console.log(`${files.length} файлов → ${output}`);
