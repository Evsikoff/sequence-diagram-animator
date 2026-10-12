// Картинка диаграммы (SVG) из кода Mermaid или проекта — без браузера.
//   npm run render:svg -- диаграмма.mmd картинка.svg [тема: light | itinder | dark]
// Ширина текста считается приблизительно; в редакторе (Файл → Скачать SVG) — точно.
import { readFileSync, writeFileSync } from 'node:fs';
import { layoutDiagram } from '../src/core/layout';
import { svgDocument } from '../src/core/render';
import { buildScene, FULL } from '../src/core/scene';
import { loadDiagram } from '../src/core/source';
import { themeById } from '../src/core/theme';

const [input, output, themeId] = process.argv.slice(2);
if (!input || !output) {
    console.error('Использование: npm run render:svg -- диаграмма.mmd картинка.svg [light|itinder|dark]');
    process.exit(1);
}
const text = readFileSync(input, 'utf8');
const project = input.endsWith('.json') ? JSON.parse(text) : null;
const { diagram, errors } = loadDiagram(project ? project.diagram : { code: text, ids: [] });
for (const error of errors) console.warn(`Строка ${error.line}: ${error.message}`);
const theme = themeById(themeId ?? project?.settings?.theme);
const layout = layoutDiagram(diagram, theme);
const b = layout.bounds;
writeFileSync(output, svgDocument(buildScene(layout, () => FULL), theme, b, { width: Math.round(b.w), height: Math.round(b.h) }));
console.log(`${output}: ${Math.round(b.w)}×${Math.round(b.h)}`);
