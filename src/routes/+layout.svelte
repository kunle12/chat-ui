<script lang="ts">
	import "../styles/main.css";

	import { onDestroy, onMount, untrack } from "svelte";
	import { browser } from "$app/environment";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";

	import { error } from "$lib/stores/errors";
	import { loading } from "$lib/stores/loading";
	import { createSettingsStore } from "$lib/stores/settings";
	import { setHapticsEnabled } from "$lib/utils/haptics";
	import { syncMcpSelection } from "$lib/stores/mcpSelectionSync";
	import { enabledServersCount, initWithServers } from "$lib/stores/mcpServers";

	import Toast from "$lib/components/Toast.svelte";
	import NotificationToasts from "$lib/components/NotificationToasts.svelte";
	import GenerationLiveWatcher from "$lib/components/GenerationLiveWatcher.svelte";
	import NavMenu from "$lib/components/NavMenu.svelte";
	import NavigationLoadingBar from "$lib/components/NavigationLoadingBar.svelte";
	import MobileNav from "$lib/components/MobileNav.svelte";
	import WelcomeModal from "$lib/components/WelcomeModal.svelte";
	import ExpandNavigation from "$lib/components/ExpandNavigation.svelte";
	import { setContext } from "svelte";
	import { handleResponse, useAPIClient } from "$lib/APIClient";
	import { isAborted } from "$lib/stores/isAborted";
	import { isPro } from "$lib/stores/isPro";
	import { requireAuthUser } from "$lib/utils/auth";
	import { createConversationsStore } from "$lib/stores/conversations.svelte";
	import {
		initThemeRuntime,
		reconcileFromServer,
		setTheme,
		getActiveTheme,
	} from "$lib/themes/themes.svelte";
	import { resolveManifest, resolveChrome, resolveLabel } from "$lib/themes/registry";
	import type { ThemeModePreference } from "$lib/themes/types";
	import { createActiveGenerationsStore } from "$lib/stores/activeGenerations.svelte";
	import { createNotificationsStore } from "$lib/stores/notifications.svelte";

	let { data = $bindable(), children } = $props();

	setContext("publicConfig", data.publicConfig);

	const publicConfig = data.publicConfig;
	const client = useAPIClient();

	const convsStore = createConversationsStore();
	// Cross-conversation generation liveness: the watcher (mounted below) feeds both.
	createActiveGenerationsStore();
	createNotificationsStore();
	// Synchronous seed for SSR: $effect is stripped by the server-side compiler,
	// so we must call init() immediately to populate the list on first paint.
	// The $effect below handles client-side resyncs when data.conversations
	// reference changes after subsequent invalidations.
	// Last-write-wins from server is acceptable; see conversations.svelte.ts.
	convsStore.init(data.conversations);

	$effect(() => {
		convsStore.init(data.conversations);
	});

	let isNavCollapsed = $state(false);

	let errorToastTimeout: ReturnType<typeof setTimeout>;
	let currentError: string | undefined = $state();

	async function onError() {
		// If a new different error comes, wait for the current error to hide first
		if ($error && currentError && $error !== currentError) {
			clearTimeout(errorToastTimeout);
			currentError = undefined;
			await new Promise((resolve) => setTimeout(resolve, 300));
		}

		currentError = $error;

		errorToastTimeout = setTimeout(() => {
			$error = undefined;
			currentError = undefined;
		}, 5000);
	}

	async function deleteConversation(id: string) {
		client
			.conversations({ id })
			.delete()
			.then(handleResponse)
			.then(async () => {
				convsStore.remove(id);

				if (page.params.id === id) {
					await goto(`${base}/`, { invalidateAll: true });
				}
			})
			.catch((err) => {
				console.error(err);
				$error = String(err);
			});
	}

	async function editConversationTitle(id: string, title: string) {
		client
			.conversations({ id })
			.patch({ title })
			.then(handleResponse)
			.then(async () => {
				convsStore.update(id, { title });
			})
			.catch((err) => {
				console.error(err);
				$error = String(err);
			});
	}

	function closeWelcomeModal() {
		if (requireAuthUser()) return;
		settings.set({ welcomeModalSeen: true });
	}

	// Global keyboard shortcut: New Chat (Ctrl/Cmd + Shift + O)
	const onKeydown = (e: KeyboardEvent) => {
		// Ignore when a modal has focus (app is inert)
		const appEl = document.getElementById("app");
		if (appEl?.hasAttribute("inert")) return;

		const oPressed = e.key?.toLowerCase() === "o";
		const metaOrCtrl = e.metaKey || e.ctrlKey;
		if (oPressed && e.shiftKey && metaOrCtrl) {
			e.preventDefault();
			isAborted.set(true);
			if (requireAuthUser()) return;
			goto(`${base}/`, { invalidateAll: true });
		}
	};

	onDestroy(() => {
		clearTimeout(errorToastTimeout);
		if (browser) window.removeEventListener("keydown", onKeydown, { capture: true });
	});

	$effect(() => {
		if ($error) onError();
	});

	const settings = createSettingsStore(data.settings);

	// Theme runtime (THEMES.md §9): seeded from the SSR-resolved values so the
	// runtime state matches the server-rendered chrome from the first frame.
	// Theme changes made through the runtime (picker, sidebar toggle, deep
	// link) flow back into the debounced settings save via `persist`.
	initThemeRuntime({
		id: data.uiTheme,
		preference: data.uiThemeMode,
		mode: data.uiThemeMode === "light" ? "light" : "dark",
		manifest: resolveManifest(data.uiTheme),
		externalThemes: data.externalThemes,
		persist: (id, preference) => {
			void settings.set({ uiTheme: id, uiThemeMode: preference });
		},
	});

	// Reconciliation (THEMES.md §9.2b): the server rendered its best effort —
	// it cannot see `prefers-color-scheme`, and a brand-new device has no
	// ui-theme cookie yet.
	//
	// - Account theme (source === "account"): the account wins. If the DOM
	//   disagrees (theme id or resolved mode), re-apply after hydration — the
	//   documented one-frame correction. Skip persistence: the account already
	//   holds these values.
	// - No account theme: the pre-paint bootstrap already resolved
	//   localStorage (including the migrated legacy key) — hydration must NOT
	//   override it. Adopt the stored preference into the runtime state so
	//   subscribers (iframe panes, toggle icon) see the applied mode.
	if (browser) {
		const html = document.documentElement;
		if (data.uiThemeSource === "account") {
			const domDark = html.classList.contains("dark");
			const modeMismatch =
				data.uiThemeMode !== undefined && domDark !== (getActiveTheme().mode === "dark");
			if (html.dataset.theme !== data.uiTheme || modeMismatch) {
				reconcileFromServer(data.uiTheme, data.uiThemeMode);
			}
		} else {
			// Anonymous: adopt the preference the pre-paint bootstrap resolved —
			// same precedence (cookie → localStorage → legacy), so hydration
			// never contradicts the first paint.
			const cookieMode = document.cookie
				.split("; ")
				.find((c) => c.startsWith("ui-mode="))
				?.slice("ui-mode=".length);
			const valid = (v: string | undefined): ThemeModePreference | undefined =>
				v === "light" || v === "dark" || v === "system" ? v : undefined;
			const storedTheme = localStorage.getItem("ui-theme");
			const preference =
				valid(cookieMode) ??
				valid(localStorage.getItem("ui-mode") ?? undefined) ??
				valid(localStorage.getItem("theme") ?? undefined);
			if (storedTheme || preference) {
				reconcileFromServer(storedTheme ?? data.uiTheme, preference);
			}
		}
	}

	// Chrome/labels/structure derive from the RUNTIME manifest, so a theme
	// switch via setTheme() is coherent without a reload (finding M2). The
	// SSR themeMeta only seeds the pre-hydration frame.
	const themeMeta = $derived.by(() => {
		const m = getActiveTheme().manifest;
		const chrome = resolveChrome(m);
		const fallback = data.themeMeta.labels;
		return {
			id: m.id,
			name: m.name,
			modes: m.modes,
			chrome,
			labels: {
				modelsReady: m.labels.modelsReady ?? fallback.modelsReady,
				modelsWaiting: m.labels.modelsWaiting ?? fallback.modelsWaiting,
				streaming: m.labels.streaming ?? fallback.streaming,
				idle: m.labels.idle ?? fallback.idle,
				models: m.labels.models ?? fallback.models,
				modelsOne: m.labels.modelsOne ?? fallback.modelsOne,
				mcp: m.labels.mcp ?? fallback.mcp,
				mcpOff: m.labels.mcpOff ?? fallback.mcpOff,
				introTagline: m.labels.introTagline ?? fallback.introTagline,
			},
		};
	});

	const slackMcpSync = $derived(Boolean(data.slackMcpSync));
	$effect(() => {
		// `saved` is read once: a refreshed flag must not restart sync and drop a pending write
		if (browser && data.user?.id && slackMcpSync)
			return syncMcpSelection(data.user.id, {
				saved: untrack(() => data.slackMcpSync?.saved) ?? false,
			});
	});

	$effect(() => {
		setHapticsEnabled($settings.hapticsEnabled);
	});

	onMount(async () => {
		// Seed the MCP store from the SSR payload before anything else runs.
		// onMount never fires during SSR, so this matches the server-rendered HTML
		// (stores at defaults) and avoids hydration mismatches in NavMenu / ChatWindow.
		// The layout onMount fires after child onMounts (Svelte 5 order), but that
		// is fine: writeMessage's mcpServersLoaded gate is an async Promise/subscriber,
		// so when initWithServers sets mcpServersLoaded=true synchronously here, the
		// subscriber resolves immediately without any added network latency.
		initWithServers(data.mcpBaseServers ?? []);

		if (publicConfig.isHuggingChat && data.user?.username) {
			fetch(`https://huggingface.co/api/users/${data.user.username}/overview`)
				.then((res) => res.json())
				.then((userData) => {
					isPro.set(userData.isPro ?? false);
				})
				.catch(() => {
					// Keep isPro as null on error - don't show any badge if status is unknown
				});
		}

		if (page.url.searchParams.has("model")) {
			await settings
				.instantSet({
					activeModel: page.url.searchParams.get("model") ?? $settings.activeModel,
				})
				.then(async () => {
					const query = new URLSearchParams(page.url.searchParams.toString());
					query.delete("model");
					await goto(`${base}/?${query.toString()}`, {
						invalidateAll: true,
					});
				});
		}

		// ?theme=<id> deep link (THEMES.md §9.3): apply + persist like ?model=,
		// then strip the parameter in place (any route). Unknown ids are
		// coerced by the runtime.
		if (page.url.searchParams.has("theme")) {
			const requested = page.url.searchParams.get("theme");
			setTheme(requested ?? "lcars", getActiveTheme().preference ?? "dark");
			const query = new URLSearchParams(page.url.searchParams.toString());
			query.delete("theme");
			const qs = query.toString();
			await goto(`${page.url.pathname}${qs ? `?${qs}` : ""}`, { invalidateAll: true });
		}

		if (page.url.searchParams.has("token")) {
			const token = page.url.searchParams.get("token");

			await fetch(`${base}/api/user/validate-token`, {
				method: "POST",
				body: JSON.stringify({ token }),
			}).then(() => {
				goto(`${base}/`, { invalidateAll: true });
			});
		}

		window.addEventListener("keydown", onKeydown, { capture: true });
	});

	let mobileNavTitle = $derived(
		["/models", "/privacy"].includes(page.route.id ?? "")
			? ""
			: convsStore.list.find((conv) => conv.id === page.params.id)?.title
	);

	// Show the welcome modal once on first app load
	let showWelcome = $derived(
		!$settings.welcomeModalSeen &&
			!page.data.slackThreadUrl &&
			!(page.data.shared === true && page.route.id?.startsWith("/conversation/"))
	);

	// Shared conversation views define their own social preview tags
	// (see SharePreviewTags.svelte), so skip the generic ones there
	let isSharedConversationView = $derived(
		page.route.id === "/r/[id]" ||
			(page.route.id === "/conversation/[id]" && page.params.id?.length === 7)
	);
