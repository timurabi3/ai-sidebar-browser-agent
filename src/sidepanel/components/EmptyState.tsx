import { SparkIcon } from './Icons';

// Shown when a conversation has no messages yet. A few example prompts double as
// quick-start affordances.
interface Props {
  onExample: (text: string) => void;
  needsKey: boolean;
  onOpenSettings: () => void;
}

const EXAMPLES = [
  { title: 'Summarize', body: 'this page in a few bullets' },
  { title: 'Extract', body: 'every link and list them' },
  { title: 'Fill & submit', body: 'the search box for me' },
  { title: 'Read', body: 'the article as key points' },
];

export function EmptyState({ onExample, needsKey, onOpenSettings }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-6 text-center animate-fade-in">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/12 text-accent ring-1 ring-accent/20">
          <SparkIcon width={24} height={24} />
        </div>
        <div className="space-y-2">
          <h1 className="font-serif text-[26px] font-normal leading-tight text-fg">
            How can I help on this page?
          </h1>
          <p className="mx-auto max-w-xs text-sm leading-relaxed text-fg-muted">
            Ask about what you're viewing, or tell me to act on it — read, click, type,
            scroll and navigate.
          </p>
        </div>
      </div>

      {needsKey ? (
        <button className="btn-accent" onClick={onOpenSettings}>
          Add an API key to start
        </button>
      ) : (
        <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.title}
              onClick={() => onExample(`${ex.title} ${ex.body}`)}
              className="group rounded-2xl border border-border bg-bg-subtle/60 px-3.5 py-3 text-left transition-all hover:-translate-y-px hover:border-border-strong hover:bg-bg-subtle"
            >
              <span className="block text-sm font-medium text-fg">{ex.title}</span>
              <span className="mt-0.5 block text-xs leading-snug text-fg-subtle group-hover:text-fg-muted">
                {ex.body}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
