<script lang="ts">
	import { onMount, tick } from "svelte";
	import { base } from "$app/paths";
	import { afterNavigate, goto } from "$app/navigation";
	import { page } from "$app/state";
	import { useSettingsStore } from "$lib/stores/settings";
	import IconOmni from "$lib/components/icons/IconOmni.svelte";
	import IconBurger from "$lib/components/icons/IconBurger.svelte";
	import IconFast from "$lib/components/icons/IconFast.svelte";
	import IconCheap from "$lib/components/icons/IconCheap.svelte";
	import CarbonClose from "~icons/carbon/close";
	import CarbonTextLongParagraph from "~icons/carbon/text-long-paragraph";
	import CarbonChevronLeft from "~icons/carbon/chevron-left";
	import LucideImage from "~icons/lucide/image";
	import LucideHammer from "~icons/lucide/hammer";
	import IconGear from "~icons/bi/gear-fill";
	import { PROVIDERS_HUB_ORGS } from "@huggingface/inference";
	import { shownProvider } from "$lib/utils/shownProvider";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	const publicConfig = usePublicConfig();

	import type { LayoutData } from "../$types";
	import { browser } from "$app/environment";
	import { isDesktop } from "$lib/utils/isDesktop";
	import { debounce } from "$lib/utils/debounce";
	import { mlAssistant } from "$lib/stores/mlAssistant.svelte";
	import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";

	interface Props {
		data: LayoutData;
		children?: import("svelte").Snippet;
	}

	let { data, children }: Props = $props();

	let previousPage: string = $state(base || "/");
	let showContent: boolean = $state(false);

	let navContainer: HTMLDivElement | undefined = $state();

	async function scrollSelectedModelIntoView() {
		await tick();
		const container = navContainer;
		if (!container) return;
		const currentModelId = page.params.model as string | undefined;
		if (!currentModelId) return;
		const buttons = container.querySelectorAll<HTMLButtonElement>("button[data-model-id]");
		let target: HTMLElement | null = null;
		for (const btn of buttons) {
			if (btn.dataset.modelId === currentModelId) {
				target = btn;
				break;
			}
		}
		if (!target) return;
		// Use minimal movement; keep within view if needed
		target.scrollIntoView({ block: "nearest", inline: "nearest" });
	}

	function checkDesktopRedirect() {
		if (
			browser &&
			isDesktop(window) &&
			page.url.pathname === `${base}/settings` &&
			!page.url.pathname.endsWith("/application")
		) {
			goto(`${base}/settings/application`);
		}
	}

	onMount(() => {
		// Show content when not on the root settings page
		showContent = page.url.pathname !== `${base}/settings`;
		// Initial desktop redirect check
		checkDesktopRedirect();

		// Ensure the selected model (if any) is visible in the nav
		void scrollSelectedModelIntoView();

		// Add resize listener for desktop redirect
		if (browser) {
			const debouncedCheck = debounce(checkDesktopRedirect, 100);
			window.addEventListener("resize", debouncedCheck);
			return () => window.removeEventListener("resize", debouncedCheck);
		}
	});

	afterNavigate(({ from }) => {
		if (from?.url && !from.url.pathname.includes("settings")) {
			previousPage = from.url.toString() || previousPage || base || "/";
		}
		// Show content when not on the root settings page
		showContent = page.url.pathname !== `${base}/settings`;
		// Check desktop redirect after navigation
		checkDesktopRedirect();
		// After navigation, keep the selected model in view
		void scrollSelectedModelIntoView();
	});

	const settings = useSettingsStore();

	// Local filter for model list (hyphen/space insensitive)
	let modelFilter = $state("");
	const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
	let queryTokens = $derived(normalize(modelFilter).trim().split(/\s+/).filter(Boolean));

	// With the ML Intern switch on, only the mode's fixed set is offered, in its
	// configured order — anything else would be swapped for the default on send.
	let mlModelsOnly = $derived(ML_ASSISTANT_MODE && mlAssistant.enabled);
	let browsableModels = $derived(
		mlModelsOnly
			? data.mlAssistantModels
					.map((id) => data.models.find((el) => el.id === id))
					.filter((el): el is (typeof data.models)[number] => el !== undefined)
			: data.models
	);
