import { building } from "$app/environment";
import { config } from "$lib/server/config";
import type { ChatTemplateInput } from "$lib/types/Template";
import { z } from "zod";
import endpoints, { endpointSchema, type Endpoint } from "./endpoints/endpoints";

import JSON5 from "json5";
import { setMlAssistantCatalog } from "./mlAssistantModels";
import { logger } from "$lib/server/logger";
import { preservesReasoningByDefault } from "$lib/server/reasoningPolicy";
import { makeRouterEndpoint } from "$lib/server/router/endpoint";

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

const sanitizeJSONEnv = (val: string, fallback: string) => {
	const raw = (val ?? "").trim();
	const unquoted = raw.startsWith("`") && raw.endsWith("`") ? raw.slice(1, -1) : raw;
	return unquoted || fallback;
};

const modelConfig = z.object({
	/** Used as an identifier in DB */
	id: z.string().optional(),
	/** Used to link to the model page, and for inference */
	name: z.string().default(""),
	displayName: z.string().min(1).optional(),
	description: z.string().min(1).optional(),
	logoUrl: z.string().url().optional(),
	websiteUrl: z.string().url().optional(),
	modelUrl: z.string().url().optional(),
	tokenizer: z.never().optional(),
	datasetName: z.string().min(1).optional(),
	datasetUrl: z.string().url().optional(),
	preprompt: z.string().default(""),
	prepromptUrl: z.string().url().optional(),
	chatPromptTemplate: z.never().optional(),
	promptExamples: z
		.array(
			z.object({
				title: z.string().min(1),
				prompt: z.string().min(1),
			})
		)
		.optional(),
	endpoints: z.array(endpointSchema).optional(),
	providers: z
		.array(
			z
				.object({
					supports_tools: z.boolean().optional(),
					context_length: z.number().int().positive().optional(),
				})
				.passthrough()
		)
		.optional(),
	/**
	 * Context window in tokens, aggregated across providers. Used to bound how
	 * much conversation history is sent; absent when no provider reports one.
	 */
	contextLength: z.number().int().positive().optional(),
	parameters: z
		.object({
			temperature: z.number().min(0).max(2).optional(),
			truncate: z.number().int().positive().optional(),
			max_tokens: z.number().int().positive().optional(),
			stop: z.array(z.string()).optional(),
			top_p: z.number().positive().optional(),
			top_k: z.number().positive().optional(),
			frequency_penalty: z.number().min(-2).max(2).optional(),
			presence_penalty: z.number().min(-2).max(2).optional(),
		})
		.passthrough()
		.optional(),
	multimodal: z.boolean().default(false),
	multimodalAcceptedMimetypes: z.array(z.string()).optional(),
	// Aggregated tool-calling capability across providers (HF router)
	supportsTools: z.boolean().default(false),
	// Reasoning-capable model (accepts `reasoning_effort` parameter). Drives the
	// Thinking-effort control only — whether prior reasoning is echoed back is
	// `preservesReasoning`, which defaults on and is derived, not opted into.
	supportsReasoning: z.boolean().default(false),
	/**
	 * Whether the model may be sent its own prior reasoning back. Derived from
	 * the id (see reasoningPolicy.ts) when the config says nothing; an explicit
	 * entry here wins, so a backend needing the opposite can say so per model.
	 */
	preservesReasoning: z.boolean().optional(),
	// Opt-in artifacts: when true, the model is instructed to emit <artifact>
	// blocks rendered in the side panel. Set per model via MODELS overrides.
	supportsArtifacts: z.boolean().default(false),
	unlisted: z.boolean().default(false),
	embeddingModel: z.never().optional(),
	/** Used to enable/disable system prompt usage */
	systemRoleSupported: z.boolean().default(true),
});

type ModelConfig = z.infer<typeof modelConfig>;

const overrideEntrySchema = modelConfig
	.partial()
	.extend({
		id: z.string().optional(),
		name: z.string().optional(),
	})
	.refine((value) => Boolean((value.id ?? value.name)?.trim()), {
		message: "Model override entry must provide an id or name",
	});

type ModelOverride = z.infer<typeof overrideEntrySchema>;

