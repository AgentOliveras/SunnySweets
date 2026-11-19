import { TabType } from '../types';

export interface AppRouteState {
  tab: TabType;
  projectId?: string | null;
  editorTab?: 'formula' | 'products' | 'history' | null;
}

/**
 * Parses current window location pathname into structured AppRouteState.
 */
export function parseRoute(pathname?: string): AppRouteState {
  let path = '/';
  if (pathname !== undefined) {
    path = pathname.replace(/\/+$/, '') || '/';
  } else if (typeof window !== 'undefined') {
    path = (window.location.pathname || '').replace(/\/+$/, '') || '/';
  } else {
    return { tab: 'dashboard', projectId: null, editorTab: null };
  }

  if (path === '/' || path === '/dashboard') {
    return { tab: 'dashboard', projectId: null, editorTab: null };
  }
  if (path.startsWith('/recipes')) {
    return { tab: 'recipes', projectId: null, editorTab: null };
  }
  if (path.startsWith('/ingredients')) {
    return { tab: 'ingredients', projectId: null, editorTab: null };
  }
  if (path.startsWith('/calculate')) {
    return { tab: 'calculate', projectId: null, editorTab: null };
  }
  if (path.startsWith('/presets')) {
    return { tab: 'presets', projectId: null, editorTab: null };
  }
  if (path.startsWith('/mixers')) {
    return { tab: 'mixers', projectId: null, editorTab: null };
  }
  if (path.startsWith('/costing')) {
    return { tab: 'costing', projectId: null, editorTab: null };
  }
  if (path.startsWith('/history')) {
    return { tab: 'history', projectId: null, editorTab: null };
  }
  if (path.startsWith('/settings')) {
    return { tab: 'settings', projectId: null, editorTab: null };
  }

  // Quoting & Product Development routes
  if (path.startsWith('/quotes')) {
    const segments = path.split('/').filter(Boolean); // ['quotes', 'proj-123', 'history']
    if (segments.length === 1) {
      return { tab: 'quotes', projectId: null, editorTab: null };
    }
    const projectId = segments[1];
    let editorTab: 'formula' | 'products' | 'history' = 'formula';
    if (segments[2] === 'products' || segments[2] === 'history') {
      editorTab = segments[2];
    }
    return { tab: 'quotes', projectId, editorTab };
  }

  return { tab: 'dashboard', projectId: null, editorTab: null };
}

/**
 * Builds canonical URL pathname for a route.
 */
export function buildRoutePath(
  tab: TabType,
  projectId?: string | null,
  editorTab?: 'formula' | 'products' | 'history' | null
): string {
  if (tab === 'quotes') {
    if (!projectId) {
      return '/quotes';
    }
    if (editorTab && editorTab !== 'formula') {
      return `/quotes/${encodeURIComponent(projectId)}/${editorTab}`;
    }
    return `/quotes/${encodeURIComponent(projectId)}`;
  }

  if (tab === 'dashboard') {
    return '/';
  }

  return `/${tab}`;
}

/**
 * Navigates to an app route via HTML5 History pushState without reloading.
 * Avoids duplicate history entries if target route matches current URL.
 */
export function navigateToRoute(
  tab: TabType,
  projectId?: string | null,
  editorTab?: 'formula' | 'products' | 'history' | null,
  replace: boolean = false
): void {
  if (typeof window === 'undefined' || !window.history) return;

  const targetPath = buildRoutePath(tab, projectId, editorTab);
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const targetClean = targetPath.replace(/\/+$/, '') || '/';

  if (currentPath === targetClean) {
    return;
  }

  const stateData: AppRouteState = { tab, projectId, editorTab };
  if (replace) {
    window.history.replaceState(stateData, '', targetPath);
  } else {
    window.history.pushState(stateData, '', targetPath);
  }
}