</script>

<div
	class="mx-auto grid h-full w-full max-w-[1400px] grid-cols-1 grid-rows-[auto_1fr] content-start gap-x-6 overflow-hidden p-4 text-lcars-ink md:grid-cols-3 md:grid-rows-[auto_1fr] md:p-4"
>
	<div class="col-span-1 mb-3 flex items-center justify-between md:col-span-3 md:mb-4">
		{#if showContent && browser}
			<button
				class="btn rounded-lg md:hidden"
				aria-label="Back to menu"
				onclick={() => {
					showContent = false;
					goto(`${base}/settings`);
				}}
			>
				<IconBurger
					classNames="text-xl text-gray-900 hover:text-black dark:text-gray-200 dark:hover:text-white sm:hidden"
				/>
				<CarbonChevronLeft
					class="text-xl text-gray-900 hover:text-black max-sm:hidden dark:text-gray-200 dark:hover:text-white"
				/>
			</button>
		{/if}
		<h2
			class="ui-display right-0 left-0 mx-auto w-fit text-center text-2xl text-lcars-ink md:hidden"
		>
			Settings
		</h2>
		<button
			class="btn rounded-full bg-lcars-panel p-1.5 ring-1 ring-lcars-panel-edge"
			aria-label="Close settings"
			onclick={() => {
				goto(previousPage);
			}}
		>
			<CarbonClose class="text-xl text-lcars-muted hover:text-lcars-ink" />
		</button>
	</div>
	{#if !(showContent && browser && !isDesktop(window))}
		<div
			class="ui-panel col-span-1 scrollbar-custom flex flex-col overflow-y-auto rounded-r-[22px] border-l-0 whitespace-nowrap max-md:-mx-4 max-md:h-full md:pr-4"
			class:max-md:hidden={showContent && browser}
			bind:this={navContainer}
		>
			<!-- Section Headers -->
			<h3 class="ui-kicker px-3 pt-3 pb-1 text-lcars-dim md:text-left">Models</h3>

			<!-- Filter input -->
			<div class="px-2 py-2">
				<input
					bind:value={modelFilter}
					type="search"
					placeholder="Search by name"
					aria-label="Search models by name or id"
					class="w-full rounded-full border border-lcars-panel-edge bg-lcars-screen-1 px-4 py-1.5 text-sm text-lcars-ink placeholder:text-lcars-dim focus:ring-2 focus:ring-lcars-amber/40 focus:outline-hidden"
				/>
			</div>

			{#if mlModelsOnly}
				<p class="px-3 pb-2 text-xs text-gray-500 dark:text-gray-400">
					ML Intern mode is on, so only its models are listed.
				</p>
			{/if}
			{#each browsableModels
				.filter((el) => !el.unlisted)
				.filter((el) => {
					const haystack = normalize(`${el.id} ${el.name ?? ""} ${el.displayName ?? ""}`);
					return queryTokens.every((q) => haystack.includes(q));
				}) as model, index (model.id)}
				<button
					type="button"
					onclick={() => goto(`${base}/settings/${model.id}`)}
					class="group flex h-9 w-full flex-none items-center gap-1 rounded-r-[18px] pr-2 pl-0 text-[13px] text-lcars-muted hover:bg-lcars-peach/15 {model.id ===
					page.params.model
						? 'bg-lcars-panel! text-lcars-ink!'
						: ''}"
					data-model-id={model.id}
					aria-label="Configure {model.displayName}"
				>
					<span
						class="ui-cap-r h-5 w-[3px] flex-none {model.id === page.params.model
							? 'bg-lcars-amber'
							: [
									'bg-lcars-peach/60',
									'bg-lcars-sky/70',
									'bg-lcars-lilac/70',
									'bg-lcars-marigold/70',
								][index % 4]}"
					></span>
					<div class="mr-auto flex items-center gap-1.5 truncate pl-1.5">
						{#if model.isRouter}
							<IconOmni classNames="size-3.5 flex-none" />
						{:else if model.logoUrl}
							<img
								src={model.logoUrl}
								alt=""
								loading="lazy"
								decoding="async"
								class="size-3.5 flex-none rounded-sm border bg-white dark:border-gray-700"
							/>
						{:else}
							<div
								class="size-3.5 flex-none rounded-sm border border-transparent bg-gray-300 dark:bg-gray-800"
							></div>
						{/if}
						<span class="truncate">{model.displayName}</span>
					</div>

					{#if publicConfig.isHuggingChat && shownProvider(model, $settings.providerOverrides)}
						{@const providerOverride = shownProvider(model, $settings.providerOverrides) ?? ""}
						{@const hubOrg =
							PROVIDERS_HUB_ORGS[providerOverride as keyof typeof PROVIDERS_HUB_ORGS]}
						{#if providerOverride === "fastest"}
							<span
								title="Provider: {providerOverride}"
								class="grid size-[21px] flex-none place-items-center rounded-md bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
								aria-label="Provider: {providerOverride}"
								role="img"
							>
								<IconFast classNames="size-3" />
							</span>
						{:else if providerOverride === "cheapest"}
							<span
								title="Provider: {providerOverride}"
								class="grid size-[21px] flex-none place-items-center rounded-md bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
								aria-label="Provider: {providerOverride}"
								role="img"
							>
								<IconCheap classNames="size-3" />
							</span>
						{:else if hubOrg}
							<span
								title="Provider: {providerOverride}"
								class="flex size-[21px] flex-none items-center justify-center rounded-md bg-gray-500/10 p-[0.225rem]"
							>
								<img
									src="https://huggingface.co/api/avatars/{hubOrg}"
									alt={providerOverride}
									class="size-full rounded-sm"
								/>
							</span>
						{/if}
					{/if}

					{#if $settings.toolsOverrides?.[model.id] ?? (model as { supportsTools?: boolean }).supportsTools}
						<span
							title="Tool calling supported"
							class="grid size-[21px] flex-none place-items-center rounded-md bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
							aria-label="Model supports tools"
							role="img"
						>
							<LucideHammer class="size-3" />
						</span>
					{/if}

					{#if $settings.multimodalOverrides?.[model.id] ?? model.multimodal}
						<span
							title="Multimodal support (image inputs)"
							class="grid size-[21px] flex-none place-items-center rounded-md bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
							aria-label="Model is multimodal"
							role="img"
						>
							<LucideImage class="size-3" />
						</span>
					{/if}

					{#if $settings.customPrompts?.[model.id]}
						<CarbonTextLongParagraph
							class="size-6 rounded-md border border-gray-300 p-1 text-gray-800 dark:border-gray-600 dark:text-gray-200"
						/>
					{/if}
					{#if model.id === $settings.activeModel}
						<div
							class="flex h-[21px] items-center rounded-md bg-black/90 px-2 text-[11px] leading-none font-semibold text-white dark:bg-white dark:text-black"
						>
							Active
						</div>
					{/if}
				</button>
			{/each}

			<button
				type="button"
				onclick={() => goto(`${base}/settings/application`)}
				class="ui-btn sticky bottom-0 mt-2 mb-2 h-9 w-full flex-none gap-1.5 bg-lcars-amber text-[0.625rem] text-lcars-on-amber shadow-sm max-md:order-first"
				aria-label="Configure application settings"
			>
				<IconGear class="mr-0.5 text-xxs" />
				Application Settings
			</button>
		</div>
	{/if}
	{#if showContent}
		<div
			class="col-span-1 scrollbar-custom w-full overflow-x-clip overflow-y-auto px-1 md:col-span-2 md:row-span-2"
			class:max-md:hidden={!showContent && browser}
		>
			{@render children?.()}
		</div>
	{/if}
</div>