const openaiBaseUrl = config.OPENAI_BASE_URL
	? config.OPENAI_BASE_URL.replace(/\/$/, "")
	: undefined;
const isHFRouter = openaiBaseUrl === "https://router.huggingface.co/v1";

const listSchema = z
	.object({
		data: z.array(
			z.object({
				id: z.string(),
				description: z.string().optional(),
				providers: z
					.array(
						z
							.object({
								supports_tools: z.boolean().optional(),
								context_length: z.number().int().positive().optional(),
							})
							.passthrough()
					)
					.optional(),
				architecture: z
					.object({
						input_modalities: z.array(z.string()).optional(),
					})
					.passthrough()
					.optional(),
			})
		),
	})
	.passthrough();

function getChatPromptRender(_m: ModelConfig): (inputs: ChatTemplateInput) => string {
	// Minimal template to support legacy "completions" flow if ever used.
	// We avoid any tokenizer/Jinja usage in this build.
	return ({ messages, preprompt }) => {
		const parts: string[] = [];
		if (preprompt) parts.push(`[SYSTEM]\n${preprompt}`);
		for (const msg of messages) {
			const role = msg.from === "assistant" ? "ASSISTANT" : msg.from.toUpperCase();
			parts.push(`[${role}]\n${msg.content}`);
		}
		parts.push(`[ASSISTANT]`);
		return parts.join("\n\n");
	};
}

const processModel = async (m: ModelConfig) => ({
	...m,
	chatPromptRender: await getChatPromptRender(m),
	id: m.id || m.name,
	displayName: m.displayName || m.name,
	preprompt: m.prepromptUrl ? await fetch(m.prepromptUrl).then((r) => r.text()) : m.preprompt,
	parameters: { ...m.parameters, stop_sequences: m.parameters?.stop },
	unlisted: m.unlisted ?? false,
});

const addEndpoint = (m: Awaited<ReturnType<typeof processModel>>) => ({
	...m,
	getEndpoint: async (): Promise<Endpoint> => {
		if (!m.endpoints || m.endpoints.length === 0) {
			throw new Error("No endpoints configured. This build requires OpenAI-compatible endpoints.");
		}
		// Only support OpenAI-compatible endpoints in this build
		const endpoint = m.endpoints[0];
		if (endpoint.type !== "openai") {
			throw new Error("Only 'openai' endpoint type is supported in this build");
		}
		return await endpoints.openai({ ...endpoint, model: m });
	},
});

type InternalProcessedModel = Awaited<ReturnType<typeof addEndpoint>> & {
	isRouter: boolean;
	hasInferenceAPI: boolean;
};

const inferenceApiIds: string[] = [];

const getModelOverrides = (): ModelOverride[] => {
	const overridesEnv = (Reflect.get(config, "MODELS") as string | undefined) ?? "";

	if (!overridesEnv.trim()) {
		return [];
	}

	try {
		return z.array(overrideEntrySchema).parse(JSON5.parse(sanitizeJSONEnv(overridesEnv, "[]")));
	} catch (error) {
		logger.error(error, "[models] Failed to parse MODELS overrides");
		return [];
	}
};

export type ProcessedModel = InternalProcessedModel;

export let models: ProcessedModel[] = [];
export let defaultModel: ProcessedModel | undefined = undefined;
export let taskModel: ProcessedModel | undefined = undefined;
export let validModelIdSchema: z.ZodType<string> = z.string();
/**
 * Whether the model upstream is currently answering (the most recent fetch
 * returned 200 or 304). It flips back to false when a fetch fails, so callers
 * can tell "server down" from "server up but no models running"; the UI shows a
 * "waiting" message while it is false.
 */
export let modelsReady = false;

let lastETag: string | undefined;

const createValidModelIdSchema = (modelList: ProcessedModel[]): z.ZodType<string> => {
	if (modelList.length === 0) {
		throw new Error("No models available to build validation schema");
	}
	const ids = new Set(modelList.map((m) => m.id));
	return z.string().refine((value) => ids.has(value), "Invalid model id");
};

const resolveTaskModel = (modelList: ProcessedModel[]) => {
	if (modelList.length === 0) {
		throw new Error("No models available to select task model");
	}

	if (config.TASK_MODEL) {
		const preferred = modelList.find(
			(m) => m.name === config.TASK_MODEL || m.id === config.TASK_MODEL
		);
		if (preferred) {
			return preferred;
		}
	}

	return modelList[0];
};

