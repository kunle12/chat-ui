import { building } from "$app/environment";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { themeManifestSchema, type ThemeManifest } from "$lib/themes/types";

/**
 * External theme discovery (THEMES_DIR, log tasks P5-01/P5-02).
 *
 * Server-only: reads `$THEMES_DIR/<id>/{theme.json, theme.css, fonts/, …}`.
 * Without THEMES_DIR the directory is absent and every lookup returns null
 * (routes answer 404). The manifest is re-validated on every read — a cached
 * but since-edited manifest cannot skip the schema.
 */

export function themesDir(): string | undefined {
	if (building) return undefined;
	const dir = process.env.THEMES_DIR;
	return dir && existsSync(dir) ? dir : undefined;
}

export function externalThemeIds(): string[] {
	const dir = themesDir();
	if (!dir) return [];
	try {
		return readdirSync(dir).filter((name) => {
			if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(name)) return false;
			return statSync(join(dir, name)).isDirectory() && existsSync(join(dir, name, "theme.json"));
		});
	} catch {
		return [];
	}
}

/**
 * Path-traversal-safe resolution: the id must match the grammar AND realpath
 * to a directory inside THEMES_DIR (symlinks pointing outside are rejected).
 */
function safeThemeDir(id: string): string | null {
	if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) return null;
	const dir = themesDir();
	if (!dir) return null;
	try {
		const themeDir = realpathSync(join(dir, id));
		if (!themeDir.startsWith(realpathSync(dir))) return null;
		if (!existsSync(join(themeDir, "theme.json"))) return null;
		return themeDir;
	} catch {
		return null;
	}
}

/** Read + validate an external manifest. Returns null when absent/invalid. */
export function readExternalManifest(id: string): ThemeManifest | null {
	const themeDir = safeThemeDir(id);
	if (!themeDir) return null;
	try {
		const raw = JSON.parse(readFileSync(join(themeDir, "theme.json"), "utf-8"));
		const manifest = themeManifestSchema.parse(raw);
		// External themes may not ship structural variants (decision D2).
		if (manifest.chrome?.structure) return null;
		return manifest;
	} catch {
		return null;
	}
}

/** Read a file from a validated theme directory (css/fonts/previews). */
export function readExternalThemeFile(
	id: string,
	relative: string
): { content: Uint8Array; type: string } | null {
	const themeDir = safeThemeDir(id);
	if (!themeDir) return null;
	// The relative path must be a bare filename (no traversal via subdirs).
	if (!/^[a-zA-Z0-9._-]+$/.test(relative) || relative.includes("..")) return null;
	const full = join(themeDir, relative);
	if (!existsSync(full)) return null;
	const ext = relative.split(".").pop()?.toLowerCase() ?? "";
	const types: Record<string, string> = {
		css: "text/css",
		woff2: "font/woff2",
		woff: "font/woff",
		webp: "image/webp",
		png: "image/png",
		txt: "text/plain",
	};
	const type = types[ext];
	if (!type) return null;
	try {
		return { content: readFileSync(full), type };
	} catch {
		return null;
	}
}

/** External manifests for the layout server (metadata for the registry). */
export function readExternalManifests(): ThemeManifest[] {
	return externalThemeIds()
		.map((id) => readExternalManifest(id))
		.filter((m): m is ThemeManifest => m !== null);
}
