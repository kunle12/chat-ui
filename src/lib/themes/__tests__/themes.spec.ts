import { describe, expect, it } from "vitest";
import vm from "node:vm";
import {
	coerceThemeId,
	isKnownThemeId,
	resolveChrome,
	resolveLabel,
	resolveManifest,
	resolveMode,
	sanitizeThemeId,
	LCARS_DEFAULT_LABELS,
} from "../registry";
import { resolveFirstPaint, BOOTSTRAP_SCRIPT } from "../bootstrap";
import { themeManifestSchema, validateTokenValue, missingRequiredTokens } from "../types";

/**
 * Phase 1 unit tests (log task P1-09): id/mode resolution, coercion, cookie
 * validation, SSR attribute parity inputs, legacy-key migration, and
 * bootstrap-script parity with the pure resolver.
 */

describe("theme id sanitization + coercion", () => {
	it("accepts grammar-valid ids and rejects everything else", () => {
		expect(sanitizeThemeId("office")).toBe("office");
		expect(sanitizeThemeId("my-theme-2")).toBe("my-theme-2");
		expect(sanitizeThemeId('"><script>alert(1)</script>')).toBeNull();
		expect(sanitizeThemeId("../../etc/passwd")).toBeNull();
		expect(sanitizeThemeId("UPPER")).toBeNull();
		expect(sanitizeThemeId("")).toBeNull();
		expect(sanitizeThemeId(undefined)).toBeNull();
	});

	it("coerces unknown ids to the default (never an error)", () => {
		expect(coerceThemeId("does-not-exist")).toBe("lcars");
		// Registered ids pass through; a configured fallback that is not
		// installed degrades to the built-in default instead of throwing
		// (operator misconfiguration must not 500 page renders).
		expect(coerceThemeId("classic")).toBe("classic");
		expect(coerceThemeId("classic", [], "classic")).toBe("classic");
	});

	it("isKnownThemeId gates cookie values", () => {
		expect(isKnownThemeId("lcars")).toBe(true);
		expect(isKnownThemeId('x"><svg onload=alert(1)>')).toBe(false);
	});
});

describe("manifest schema", () => {
	it("parses a valid manifest and applies chrome defaults", () => {
		const manifest = themeManifestSchema.parse({
			apiVersion: 1,
			id: "test",
			name: "Test",
			version: "1.0.0",
			modes: ["dark"],
		});
		expect(manifest.chrome?.statusStrip).toBe("full");
		expect(manifest.chrome?.chatHeader).toBe("readout");
		expect(manifest.labels).toEqual({});
	});

	it("rejects bad ids, versions, modes and long labels", () => {
		expect(
			themeManifestSchema.safeParse({
				apiVersion: 1,
				id: "Bad_Id",
				name: "X",
				version: "1.0.0",
				modes: ["dark"],
			}).success
		).toBe(false);
		expect(
			themeManifestSchema.safeParse({
				apiVersion: 1,
				id: "ok",
				name: "X",
				version: "1.0",
				modes: ["dark"],
			}).success
		).toBe(false);
		expect(
			themeManifestSchema.safeParse({
				apiVersion: 1,
				id: "ok",
				name: "X",
				version: "1.0.0",
				modes: [],
			}).success
		).toBe(false);
	});

	it("rejects HTML in labels", () => {
		expect(
			themeManifestSchema.safeParse({
				apiVersion: 1,
				id: "ok",
				name: "X",
				version: "1.0.0",
				modes: ["dark"],
				labels: { streaming: "<b>bold</b>" },
			}).success
		).toBe(false);
	});
});

describe("mode resolution", () => {
	const dual = resolveManifest("lcars");
	const single = themeManifestSchema.parse({
		apiVersion: 1,
		id: "lightonly",
		name: "Light only",
		version: "1.0.0",
		modes: ["light"],
	});

	it("honors explicit light/dark", () => {
		expect(resolveMode(dual, "light", true).mode).toBe("light");
		expect(resolveMode(dual, "dark", false).mode).toBe("dark");
	});

	it("resolves system against prefers-color-scheme", () => {
		expect(resolveMode(dual, "system", true).mode).toBe("dark");
		expect(resolveMode(dual, "system", false).mode).toBe("light");
	});

	it("defaults to dark when unset (dark-first app)", () => {
		expect(resolveMode(dual, undefined, false).mode).toBe("dark");
	});

	it("coerces to a single-mode theme's only mode", () => {
		expect(resolveMode(single, "dark", true)).toEqual({ mode: "light", coerced: true });
		expect(resolveMode(single, "light", true)).toEqual({ mode: "light", coerced: false });
	});
});