type FetchedModels =
	| { ok: true; parsed: z.infer<typeof listSchema>; etag?: string }
	| { ok: false; notModified: boolean };

// fetchModels fetches ${OPENAI_BASE_URL}/models (optionally with If-None-Match)
// and returns the parsed list plus the response ETag. It never throws: on any
// failure it returns { ok: false } and the caller decides whether to keep the
// previous list. A 304 is reported as notModified (the list is unchanged but
// the upstream is alive).
async function fetchModels(): Promise<FetchedModels> {
	if (!openaiBaseUrl) {
		logger.error(
			"OPENAI_BASE_URL is required. Set it to an OpenAI-compatible base (e.g., https://router.huggingface.co/v1)."
		);
		return { ok: false, notModified: false };
	}

	try {
		const baseURL = openaiBaseUrl;
		// Canonical auth token is OPENAI_API_KEY; keep HF_TOKEN as legacy alias
		const authToken = config.OPENAI_API_KEY || config.HF_TOKEN;
		const headers: Record<string, string> = {};
		if (authToken) headers.Authorization = `Bearer ${authToken}`;
		if (lastETag) headers["If-None-Match"] = lastETag;

		const response = await fetch(`${baseURL}/models`, { headers });
		if (response.status === 304) {
			return { ok: false, notModified: true };
		}
		if (!response.ok && response.status === 401 && !authToken) {
			// If we get 401 and didn't have a token, there's nothing we can do
			logger.error(
				`Failed to fetch ${baseURL}/models: ${response.status} ${response.statusText} (no auth token available)`
			);
			return { ok: false, notModified: false };
		}
		if (!response.ok) {
			logger.error(`Failed to fetch ${baseURL}/models: ${response.status} ${response.statusText}`);
			return { ok: false, notModified: false };
		}
		const json = await response.json();
		const parsed = listSchema.parse(json);
		return { ok: true, parsed, etag: response.headers.get("ETag") ?? undefined };
	} catch (e) {
		logger.error(e, "Failed to load models from OpenAI base URL");
		return { ok: false, notModified: false };
	}
}

