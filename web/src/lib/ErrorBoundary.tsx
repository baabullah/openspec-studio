import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from './ui.tsx';

interface Props {
  /** Shown in the fallback, e.g. "Agent panel". */
  name: string;
  /** When this changes (other repo / change selected) the pane tries again by itself. */
  resetKey?: unknown;
  children: ReactNode;
}

/**
 * Keeps a render error in one pane from blanking the whole studio: the
 * other panes, the agent session and the review state stay usable.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`${this.props.name} crashed`, error, info.componentStack); }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-0 flex-col items-center justify-center gap-3 overflow-auto p-6 text-center text-[13px]">
        <TriangleAlert size={22} className="text-bad" />
        <div className="font-medium">{this.props.name} hit an error</div>
        <pre className="max-h-40 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 px-3 py-2 text-left text-[11.5px] text-muted">{error.message}</pre>
        <Button size="sm" onClick={() => this.setState({ error: null })}>Try again</Button>
      </div>
    );
  }
}
