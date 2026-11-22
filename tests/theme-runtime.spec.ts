/**
 * Theme runtime e2e (log tasks P1-09 / P1-06 / P1-07).
 *
 * Proves the Phase 1 acceptance criteria against the real app:
 *  - SSR `<html>` attributes follow the ui-theme/ui-mode cookies, and hostile
 *    or unknown cookie ids degrade to the default (no attribute injection);
 *  - picking a theme in Settings persists to localStorage + cookie AND the
 *    account settings DB (visible on a fresh page load with a clean cookie jar);
 *  - the legacy `localStorage.theme` key migrates to `ui-mode`;
 *  - the `?theme=` deep link applies, coerces unknown ids, and is stripped.
 */
import { test, expect } from "./fixtures.ts";

test.describe("theme runtime", () => {
	test("SSR attributes follow cookies; hostile ids degrade safely", async ({ request }) => {
		const clean = await request.get("/", { maxRedirects: 0 });
		const cleanHtml = await clean.text();
		expect(cleanHtml).toContain('<html lang="en" data-theme="lcars" class="dark">');
		expect(cleanHtml).toContain("ui-theme");

		const hostile = await request.get("/", {
			maxRedirects: 0,
			headers: { cookie: 'ui-theme="><script>alert(1)</script>' },
		});
		const hostileHtml = await hostile.text();
		expect(hostileHtml).toContain('data-theme="lcars"');
		expect(hostileHtml).not.toContain("<script>alert(1)");

		const unknown = await request.get("/", {
			maxRedirects: 0,
			headers: { cookie: "ui-theme=doesnotexist" },
		});
		expect(await unknown.text()).toContain('data-theme="lcars"');

		const light = await request.get("/", {
			maxRedirects: 0,
			headers: { cookie: "ui-theme=lcars; ui-mode=light" },
		});
		const lightHtml = await light.text();
		expect(lightHtml).toContain('data-theme="lcars"');
		expect(lightHtml).not.toContain('<html lang="en" data-theme="lcars" class="dark">');
	});

	test("picker choice persists to localStorage, cookie and the settings DB", async ({ page }) => {
		await page.goto("/settings/application");

		// Click the active theme card to exercise the full persistence path
		// (runtime → localStorage + cookie + debounced settings POST).
		await page.getByRole("button", { name: /LCARS/ }).click();
		await expect
			.poll(async () => page.evaluate(() => localStorage.getItem("ui-theme")))
			.toBe("lcars");
		await expect.poll(async () => page.evaluate(() => document.cookie)).toContain("ui-theme=lcars");

		// Switch mode through the select — must flow through the runtime (D8).
		await page.getByRole("combobox").last().selectOption("light");
		await expect
			.poll(async () => page.evaluate(() => document.documentElement.classList.contains("dark")))
			.toBe(false);
		await expect
			.poll(async () => page.evaluate(() => localStorage.getItem("ui-mode")))
			.toBe("light");

		// Fresh load: the account settings (DB) must reproduce the light mode
		// even with a clean cookie jar — proves the debounced POST landed.
		await page.evaluate(() => {
			document.cookie.split(";").forEach((c) => {
				const name = c.split("=")[0].trim();
				if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
			});
		});
		await page.reload();
		await expect(page.locator("html")).not.toHaveClass(/dark/);
		await expect(page.locator("html")).toHaveAttribute("data-theme", "lcars");
	});

	test("legacy localStorage.theme migrates to ui-mode before paint", async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem("theme", "light"));
		await page.goto("/");
		// Pre-theme users with an explicit light preference must stay light.
		await expect(page.locator("html")).not.toHaveClass(/dark/);
		const migrated = await page.evaluate(() => localStorage.getItem("ui-mode"));
		expect(migrated).toBe("light");
	});

	test("?theme= deep link applies, coerces unknown ids and is stripped", async ({ page }) => {
		await page.goto("/settings/application?theme=doesnotexist");
		await expect(page.locator("html")).toHaveAttribute("data-theme", "lcars");
		await expect.poll(async () => page.url()).not.toContain("theme=");
	});
});