// buildModelsFrom converts a parsed /models payload into ProcessedModel[].
// It is the shared processing step used by both the startup build and refresh.
async function buildModelsFrom(parsed: z.infer<typeof listSchema>): Promise<ProcessedModel[]> {
	const baseURL = openaiBaseUrl;

	let modelsRaw = parsed.data.map((m) => {
		let logoUrl: string | undefined = undefined;
		if (isHFRouter && m.id.includes("/")) {
			const org = m.id.split("/")[0];
			logoUrl = `https://huggingface.co/api/avatars/${encodeURIComponent(org)}`;
		}

		const inputModalities = (m.architecture?.input_modalities ?? []).map((modality) =>
			modality.toLowerCase()
		);
		const supportsImageInput =
			inputModalities.includes("image") || inputModalities.includes("vision");

		// If any provider supports tools, consider the model as supporting tools
		const supportsTools = Boolean((m.providers ?? []).some((p) => p?.supports_tools === true));
		// Smallest window any provider offers, not the largest: with
		// `provider: "auto"` the router picks, so a request sized for the
		// roomiest provider would overflow whichever one actually serves it.
		const reportedContexts = (m.providers ?? [])
			.map((p) => p?.context_length)
			.filter((n): n is number => typeof n === "number" && n > 0);
		const contextLength = reportedContexts.length ? Math.min(...reportedContexts) : undefined;
		return {
			id: m.id,
			name: m.id,
			displayName: m.id,
			description: m.description,
			logoUrl,
			providers: m.providers,
			contextLength,
			// Derived, not opted into: see reasoningPolicy.ts. A MODELS override
			// with an explicit value replaces this in the merge below.
			preservesReasoning: preservesReasoningByDefault(m.id),
			multimodal: supportsImageInput,
			multimodalAcceptedMimetypes: supportsImageInput ? ["image/*"] : undefined,
			supportsTools,
			endpoints: [
				{
					type: "openai" as const,
					baseURL,
					// apiKey will be taken from OPENAI_API_KEY or HF_TOKEN automatically
				},
			],
		} as ModelConfig;
	}) as ModelConfig[];

	const overrides = getModelOverrides();

	if (overrides.length) {
		const overrideMap = new Map<string, ModelOverride>();
		for (const override of overrides) {
			for (const key of [override.id, override.name]) {
				const trimmed = key?.trim();
				if (trimmed) overrideMap.set(trimmed, override);
			}
		}

		modelsRaw = modelsRaw.map((model) => {
			const override = overrideMap.get(model.id ?? "") ?? overrideMap.get(model.name ?? "");
			if (!override) return model;

			const { id, name, ...rest } = override;
			void id;
			void name;

			return {
				...model,
				...rest,
			};
		});
	}

	const builtModels = await Promise.all(
		modelsRaw.map((e) =>
			processModel(e)
				.then(addEndpoint)
				.then(async (m) => ({
					...m,
					hasInferenceAPI: inferenceApiIds.includes(m.id ?? m.name),
					// router decoration added later
					isRouter: false as boolean,
				}))
		)
	);

	const routerRoutesPath = (config.LLM_ROUTER_ROUTES_PATH || "").trim();
	const routerLabel = (config.PUBLIC_LLM_ROUTER_DISPLAY_NAME || "Omni").trim() || "Omni";
	const routerLogo = (config.PUBLIC_LLM_ROUTER_LOGO_URL || "").trim();
	const routerAliasId = (config.PUBLIC_LLM_ROUTER_ALIAS_ID || "omni").trim() || "omni";
	const routerMultimodalEnabled =
		(config.LLM_ROUTER_ENABLE_MULTIMODAL || "").toLowerCase() === "true";
	const routerToolsEnabled = (config.LLM_ROUTER_ENABLE_TOOLS || "").toLowerCase() === "true";

	let decorated = builtModels as ProcessedModel[];

	// Only surface the router alias when there is at least one real model to
	// route to: with no models the alias is useless, and the page should show
	// the "no models available" state instead of a broken Omni.
	if (routerRoutesPath && builtModels.length > 0) {
		// Build a minimal model config for the alias
		const aliasRaw = {
			id: routerAliasId,
			name: routerAliasId,
			displayName: routerLabel,
			description: "Automatically routes your messages to the best model for your request.",
			logoUrl: routerLogo || undefined,
			preprompt: "",
			endpoints: [
				{
					type: "openai" as const,
					baseURL: openaiBaseUrl,
				},
			],
			// Keep the alias visible
			unlisted: false,
		} as ModelConfig;

		if (routerMultimodalEnabled) {
			aliasRaw.multimodal = true;
			aliasRaw.multimodalAcceptedMimetypes = ["image/*"];
		}

		if (routerToolsEnabled) {
			aliasRaw.supportsTools = true;
		}

		// Apply MODELS overrides to the router alias too, so flags like
		// supportsArtifacts can be set on it like on any other model
		const aliasOverride = getModelOverrides().find(
			(o) => o.id?.trim() === routerAliasId || o.name?.trim() === routerAliasId
		);
		if (aliasOverride) {
			const { id, name, ...rest } = aliasOverride;
			void id;
			void name;
			Object.assign(aliasRaw, rest);
		}

		const aliasBase = await processModel(aliasRaw);
		// Create a self-referential ProcessedModel for the router endpoint
		const aliasModel: ProcessedModel = {
			...aliasBase,
			isRouter: true,
			hasInferenceAPI: false,
			// getEndpoint uses the router wrapper regardless of the endpoints array
			getEndpoint: async (): Promise<Endpoint> => makeRouterEndpoint(aliasModel),
		} as ProcessedModel;

		// Put alias first
		decorated = [aliasModel, ...decorated];
	}

	return decorated;
}

