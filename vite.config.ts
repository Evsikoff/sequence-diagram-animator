import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Редактор. base './' — сборку можно положить в любую папку (GitHub Pages и т. п.).
export default defineConfig({
    base: './',
    plugins: [react()],
    build: {
        outDir: 'dist',
        chunkSizeWarningLimit: 2000,
    },
});