describe("labels", () => {
	it("falls back to LCARS copy and interpolates {count}", () => {
		const manifest = resolveManifest("lcars");
		expect(resolveLabel(manifest, "modelsReady")).toBe(LCARS_DEFAULT_LABELS.modelsReady);
		expect(resolveLabel(manifest, "models", { count: 3 })).toBe("3 models online");
		expect(resolveLabel(manifest, "models", { count: 1 })).toBe("1 models online"); // caller uses modelsOne for 1
		expect(resolveLabel(manifest, "missing-key")).toBe("");
	});
});

describe("chrome resolution", () => {
	it("returns the manifest chrome with defaults applied", () => {
		const chrome = resolveChrome(resolveManifest("lcars"));
		expect(chrome.statusStrip).toBe("full");
		expect(chrome.chatHeader).toBe("readout");
		expect(chrome.sidebar).toBe("rail");
		expect(chrome.structure).toBe("lcars");
	});
});

describe("first-paint resolution (pure spec)", () => {
	it("keeps the server attributes when no cookie/localStorage exists", () => {
		const r = resolveFirstPaint({
			serverTheme: "lcars",
			serverDark: true,
			prefersDark: false,
		});
		expect(r).toEqual({ theme: "lcars", dark: true, migratedLegacy: false });
	});

	it("migrates the legacy localStorage.theme key once", () => {
		const r = resolveFirstPaint({
			serverTheme: "lcars",
			serverDark: true,
			legacyMode: "light",
			prefersDark: true,
		});
		expect(r.migratedLegacy).toBe(true);
		expect(r.dark).toBe(false);
	});

	it("does not re-migrate when ui-mode already exists", () => {
		const r = resolveFirstPaint({
			serverTheme: "lcars",
			serverDark: true,
			legacyMode: "light",
			storedMode: "dark",
			prefersDark: true,
		});
		expect(r.migratedLegacy).toBe(false);
		expect(r.dark).toBe(true);
	});

	it("anonymous visitor: localStorage theme wins over the server default", () => {
		const r = resolveFirstPaint({
			serverTheme: "lcars",
			serverDark: true,
			storedTheme: "office",
			storedMode: "light",
			prefersDark: true,
		});
		expect(r.theme).toBe("office");
		expect(r.dark).toBe(false);
	});

	it("cookie beats localStorage for the theme", () => {
		const r = resolveFirstPaint({
			serverTheme: "office",
			serverDark: true,
			cookieTheme: "office",
			storedTheme: "lcars",
			prefersDark: true,
		});
		expect(r.theme).toBe("office");
	});

	it("corrects the server's system-is-dark best effort on a light OS", () => {
		const r = resolveFirstPaint({
			serverTheme: "lcars",
			serverDark: true,
			cookieMode: "system",
			prefersDark: false,
		});
		expect(r.dark).toBe(false);
	});

	it("ignores hostile stored theme ids", () => {
		const r = resolveFirstPaint({
			serverTheme: "lcars",
			serverDark: true,
			storedTheme: '"><svg onload=alert(1)>',
			prefersDark: true,
		});
		expect(r.theme).toBe("lcars");
	});
});

