import { describe, expect, it } from 'vitest';
import { newEpisode, newProject, newReplica } from '../src/core/project';
import { publishToGitHub } from '../src/export/github';
import { buildWebApp, safeFileName } from '../src/export/webapp';

function sampleProject() {
    const project = newProject('sequenceDiagram\nA->>B: hi\n', 'Тест');
    project.assets = {
        a1: { name: 'Реплика 1.mp3', type: 'audio/mpeg', url: 'data:audio/mpeg;base64,AAAA' },
        unused: { name: 'лишний.mp3', type: 'audio/mpeg', url: 'data:audio/mpeg;base64,BBBB' },
    };
    project.episodes = [newEpisode({ title: 'Один', replicas: [newReplica({ text: 'Привет', audio: { asset: 'a1', duration: 1 } })] })];
    return project;
}

const readers = {
    readStatic: async (path: string) => new TextEncoder().encode(`static:${path}`),
    readAsset: async () => new Uint8Array([1, 2, 3]),
};

describe('web-приложение', () => {
    it('собирает сайт: плеер, проект, записи, workflow Pages', async () => {
        const files = await buildWebApp(sampleProject(), readers);
        const paths = files.map((f) => f.path);
        expect(paths).toEqual(
            expect.arrayContaining(['index.html', 'presentation.js', 'project.json', 'diagram.mmd', 'player.js', 'player.css', 'README.md', '.github/workflows/pages.yml', 'audio/replika-1.mp3', 'fonts/fonts.css'])
        );
        // Неиспользуемая запись не попадает в экспорт, путь записи — относительный.
        const project = JSON.parse(files.find((f) => f.path === 'project.json')!.data as string);
        expect(Object.keys(project.assets)).toEqual(['a1']);
        expect(project.assets.a1.url).toBe('audio/replika-1.mp3');
        const html = files.find((f) => f.path === 'index.html')!.data as string;
        expect(html).toContain('<script src="presentation.js"></script>');
        expect(html).toContain('<title>Тест</title>');
        expect(files.find((f) => f.path === '.github/workflows/pages.yml')!.data).toContain('actions/deploy-pages@v4');
    });

    it('safeFileName: латиница и уникальность', () => {
        const taken = new Set<string>();
        expect(safeFileName('Вход через ФСП.mp3', 'audio/mpeg', taken)).toBe('vhod-cherez-fsp.mp3');
        expect(safeFileName('Вход через ФСП.mp3', 'audio/mpeg', taken)).toBe('vhod-cherez-fsp-2.mp3');
        expect(safeFileName('запись', 'audio/webm', taken)).toBe('zapis.webm');
    });
});

// Подставной GitHub API: хранит ссылки, блобы, деревья и коммиты в памяти.
function fakeGitHub(options: { repoExists: boolean; refuseWorkflows?: boolean }) {
    const calls: string[] = [];
    let exists = options.repoExists;
    const refs: Record<string, string> = exists ? { main: 'c0' } : {};
    const trees: Record<string, { path: string }[]> = {};
    let n = 0;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const fetchImpl = (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const path = url.replace('https://api.github.com', '');
        const body = init?.body ? JSON.parse(init.body as string) : null;
        calls.push(`${method} ${path}`);
        if (path === '/user') return json(200, { login: 'me' });
        if (method === 'GET' && path === '/repos/me/demo') return exists ? json(200, { default_branch: 'main' }) : json(404, { message: 'Not Found' });
        if (method === 'POST' && path === '/user/repos') {
            exists = true;
            refs.main = 'c0';
            return json(201, { default_branch: 'main' });
        }
        const ref = /^\/repos\/me\/demo\/git\/ref\/heads\/(.+)$/.exec(path);
        if (ref) return refs[ref[1]] ? json(200, { object: { sha: refs[ref[1]] } }) : json(404, { message: 'Not Found' });
        if (/\/git\/commits\/c\w+$/.test(path)) return json(200, { tree: { sha: 't0' } });
        if (path.endsWith('/git/blobs')) return json(201, { sha: `b${++n}` });
        if (path.endsWith('/git/trees')) {
            const sha = `t${++n}`;
            trees[sha] = body.tree;
            return json(201, { sha });
        }
        if (path.endsWith('/git/commits')) {
            if (options.refuseWorkflows && trees[body.tree].some((f) => f.path.startsWith('.github/workflows/'))) return json(201, { sha: 'bad', html_url: 'x', tree: body.tree });
            return json(201, { sha: `c${++n}`, html_url: `https://github.com/me/demo/commit/c${n}`, tree: body.tree });
        }
        if (method === 'PATCH' && path === '/repos/me/demo/git/refs/heads/main') {
            if (body.sha === 'bad') return json(404, { message: 'refusing to allow a Personal Access Token to create or update workflow' });
            refs.main = body.sha;
            return json(200, {});
        }
        if (path === '/repos/me/demo/pages') return json(201, {});
        return json(500, { message: `unexpected ${method} ${path}` });
    }) as typeof fetch;
    return { fetchImpl, calls, refs };
}

const files = [
    { path: 'index.html', data: '<html></html>' },
    { path: 'audio/a.mp3', data: new Uint8Array([1, 2, 3]) },
    { path: '.github/workflows/pages.yml', data: 'name: x' },
];
const base = { token: 't', owner: '', repo: 'demo', branch: 'main', createIfMissing: true, privateRepo: false, replace: true, message: 'Публикация' };

describe('публикация на GitHub', () => {
    it('создаёт репозиторий, коммит и включает Pages через workflow', async () => {
        const api = fakeGitHub({ repoExists: false });
        const result = await publishToGitHub(files, { ...base, fetchImpl: api.fetchImpl });
        expect(api.calls).toContain('POST /user/repos');
        expect(api.calls.filter((c) => c.endsWith('/git/blobs'))).toHaveLength(3);
        expect(api.refs.main).not.toBe('c0');
        expect(result.pagesUrl).toBe('https://me.github.io/demo/');
        expect(result.workflowSkipped).toBe(false);
    });

    it('без права на workflows публикует без них и включает Pages из ветки', async () => {
        const api = fakeGitHub({ repoExists: true, refuseWorkflows: true });
        const result = await publishToGitHub(files, { ...base, fetchImpl: api.fetchImpl });
        expect(result.workflowSkipped).toBe(true);
        expect(api.calls).not.toContain('POST /user/repos');
        expect(api.refs.main).toMatch(/^c\d+$/);
    });
});
