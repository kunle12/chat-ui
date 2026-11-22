/**
 * Theme screenshot baseline (log task P0-07).
 *
 * Captures the pre-change look for the parity checks in Phase 2 (P2-08):
 * routes {home, conversation, settings} × modes {light, dark} × viewports
 * {1440×900, 390×844} → tests/theme-baseline/*.png (committed).
 *
 * Gated behind THEME_BASELINE=1 so normal e2e runs skip it entirely:
 *
 *   THEME_BASELINE=1 npx playwright test tests/theme-baseline.spec.ts
 *
 * Regenerate deliberately: the whole point is that the images only change
 * when the UI does, and a diff against them is the parity evidence.
 */
import { test, expect, E2E_APP_URL } from "./fixtures.ts";
import { mkdirSync } from "node:fs";

/** Output directory; override to capture a candidate set without clobbering the baseline. */
const BASELINE_DIR = process.env.THEME_BASELINE_DIR ?? "./tests/theme-baseline";

/**
 * svelte.config.js loads `.env.local` (override: true) at build time, so a
 * developer's APP_BASE=/chat bakes into the production build. Detect the
 * actual base instead of assuming "/": probe "/" and "/chat/" once.
 */
async function detectBase(page: import("playwright/test").Page): Promise<string> {
	for (const candidate of ["", "/chat"]) {
		const res = await page.request.get(`${E2E_APP_URL}${candidate}/`, { maxRedirects: 0 });
		if (res.ok()) return candidate;
	}
	throw new Error(
		`Could not find the app base path under ${E2E_APP_URL} (/ and /chat/ both failed)`
	);
}

const VIEWPORTS = [
	{ name: "desktop", width: 1440, height: 900 },
	{ name: "mobile", width: 390, height: 844 },
] as const;

const MODES = ["dark", "light"] as const;

for (const viewport of VIEWPORTS) {
	test.describe(`theme baseline @ ${viewport.name}`, () => {
		test.use({ viewport: { width: viewport.width, height: viewport.height } });

		for (const mode of MODES) {
			test(`capture ${mode} ${viewport.name}`, async ({ page, seedConversation }) => {
				test.skip(process.env.THEME_BASELINE !== "1", "set THEME_BASELINE=1 to capture");
				mkdirSync(BASELINE_DIR, { recursive: true });

				// Pre-LCARS mode bootstrap reads localStorage.theme.
				await page.addInitScript((m) => localStorage.setItem("theme", m), mode);

				const conversationId = await seedConversation({
					title: "Theme baseline conversation",
				});

				const base = await detectBase(page);

				const shots: Array<[string, string]> = [
					["home", `${base}/`],
					["conversation", `${base}/conversation/${conversationId}`],
					["settings", `${base}/settings/application`],
				];

				for (const [name, path] of shots) {
					await page.goto(path);
					await expect(page.locator("#app")).toBeVisible();
					// Let fonts and the first paint settle; screenshots must be deterministic.
					await page.evaluate(() => document.fonts.ready);
					await page.waitForTimeout(300);
					await page.screenshot({
						path: `${BASELINE_DIR}/${name}-${mode}-${viewport.name}.png`,
						fullPage: false,
					});
				}
			});
		}
	});
}
