import { Component } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';

/** Reload the app — but not with no signal: that only swaps the app for the browser's own "No internet"
 *  page, with nothing to come back to (audit pwa-brand-load-1/-3). */
export function reloadWhenOnline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    toast.error('No internet yet. Try again once the line is back.');
    return;
  }
  window.location.reload();
}

/** What a screen shows when its own code stopped on an error, instead of going black. */
export function CrashCard({ what = 'This page' }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Something went wrong"
      message={`${what} stopped on an error. Reload to open it again.`}
      action={<Button variant="secondary" onClick={reloadWhenOnline}>Reload</Button>}
    />
  );
}

/**
 * The last net under the whole app. Without one, any error while drawing
 * unmounted everything and left a black screen that stayed black even after
 * Back or the connection coming back (audit pwa-brand-load-1). Pages have
 * their own net (LazyPage), so this one only catches the frame around them.
 */
export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <CrashCard what="The app" />
      </div>
    );
  }
}
