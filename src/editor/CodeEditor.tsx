// Редактор кода Mermaid на CodeMirror 6: подсветка синтаксиса, строки с
// ошибками, связь курсора с выделением на схеме.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import { ParseError } from '../core/mermaid';

interface StreamState {
    afterColon: boolean;
    lineStart: boolean;
}

const KEYWORDS = /^(sequenceDiagram|participant|actor|create|destroy|box|end|loop|alt|else|opt|par|par_over|and|critical|option|break|rect|activate|deactivate|note|Note|title|autonumber|links?|properties|details)\b/;
const ARROW = /^(<<-->>|<<->>|-->>|->>|--x|--\)|-->|-x|-\)|->)[+-]?/;

const mermaidSequence = StreamLanguage.define<StreamState>({
    startState: () => ({ afterColon: false, lineStart: true }),
    token(stream, state) {
        if (stream.sol()) {
            state.afterColon = false;
            state.lineStart = true;
        }
        if (stream.eatSpace()) return null;
        if (state.lineStart && stream.match(/^%%\s*==.*==\s*$/)) return 'heading';
        if (state.lineStart && stream.match(/^%%.*/)) return 'comment';
        if (state.afterColon) {
            stream.skipToEnd();
            return 'string';
        }
        if (stream.match(ARROW)) {
            state.lineStart = false;
            return 'operator';
        }
        if (stream.eat(':')) {
            state.afterColon = true;
            return 'punctuation';
        }
        if (state.lineStart && stream.match(KEYWORDS)) {
            state.lineStart = false;
            return 'keyword';
        }
        if (stream.match(/^(left of|right of|over|as)\b/)) return 'keyword';
        if (stream.match(/^@\{[^}]*\}/)) return 'meta';
        state.lineStart = false;
        if (stream.match(/^[^\s:<-]+/)) return 'variableName';
        stream.next();
        return null;
    },
});

const highlight = HighlightStyle.define([
    { tag: tags.keyword, color: '#8250df', fontWeight: '600' },
    { tag: tags.operator, color: '#cf222e', fontWeight: '600' },
    { tag: tags.string, color: '#0a3069' },
    { tag: tags.comment, color: '#6e7781', fontStyle: 'italic' },
    { tag: tags.heading, color: '#0550ae', fontWeight: '600' },
    { tag: tags.variableName, color: '#953800' },
    { tag: tags.meta, color: '#116329' },
]);

const setErrors = StateEffect.define<ParseError[]>();
const errorLine = Decoration.line({ class: 'cm-error-line' });
const errorField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
        value = value.map(tr.changes);
        for (const effect of tr.effects) {
            if (!effect.is(setErrors)) continue;
            const builder = new RangeSetBuilder<Decoration>();
            const lines = [...new Set(effect.value.map((e) => e.line))].sort((a, b) => a - b);
            for (const line of lines) {
                if (line >= 1 && line <= tr.state.doc.lines) {
                    const at = tr.state.doc.line(line).from;
                    builder.add(at, at, errorLine);
                }
            }
            value = builder.finish();
        }
        return value;
    },
    provide: (field) => EditorView.decorations.from(field),
});

const theme = EditorView.theme({
    '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--panel)' },
    '.cm-scroller': { fontFamily: "'SDA Mono', 'JetBrains Mono', Consolas, monospace", lineHeight: '1.55', fontVariantLigatures: 'none' },
    '.cm-gutters': { backgroundColor: 'var(--panel-2)', borderRight: '1px solid var(--border)', color: 'var(--muted)' },
    '.cm-activeLine': { backgroundColor: 'rgba(84, 174, 255, 0.08)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(84, 174, 255, 0.15)' },
    '.cm-error-line': { backgroundColor: 'rgba(255, 80, 80, 0.14)' },
    '&.cm-focused': { outline: 'none' },
});

interface Props {
    code: string;
    version: number;
    errors: ParseError[];
    selectedLine: number | null;
    onChange: (code: string) => void;
    onCursorLine: (line: number) => void;
}

export function CodeEditor({ code, version, errors, selectedLine, onChange, onCursorLine }: Props) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const callbacks = useRef({ onChange, onCursorLine });
    callbacks.current = { onChange, onCursorLine };
    const timer = useRef<number>(0);

    useEffect(() => {
        const editor = new EditorView({
            parent: host.current!,
            state: EditorState.create({
                doc: code,
                extensions: [
                    lineNumbers(),
                    highlightActiveLineGutter(),
                    highlightActiveLine(),
                    drawSelection(),
                    history(),
                    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
                    mermaidSequence,
                    syntaxHighlighting(highlight),
                    errorField,
                    theme,
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged && update.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('undo') || tr.isUserEvent('redo') || tr.isUserEvent('move'))) {
                            window.clearTimeout(timer.current);
                            const text = update.state.doc.toString();
                            timer.current = window.setTimeout(() => callbacks.current.onChange(text), 250);
                        }
                        if (update.selectionSet && update.view.hasFocus) {
                            const line = update.state.doc.lineAt(update.state.selection.main.head).number;
                            callbacks.current.onCursorLine(line);
                        }
                    }),
                ],
            }),
        });
        view.current = editor;
        return () => {
            window.clearTimeout(timer.current);
            editor.destroy();
        };
        // Редактор создаётся один раз; код дальше приходит через version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Код поменяли не здесь (визуальная правка, отмена, открытие проекта).
    useEffect(() => {
        const editor = view.current;
        if (!editor) return;
        const current = editor.state.doc.toString();
        if (current !== code) {
            window.clearTimeout(timer.current);
            editor.dispatch({ changes: { from: 0, to: current.length, insert: code } });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version]);

    useEffect(() => {
        view.current?.dispatch({ effects: setErrors.of(errors) });
    }, [errors]);

    // Выделили элемент на схеме — показываем его строку.
    useEffect(() => {
        const editor = view.current;
        if (!editor || selectedLine === null || editor.hasFocus) return;
        if (selectedLine < 1 || selectedLine > editor.state.doc.lines) return;
        const line = editor.state.doc.line(selectedLine);
        editor.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    }, [selectedLine]);

    return <div className="code-editor" ref={host} />;
}
