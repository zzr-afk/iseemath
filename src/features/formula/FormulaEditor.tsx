import { useEffect, useRef } from 'react';
import {
  autocompletion,
  closeBrackets,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view';

export interface FormulaEditorProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  completions: string[];
  placeholder?: string;
  /** Dense variant used inside the outer relations list. */
  compact?: boolean;
}

export const FUNCTION_NAMES = new Set([
  'abs', 'ceil', 'floor', 'round', 'clamp', 'min', 'max', 'sqrt', 'pow',
  'exp', 'ln', 'log', 'log10', 'sign', 'lerp', 'isNaN', 'if', 'and', 'or', 'not',
]);

const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: '#0f1117',
    color: '#cdd6e4',
    fontSize: '12px',
    border: '1px solid var(--border-subtle)',
    borderRadius: '6px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: 'var(--accent)',
  },
  '.cm-content': {
    padding: '6px 8px',
    minHeight: '44px',
    caretColor: '#7fb4ff',
  },
  '.cm-scroller': {
    maxHeight: '120px',
    overflow: 'auto',
  },
  '.cm-tooltip-autocomplete': {
    border: '1px solid var(--border-subtle)',
    borderRadius: '6px',
    backgroundColor: '#161b26',
    color: '#cdd6e4',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'rgba(79, 157, 255, 0.2)',
    color: '#ffffff',
  },
});

const compactEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: '#0f1117',
    color: '#cdd6e4',
    fontSize: '11.5px',
    border: '1px solid var(--border-subtle)',
    borderRadius: '5px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: 'var(--accent)',
  },
  '.cm-content': {
    padding: '3px 7px',
    minHeight: '26px',
    caretColor: '#7fb4ff',
  },
  '.cm-scroller': {
    maxHeight: '64px',
    overflow: 'auto',
  },
});

export default function FormulaEditor({
  value,
  onChange,
  onCommit,
  completions,
  placeholder,
  compact = false,
}: FormulaEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const completionsRef = useRef(completions);

  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;
  completionsRef.current = completions;

  useEffect(() => {
    if (!hostRef.current) return undefined;

    const completionSource = (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/[\p{L}\p{N}_]*/u);
      if (!word) return null;
      if (word.from === word.to && !context.explicit) return null;
      const labels = Array.from(new Set(completionsRef.current));
      if (labels.length === 0) return null;
      return {
        from: word.from,
        options: labels.map((label) => ({
          label,
          type: FUNCTION_NAMES.has(label) ? 'function' : 'variable',
        })),
      };
    };

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        closeBrackets(),
        autocompletion({ override: [completionSource], activateOnTyping: true }),
        keymap.of([
          ...completionKeymap,
          {
            key: 'Shift-Enter',
            run: (view) => {
              view.dispatch(view.state.replaceSelection('\n'));
              return true;
            },
          },
          {
            key: 'Enter',
            run: (view) => {
              onCommitRef.current(view.state.doc.toString());
              view.contentDOM.blur();
              return true;
            },
          },
          {
            key: 'Escape',
            run: (view) => {
              view.contentDOM.blur();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          blur: (_event, view) => {
            onCommitRef.current(view.state.doc.toString());
            return false;
          },
        }),
        compact ? compactEditorTheme : editorTheme,
        placeholder ? placeholderExtension(placeholder) : [],
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; value/completion updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div ref={hostRef} />;
}