// buildModels is the startup build: fetch (no conditional GET) then process.
// It never throws — on failure it returns [] and the app keeps polling.
const buildModels = async (): Promise<ProcessedModel[]> => {
	if (!openaiBaseUrl) {
		logger.error(
			"OPENAI_BASE_URL is required. Set it to an OpenAI-compatible base (e.g., https://router.huggingface.co/v1)."
		);
		modelsReady = false;
		return [];
	}
	logger.info({ baseURL: openaiBaseUrl }, "[models] Using OpenAI-compatible base URL");
	try {
		const fetched = await fetchModels();
		if (!fetched.ok) {
			modelsReady = false;
			return [];
		}
		lastETag = fetched.etag;
		const built = await buildModelsFrom(fetched.parsed);
		modelsReady = true;
		return built;
	} catch (e) {
		logger.error(e, "Failed to build models from the upstream");
		modelsReady = false;
		return [];
	}
};

// applyModels atomically swaps the module state with a freshly built list. It
// never throws; an empty list leaves the app in the "waiting" state. It does
// not touch modelsReady — the caller sets that based on whether the fetch
// actually succeeded (an empty list from a live upstream is ready; an empty
// list from a failed fetch is not).
function applyModels(newModels: ProcessedModel[]) {
	models = newModels;
	if (newModels.length === 0) {
		defaultModel = undefined;
		taskModel = undefined;
		validModelIdSchema = z.string();
		setMlAssistantCatalog(() => []);
		return;
	}
	setMlAssistantCatalog(() =>
		newModels.map((model) => ({ id: model.id, isRouter: model.isRouter }))
	);
	defaultModel = newModels[0];
	taskModel = resolveTaskModel(newModels);
	validModelIdSchema = createValidModelIdSchema(newModels);
}

// refreshModels re-fetches the model list (conditionally, using the last ETag)
// and swaps it in only when it changed. On failure it keeps the previous list
// and marks the app as not-ready so the poller keeps retrying quickly.
async function refreshModels() {
	if (!openaiBaseUrl) {
		modelsReady = false;
		return;
	}
	try {
		const fetched = await fetchModels();
		if (!fetched.ok) {
			// 304 = the upstream is alive and the list is unchanged; an error
			// means we are still waiting for it to come up.
			modelsReady = fetched.notModified;
			return;
		}
		const newModels = await buildModelsFrom(fetched.parsed);
		lastETag = fetched.etag;
		applyModels(newModels);
		modelsReady = true;
	} catch (e) {
		logger.error(e, "[models] Model refresh failed; keeping previous list");
		modelsReady = false;
	}
}

// schedulePoll keeps the model list fresh: quickly while the upstream is not
// ready (or empty), then slowly once models are available (for change detection
// via the ETag). It is skipped during `vite build`.
function schedulePoll() {
	if (building) return;
	const timer = setTimeout(
		async () => {
			await refreshModels();
			schedulePoll();
		},
		models.length === 0 || !modelsReady ? 5000 : 30000
	);
	// Fire-and-forget timer: don't let it hold a process open (builds, scripts,
	// tests). A deployed server is kept alive by its HTTP listener regardless.
	(timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
}

// Skip the initial fetch during `vite build`: SvelteKit's analyse phase imports this
// module, and hitting the live router from CI builds fails on rate limits (429).
// The model list is built at server startup and then kept fresh by schedulePoll:
// if the upstream is not up yet, the app starts in the "waiting" state and keeps
// polling until models become available.
if (!building) {
	const startedAt = Date.now();
	const initial = await buildModels();
	applyModels(initial);

	if (models.length > 0) {
		logger.info(
			{ total: models.length, durationMs: Date.now() - startedAt },
			"[models] Model cache built"
		);
	} else {
		logger.warn("[models] No models available yet; will keep polling the upstream");
	}

	schedulePoll();
}

export const validateModel = (_models: BackendModel[]) => {
	// When no models are available (e.g. the upstream is still coming up), accept
	// any id so callers can fail gracefully with their own error instead of
	// crashing on an empty enum.
	if (_models.length === 0) return z.string();
	// Zod enum function requires 2 parameters
	return z.enum([_models[0].id, ..._models.slice(1).map((m) => m.id)]);
};

// if `TASK_MODEL` is string & name of a model in `MODELS`, then we use `MODELS[TASK_MODEL]`, else we try to parse `TASK_MODEL` as a model config itself

export type BackendModel = Optional<
	ProcessedModel,
	"preprompt" | "parameters" | "multimodal" | "unlisted" | "hasInferenceAPI"
>;
