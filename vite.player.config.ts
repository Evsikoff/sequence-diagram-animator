import { defineConfig } from 'vite';

// Плеер для экспортированного web-приложения: один несжатый IIFE-скрипт, чтобы
// приложение открывалось даже с file:// и код плеера оставался читаемым.
// Редактор берёт готовые файлы из public/player при экспорте.
export default defineConfig({
    publicDir: false,
    build: {
        outDir: 'public/player',
        emptyOutDir: true,
        minify: false,
        sourcemap: false,
        lib: {
            entry: 'src/player/standalone.ts',
            name: 'SequenceDiagramPlayer',
            formats: ['iife'],
            fileName: () => 'player.js',
            cssFileName: 'player',
        },
    },
});