describe("bootstrap script parity with resolveFirstPaint", () => {
	interface Scenario {
		name: string;
		serverTheme: string;
		serverDark: boolean;
		cookies?: Record<string, string>;
		localStorage?: Record<string, string>;
		prefersDark: boolean;
	}

	const scenarios: Scenario[] = [
		{ name: "fresh visitor", serverTheme: "lcars", serverDark: true, prefersDark: false },
		{
			name: "legacy light user",
			serverTheme: "lcars",
			serverDark: true,
			localStorage: { theme: "light" },
			prefersDark: true,
		},
		{
			name: "anonymous returning office user",
			serverTheme: "lcars",
			serverDark: true,
			localStorage: { "ui-theme": "office", "ui-mode": "light" },
			prefersDark: true,
		},
		{
			name: "cookie user system on light OS",
			serverTheme: "lcars",
			serverDark: true,
			cookies: { "ui-theme": "lcars", "ui-mode": "system" },
			prefersDark: false,
		},
		{
			name: "hostile stored theme",
			serverTheme: "lcars",
			serverDark: true,
			localStorage: { "ui-theme": '"><svg onload=alert(1)>' },
			prefersDark: true,
		},
	];

	/**
	 * Runs BOOTSTRAP_SCRIPT in a sandbox with a minimal DOM stub and returns
	 * the resulting html attributes + migrated localStorage. Mirrors the pure
	 * `resolveFirstPaint` scenarios 1:1 so the inline script cannot drift.
	 */
	function runBootstrap(scenario: Scenario) {
		const store = new Map(Object.entries(scenario.localStorage ?? {}));
		const cookieString = Object.entries(scenario.cookies ?? {})
			.map(([k, v]) => `${k}=${v}`)
			.join("; ");
		const html = {
			dataset: { theme: scenario.serverTheme },
			classes: new Set(scenario.serverDark ? ["dark"] : []),
			classList: {
				contains: (c: string) => html.classes.has(c),
				toggle: (c: string, on: boolean) => (on ? html.classes.add(c) : html.classes.delete(c)),
			},
		};
		const meta = { setAttribute: (_k: string, v: string) => (meta.content = v), content: "" };
		const sandbox = {
			window: {
				matchMedia: () => ({ matches: scenario.prefersDark }),
			},
			localStorage: {
				getItem: (k: string) => store.get(k) ?? null,
				setItem: (k: string, v: string) => void store.set(k, v),
			},
			document: {
				cookie: cookieString,
				documentElement: html,
				querySelector: (sel: string) => (sel === 'meta[name="theme-color"]' ? meta : null),
			},
		};
		vm.createContext(sandbox);
		vm.runInContext(BOOTSTRAP_SCRIPT, sandbox);
		return {
			theme: html.dataset.theme,
			dark: html.classes.has("dark"),
			uiMode: store.get("ui-mode") ?? null,
		};
	}

	function expected(scenario: Scenario) {
		const pure = resolveFirstPaint({
			serverTheme: scenario.serverTheme,
			serverDark: scenario.serverDark,
			cookieTheme: scenario.cookies?.["ui-theme"] ?? null,
			cookieMode: scenario.cookies?.["ui-mode"] ?? null,
			storedTheme: scenario.localStorage?.["ui-theme"] ?? null,
			storedMode: scenario.localStorage?.["ui-mode"] ?? null,
			legacyMode: scenario.localStorage?.["theme"] ?? null,
			prefersDark: scenario.prefersDark,
		});
		return {
			theme: pure.theme,
			dark: pure.dark,
			uiMode: pure.migratedLegacy
				? (scenario.localStorage?.["theme"] ?? null)
				: (scenario.localStorage?.["ui-mode"] ?? null),
		};
	}

	for (const scenario of scenarios) {
		it(`parity: ${scenario.name}`, () => {
			// The pure spec and the inline script must agree on theme + dark.
			const pure = expected(scenario);
			const applied = runBootstrap(scenario);
			expect(applied.theme).toBe(pure.theme);
			expect(applied.dark).toBe(pure.dark);
			expect(applied.uiMode).toBe(pure.uiMode);
		});
	}

	it("the script never persists a hostile theme id into data-theme", () => {
		const applied = runBootstrap({
			name: "hostile stored theme id",
			serverTheme: "lcars",
			serverDark: true,
			localStorage: { "ui-theme": "javascript:alert(1)" },
			prefersDark: true,
		});
		expect(applied.theme).toBe("lcars");
	});
});

describe("token grammar gates network-capable values", () => {
	it("rejects url() in colors and accepts real color syntax", () => {
		expect(validateTokenValue("color", "url(https://evil.com)")).toBe(false);
		expect(validateTokenValue("color", "linear-gradient(red, blue)")).toBe(false);
		expect(validateTokenValue("color", "color-mix(in srgb, #fff 50%, transparent)")).toBe(true);
		expect(validateTokenValue("color", "oklch(92.8% 0.006 264.531)")).toBe(true);
	});

	it("checks required-token completeness per mode", () => {
		const missing = missingRequiredTokens(["light", "dark"], { light: {}, dark: {} });
		expect(missing.light.length).toBeGreaterThan(60);
		expect(missing.dark.length).toBe(missing.light.length);
	});
});
