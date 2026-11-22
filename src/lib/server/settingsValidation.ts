import { error } from "@sveltejs/kit";
import { z } from "zod";
import { authCondition } from "$lib/server/auth";
import { assertBillableOrganization } from "$lib/server/billingOrganizations";
import { config } from "$lib/server/config";
import { collections } from "$lib/server/database";
import * as themeRegistry from "$lib/themes/registry";
import { DEFAULT_THEME_ID } from "$lib/themes/registry";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";

export const settingsSchema = z
	.object({
		shareConversationsWithModelAuthors: z
			.boolean()
			.default(DEFAULT_SETTINGS.shareConversationsWithModelAuthors),
		welcomeModalSeen: z.boolean().optional(),
		mlInternOnboardingSeen: z.boolean().optional(),
		activeModel: z.string().default(DEFAULT_SETTINGS.activeModel),
		customPrompts: z.record(z.string()).default({}),
		customPromptsEnabled: z.record(z.boolean()).default({}),
		multimodalOverrides: z.record(z.boolean()).default({}),
		toolsOverrides: z.record(z.boolean()).default({}),
		artifactsOverrides: z.record(z.boolean()).default({}),
		providerOverrides: z.record(z.string()).default({}),
		reasoningEffortOverrides: z.record(z.enum(["low", "medium", "high"])).default({}),
		reasoningOverrides: z.record(z.boolean()).default({}),
		streamingMode: z.enum(["raw", "smooth"]).optional(),
		directPaste: z.boolean().default(false),
		hapticsEnabled: z.boolean().default(true),
		hidePromptExamples: z.record(z.boolean()).default({}),
		billingOrganization: z.string().optional(),
		billingResourceGroup: z
			.string()
			.regex(/^[a-f\d]{24}$/i)
			.or(z.literal(""))
			.optional(),
		uiTheme: z
			.string()
			.regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
			.optional(),
		uiThemeMode: z.enum(["light", "dark", "system"]).optional(),
	})
	.refine((settings) => !settings.billingResourceGroup || Boolean(settings.billingOrganization), {
		message: "A billing resource group requires its organization",
		path: ["billingResourceGroup"],
	});

export type ParsedSettings = z.infer<typeof settingsSchema>;

/** The coercion target: operator-configurable, else `lcars` (decision D11). */
export function defaultThemeId(): string {
	return config.get("PUBLIC_DEFAULT_THEME") || DEFAULT_THEME_ID;
}

export function parseSettingsPayload(body: unknown): ParsedSettings {
	const result = settingsSchema.safeParse(body);
	if (!result.success) {
		const detail = result.error.issues
			.map((issue) => `${issue.path.join(".") || "settings"}: ${issue.message}`)
			.join("; ");
		error(400, detail || "Invalid settings");
	}
	const parsed = result.data;

	// Coerce unknown / no-longer-installed theme ids to the default on write
	// (THEMES.md §9.3). A removed theme must never 400 the payload — that
	// would block saving every other setting.
	if (parsed.uiTheme && parsed.uiTheme !== defaultThemeId()) {
		// Built-ins only until Phase 5 wires external discovery into validation.
		const { isKnownThemeId } = themeRegistry;
		if (!isKnownThemeId(parsed.uiTheme)) {
			parsed.uiTheme = defaultThemeId();
		}
	}

	return parsed;
}

/** Verify a changed financial target once, without delaying unrelated settings saves. */
export async function assertBillingTargetChange(
	locals: App.Locals,
	settings: Pick<ParsedSettings, "billingOrganization" | "billingResourceGroup">
): Promise<void> {
	if (!config.isHuggingChat || !settings.billingOrganization) return;
	const current = await collections.settings.findOne(authCondition(locals), {
		projection: { billingOrganization: 1, billingResourceGroup: 1 },
	});
	const resourceGroup = settings.billingResourceGroup || undefined;
	if (
		current?.billingOrganization !== settings.billingOrganization ||
		(current?.billingResourceGroup || undefined) !== resourceGroup
	) {
		await assertBillableOrganization(locals, settings.billingOrganization, resourceGroup);
	}
}
