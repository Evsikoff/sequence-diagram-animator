// Публикация экспортированного web-приложения в репозиторий GitHub прямо из
// браузера (REST API, один коммит через Git Data API) и включение GitHub Pages.
import { ExportFile } from './webapp';

export interface GitHubOptions {
    token: string;
    owner: string; // пусто — владелец токена
    repo: string;
    branch: string;
    createIfMissing: boolean;
    privateRepo: boolean;
    replace: boolean; // заменить содержимое ветки (иначе — дописать поверх)
    message: string;
    description?: string;
    onProgress?: (text: string) => void;
    fetchImpl?: typeof fetch;
}

export interface GitHubResult {
    repoUrl: string;
    commitUrl: string;
    pagesUrl: string;
    pagesNote: string;
    workflowSkipped: boolean;
}

export class GitHubError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
    }
}

function base64(data: string | Uint8Array): string {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

export async function publishToGitHub(files: ExportFile[], options: GitHubOptions): Promise<GitHubResult> {
    const doFetch = options.fetchImpl ?? fetch.bind(globalThis);
    const log = options.onProgress ?? (() => {});
    const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
        const response = await doFetch(`https://api.github.com${path}`, {
            method,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${options.token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) {
            let message = `${response.status}`;
            try {
                const data = (await response.json()) as { message?: string };
                if (data.message) message = `${response.status}: ${data.message}`;
            } catch {
                // тело не JSON
            }
            throw new GitHubError(message, response.status);
        }
        return (response.status === 204 ? null : await response.json()) as T;
    };

    log('Проверяем токен…');
    const user = await api<{ login: string }>('GET', '/user');
    const owner = options.owner.trim() || user.login;
    const repo = options.repo.trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Имя репозитория: латиница, цифры, «-», «_» и «.»');
    const path = `/repos/${owner}/${repo}`;

    let defaultBranch = options.branch;
    try {
        const info = await api<{ default_branch: string }>('GET', path);
        defaultBranch = info.default_branch;
    } catch (error) {
        if (!(error instanceof GitHubError) || error.status !== 404 || !options.createIfMissing) throw error;
        log(`Создаём репозиторий ${owner}/${repo}…`);
        const body = { name: repo, private: options.privateRepo, auto_init: true, description: options.description ?? '' };
        const created = await api<{ default_branch: string }>('POST', owner === user.login ? '/user/repos' : `/orgs/${owner}/repos`, body);
        defaultBranch = created.default_branch;
    }

    // Последний коммит ветки (если ветки нет — от ветки по умолчанию).
    const headOf = async (branch: string): Promise<string | null> => {
        try {
            const ref = await api<{ object: { sha: string } }>('GET', `${path}/git/ref/heads/${encodeURIComponent(branch)}`);
            return ref.object.sha;
        } catch (error) {
            if (error instanceof GitHubError && (error.status === 404 || error.status === 409)) return null;
            throw error;
        }
    };
    let parent = await headOf(options.branch);
    const branchExists = parent !== null;
    if (!parent) parent = await headOf(defaultBranch);
    if (!parent) {
        // Пустой репозиторий: Git Data API требует хотя бы один коммит.
        log('Репозиторий пуст — создаём первый коммит…');
        await api('PUT', `${path}/contents/README.md`, { message: 'Initial commit', content: base64(`# ${repo}\n`), branch: options.branch });
        parent = await headOf(options.branch);
    }
    const baseCommit = await api<{ tree: { sha: string } }>('GET', `${path}/git/commits/${parent}`);

    const commitFiles = async (list: ExportFile[]): Promise<string> => {
        const tree: { path: string; mode: string; type: string; sha: string }[] = [];
        let done = 0;
        const queue = list.slice();
        const worker = async () => {
            for (let file = queue.shift(); file; file = queue.shift()) {
                const blob = await api<{ sha: string }>('POST', `${path}/git/blobs`, { content: base64(file.data), encoding: 'base64' });
                tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
                log(`Загружено файлов: ${++done} из ${list.length}`);
            }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        tree.sort((a, b) => a.path.localeCompare(b.path));
        const newTree = await api<{ sha: string }>('POST', `${path}/git/trees`, options.replace ? { tree } : { base_tree: baseCommit.tree.sha, tree });
        const commit = await api<{ sha: string; html_url: string }>('POST', `${path}/git/commits`, { message: options.message, tree: newTree.sha, parents: [parent] });
        if (branchExists) await api('PATCH', `${path}/git/refs/heads/${encodeURIComponent(options.branch)}`, { sha: commit.sha, force: false });
        else await api('POST', `${path}/git/refs`, { ref: `refs/heads/${options.branch}`, sha: commit.sha });
        return commit.html_url;
    };

    log('Создаём коммит…');
    let workflowSkipped = false;
    let commitUrl: string;
    try {
        commitUrl = await commitFiles(files);
    } catch (error) {
        // Токену без права на workflows GitHub не даст положить .github/workflows.
        const workflow = files.some((f) => f.path.startsWith('.github/workflows/'));
        if (!(error instanceof GitHubError) || !workflow || ![403, 404, 422].includes(error.status)) throw error;
        log('Токен не может менять workflows — публикуем без .github/workflows…');
        workflowSkipped = true;
        commitUrl = await commitFiles(files.filter((f) => !f.path.startsWith('.github/workflows/')));
    }

    log('Включаем GitHub Pages…');
    const pagesUrl = `https://${owner.toLowerCase()}.github.io/${repo}/`;
    let pagesNote = '';
    const pagesBody = workflowSkipped ? { build_type: 'legacy', source: { branch: options.branch, path: '/' } } : { build_type: 'workflow' };
    try {
        await api('POST', `${path}/pages`, pagesBody);
        pagesNote = workflowSkipped ? 'Pages публикуется из ветки.' : 'Pages публикуется workflow из .github/workflows/pages.yml.';
    } catch (error) {
        if (error instanceof GitHubError && error.status === 409) {
            try {
                await api('PUT', `${path}/pages`, pagesBody);
            } catch {
                // настройки Pages менять не обязательно
            }
            pagesNote = 'GitHub Pages уже были включены.';
        } else {
            pagesNote = `Pages включить не удалось (${(error as Error).message}). Включите вручную: Settings → Pages.`;
        }
    }
    return { repoUrl: `https://github.com/${owner}/${repo}`, commitUrl, pagesUrl, pagesNote, workflowSkipped };
}
