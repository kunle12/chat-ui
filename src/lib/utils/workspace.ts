/**
 * Return-to-workspace behaviour for the kunle_workspace integration.
 *
 * The console spawns app tabs through openSpawnedTab() — a window.open() call
 * whose handle is tracked while window.opener is severed (so the app can never
 * navigate the console). The tab still is a script-opened auxiliary browsing
 * context, so it can close itself with window.close(); the severed opener
 * property does not revoke that ability.
 *
 * Tabs opened natively (middle-click, context menu, a typed URL) cannot be
 * closed by script at all — for those, fall back to navigating this tab back
 * to the console origin. The console tab itself keeps running either way.
 */
export function returnToWorkspace(workspaceOrigin: string, win: Window = window): void {
	if (!workspaceOrigin) {
		return;
	}

	win.close();

	// If the browser refused the close (tab not script-opened), take this tab
	// back to the console instead of leaving a dead click.
	win.setTimeout(() => {
		if (!win.closed) {
			win.location.assign(workspaceOrigin);
		}
	}, 250);
}