</script>

<svelte:head>
	<title>{publicConfig.PUBLIC_APP_NAME} - Chat with AI models</title>
	<meta name="description" content={publicConfig.PUBLIC_APP_DESCRIPTION} />
	<meta name="twitter:site" content="@huggingface" />

	<!-- use those meta tags everywhere except on special listing pages -->
	<!-- feel free to refacto if there's a better way -->
	{#if !page.url.pathname.includes("/models/") && !isSharedConversationView}
		<meta name="twitter:card" content="summary_large_image" />
		<meta name="twitter:title" content="{publicConfig.PUBLIC_APP_NAME} - Chat with AI models" />
		<meta name="twitter:description" content={publicConfig.PUBLIC_APP_DESCRIPTION} />
		<meta
			name="twitter:image"
			content="{publicConfig.PUBLIC_ORIGIN ||
				page.url.origin}{publicConfig.assetPath}/thumbnail.png"
		/>
		<meta name="twitter:image:alt" content="{publicConfig.PUBLIC_APP_NAME} preview" />
		<meta property="og:title" content="{publicConfig.PUBLIC_APP_NAME} - Chat with AI models" />
		<meta property="og:type" content="website" />
		<meta property="og:url" content="{publicConfig.PUBLIC_ORIGIN || page.url.origin}{base}" />
		<meta property="og:image" content="{publicConfig.assetPath}/thumbnail.png" />
		<meta property="og:description" content={publicConfig.PUBLIC_APP_DESCRIPTION} />
		<meta property="og:site_name" content={publicConfig.PUBLIC_APP_NAME} />
		<meta property="og:locale" content="en_US" />
	{/if}
	<link rel="icon" href="{publicConfig.assetPath}/icon.svg" type="image/svg+xml" />
	{#if publicConfig.PUBLIC_ORIGIN}
		<link
			rel="icon"
			href="{publicConfig.assetPath}/favicon.svg"
			type="image/svg+xml"
			media="(prefers-color-scheme: light)"
		/>
		<link
			rel="icon"
			href="{publicConfig.assetPath}/favicon-dark.svg"
			type="image/svg+xml"
			media="(prefers-color-scheme: dark)"
		/>
	{:else}
		<link rel="icon" href="{publicConfig.assetPath}/favicon-dev.svg" type="image/svg+xml" />
	{/if}
	<link rel="apple-touch-icon" href="{publicConfig.assetPath}/apple-touch-icon.png" />
	<link rel="manifest" href="{publicConfig.assetPath}/manifest.json" />

	{#if publicConfig.PUBLIC_PLAUSIBLE_SCRIPT_URL}
		<script async src={publicConfig.PUBLIC_PLAUSIBLE_SCRIPT_URL}></script>
	{/if}

	{#if publicConfig.PUBLIC_APPLE_APP_ID}
		<meta name="apple-itunes-app" content={`app-id=${publicConfig.PUBLIC_APPLE_APP_ID}`} />
	{/if}
</svelte:head>

{#if showWelcome}
	<WelcomeModal close={closeWelcomeModal} />
{/if}

<NavigationLoadingBar />

<div
	class="fixed grid h-dvh w-screen grid-cols-1 grid-rows-[auto_1fr] overflow-hidden bg-ui-paper text-smd text-ui-ink {!isNavCollapsed
		? 'md:grid-cols-[260px_1fr]'
		: 'md:grid-cols-[0px_1fr]'} transition-[300ms] [transition-property:grid-template-columns] md:grid-rows-[1fr] md:gap-x-2"
>
	<ExpandNavigation
		isCollapsed={isNavCollapsed}
		onClick={() => (isNavCollapsed = !isNavCollapsed)}
		classNames="absolute inset-y-0 z-10 my-auto {!isNavCollapsed
			? 'left-[260px]'
			: 'left-0'} *:transition-transform"
	/>

	<MobileNav title={mobileNavTitle}>
		<NavMenu
			conversations={convsStore.list}
			user={data.user}
			ondeleteConversation={(id) => deleteConversation(id)}
			oneditConversationTitle={(payload) => editConversationTitle(payload.id, payload.title)}
		/>
	</MobileNav>
	<nav
		class="grid max-h-dvh grid-cols-1 grid-rows-[auto_1fr_auto] overflow-hidden *:w-[260px] max-md:hidden"
	>
		<NavMenu
			conversations={convsStore.list}
			user={data.user}
			ondeleteConversation={(id) => deleteConversation(id)}
			oneditConversationTitle={(payload) => editConversationTitle(payload.id, payload.title)}
		/>
	</nav>
	{#if currentError}
		<Toast message={currentError} />
	{/if}
	<GenerationLiveWatcher />
	<NotificationToasts />
	<!-- The LCARS "screen": the page content sits on the rounded display panel,
	     inset from the paper like the design mockups. Themes with
	     structure !== "lcars" render children directly on the page (classic
	     looks like the pre-LCARS layout; office wraps its own document page). -->
	<div class="relative flex min-h-0 min-w-0 flex-col max-md:p-2 md:py-2 md:pr-2">
		{#if themeMeta.chrome.structure === "lcars"}
			<div
				class="ui-screen min-h-0 flex-1 overflow-hidden rounded-[18px] md:rounded-(--ui-radius-xl)"
			>
				{@render children?.()}
			</div>
		{:else}
			<div class="ui-screen min-h-0 flex-1 overflow-hidden">
				{@render children?.()}
			</div>
		{/if}
		<!-- Bottom status strip. Real data, hidden below 860px like the mockups.
		     Visibility and copy come from the active theme's chrome/labels
		     (THEMES.md §7); LCARS keeps both at their original values. -->
		{#if themeMeta.chrome.statusStrip !== "hidden"}
			<div class="mt-2 hidden h-[38px] flex-none gap-2 min-[860px]:flex">
				<div
					class="ui-cap-up flex flex-[2] items-center justify-center bg-ui-lilac px-4 text-ui-on-lilac"
					title={data.modelsReady
						? "The model upstream is answering"
						: "The model upstream has not answered yet"}
				>
					<span class="ui-label font-bold">
						{data.modelsReady ? themeMeta.labels.modelsReady : themeMeta.labels.modelsWaiting}
					</span>
				</div>
				<div
					class="ui-cap-up flex flex-1 items-center justify-center bg-ui-sky px-4 text-ui-on-sky"
				>
					<span class="ui-label font-bold">
						{$loading ? themeMeta.labels.streaming : themeMeta.labels.idle}
					</span>
				</div>
				<div
					class="ui-cap-up flex flex-[1.4] items-center justify-center bg-ui-peach px-4 text-ui-on-peach"
				>
					<span class="ui-label font-bold">
						{data.models.filter((m) => !m.unlisted).length === 1
							? themeMeta.labels.modelsOne
							: themeMeta.labels.models.replace(
									"{count}",
									String(data.models.filter((m) => !m.unlisted).length)
								)}
					</span>
				</div>
				<div
					class="ui-cap-up flex flex-[0.55] items-center justify-center bg-ui-amber px-3 text-ui-on-amber"
				>
					<span class="ui-label font-bold">
						{$enabledServersCount > 0
							? themeMeta.labels.mcp.replace("{count}", String($enabledServersCount))
							: themeMeta.labels.mcpOff}
					</span>
				</div>
			</div>
		{/if}
	</div>

	{#if publicConfig.PUBLIC_PLAUSIBLE_SCRIPT_URL}
		<script>
			((window.plausible =
				window.plausible ||
				function () {
					(plausible.q = plausible.q || []).push(arguments);
				}),
				(plausible.init =
					plausible.init ||
					function (i) {
						plausible.o = i || {};
					}));
			plausible.init();
		</script>
	{/if}
</div>
