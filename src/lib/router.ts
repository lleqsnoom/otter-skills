import { createSignal } from 'solid-js';

/**
 * A router in sixty lines. The path is a signal and a link is an anchor whose click is intercepted, so the back
 * button and the keyboard both keep working. Path segments that can contain slashes (a group's or a file's
 * relative path) travel as one encoded segment, which is what keeps the parse a plain `split`.
 *
 * A group's address may name the artifact it has open — `/p/<repo>/g/<run>/<file>` — because an artifact inside a
 * collection is read on the collection's page and nowhere else, and an address that cannot say which artifact is
 * open could not be sent to anyone.
 *
 * The server answers any extension-less path with the app shell, so a deep link survives a reload.
 */
export type Route =
  | { name: 'overview' }
  | { name: 'project'; project: string }
  | { name: 'category'; project: string; category: string }
  | { name: 'group'; project: string; group: string; file?: string }
  | { name: 'file'; project: string; path: string };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { name: 'overview' };
  if (parts[0] === 'p' && parts[1]) {
    if (parts[2] === 'c' && parts[3]) return { name: 'category', project: parts[1], category: parts[3] };
    if (parts[2] === 'g' && parts[3]) {
      const file = parts.slice(4).join('/');
      return { name: 'group', project: parts[1], group: parts[3], ...(file ? { file } : {}) };
    }
    return { name: 'project', project: parts[1] };
  }
  if (parts[0] === 'f' && parts[1] && parts[2]) return { name: 'file', project: parts[1], path: parts.slice(2).join('/') };
  return { name: 'overview' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'overview':
      return '/';
    case 'project':
      return `/p/${encodeURIComponent(route.project)}`;
    case 'category':
      return `/p/${encodeURIComponent(route.project)}/c/${encodeURIComponent(route.category)}`;
    case 'group':
      return `/p/${encodeURIComponent(route.project)}/g/${encodeURIComponent(route.group)}${route.file ? `/${encodeURIComponent(route.file)}` : ''}`;
    case 'file':
      return `/f/${encodeURIComponent(route.project)}/${route.path.split('/').map(encodeURIComponent).join('/')}`;
  }
}

const [route, setRoute] = createSignal<Route>(parseRoute(window.location.pathname));

window.addEventListener('popstate', () => setRoute(parseRoute(window.location.pathname)));

export function current(): Route {
  return route();
}

/**
 * What the address names, for the components that show one thing about it.
 *
 * These live here rather than in a component because more than one of them asks the same question — the rail marks
 * the current repository and category, and the screen decides what to draw from the same two answers — and because
 * "what does this route say" is a question about routes.
 */
export function routeProject(): string | null {
  const route = current();
  if (route.name === 'overview') return null;
  return 'project' in route ? route.project : null;
}

export function routeCategory(): string | null {
  const route = current();
  return route.name === 'category' ? route.category : null;
}

export function routeGroupPath(): string {
  const route = current();
  return route.name === 'group' ? route.group : '';
}

/** The artifact a collection's page has open, when the address names one. */
export function routeGroupFile(): string | null {
  const route = current();
  return route.name === 'group' ? (route.file ?? null) : null;
}

export function routeFilePath(): string {
  const route = current();
  return route.name === 'file' ? route.path : '';
}

export function navigate(to: Route, { replace = false } = {}) {
  const path = href(to);
  if (path !== window.location.pathname) {
    if (replace) window.history.replaceState(null, '', path);
    else window.history.pushState(null, '', path);
  }
  setRoute(to);
  window.scrollTo({ top: 0 });
}

export function linkProps(to: Route) {
  const onClick = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };
  return { href: href(to), onClick };
}