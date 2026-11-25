<script lang="ts" module>
	export const titles: { [key: string]: string } = {
		today: "Today",
		week: "This week",
		month: "This month",
		older: "Older",
	} as const;
</script>

<script lang="ts">
	import { base } from "$app/paths";

	import Logo from "$lib/components/icons/Logo.svelte";
	import IconSun from "$lib/components/icons/IconSun.svelte";
	import IconMoon from "$lib/components/icons/IconMoon.svelte";
	import { switchTheme, subscribeToTheme } from "$lib/switchTheme";
	import { isAborted } from "$lib/stores/isAborted";
	import { onDestroy } from "svelte";

	import NavConversationItem from "./NavConversationItem.svelte";
	import type { LayoutData } from "../../routes/$types";
	import type { ConvSidebar } from "$lib/types/ConvSidebar";
	import type { Model } from "$lib/types/Model";
	import { page } from "$app/state";
	import InfiniteScroll from "./InfiniteScroll.svelte";
	import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";
	import { browser } from "$app/environment";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { useAPIClient, handleResponse } from "$lib/APIClient";
	import { requireAuthUser } from "$lib/utils/auth";
	import { enabledServersCount } from "$lib/stores/mcpServers";
	import { isPro } from "$lib/stores/isPro";
	import IconPro from "$lib/components/icons/IconPro.svelte";
	import IconCornerUpLeft from "~icons/lucide/corner-up-left";
	import MCPServerManager from "./mcp/MCPServerManager.svelte";
	import { returnToWorkspace } from "$lib/utils/workspace";

	const publicConfig = usePublicConfig();
	const client = useAPIClient();

	interface Props {
		conversations: ConvSidebar[];
		user: LayoutData["user"];
		p?: number;
		ondeleteConversation?: (id: string) => void;
		oneditConversationTitle?: (payload: { id: string; title: string }) => void;
	}

	let {
		conversations = $bindable(),
		user,
		p = $bindable(0),
		ondeleteConversation,
		oneditConversationTitle,
	}: Props = $props();

	let hasMore = $state(true);

	// Set (e.g. to the kunle_workspace console origin) to show the return pill.
	const workspaceOrigin = publicConfig.PUBLIC_WORKSPACE_ORIGIN;

	function handleWorkspaceClick(e: MouseEvent) {
		// The anchor's href stays as the no-JS / middle-click fallback; a normal
		// click closes the console-spawned tab (or navigates back to the console
		// when the close is refused for a natively-opened tab).
		if (e.button !== 0) return;
		e.preventDefault();
		returnToWorkspace(workspaceOrigin);
	}

	function handleNewChatClick(e: MouseEvent) {
		isAborted.set(true);

		if (requireAuthUser()) {
			e.preventDefault();
		}
	}

	function handleNavItemClick(e: MouseEvent) {
		if (requireAuthUser()) {
			e.preventDefault();
		}
	}

	const dateRanges = [
		new Date().setDate(new Date().getDate() - 1),
		new Date().setDate(new Date().getDate() - 7),
		new Date().setMonth(new Date().getMonth() - 1),
	];

	let groupedConversations = $derived({
		today: conversations.filter(({ updatedAt }) => updatedAt.getTime() > dateRanges[0]),
		week: conversations.filter(
			({ updatedAt }) => updatedAt.getTime() > dateRanges[1] && updatedAt.getTime() < dateRanges[0]
		),
		month: conversations.filter(
			({ updatedAt }) => updatedAt.getTime() > dateRanges[2] && updatedAt.getTime() < dateRanges[1]
		),
		older: conversations.filter(({ updatedAt }) => updatedAt.getTime() < dateRanges[2]),
	});

	const nModels: number = page.data.models.filter((el: Model) => !el.unlisted).length;

	let loadingMore = $state(false);

	async function handleVisible() {
		if (loadingMore) {
			// The loader fires every 250ms while visible; never stack page fetches.
			return;
		}
		loadingMore = true;
		try {
			const page = p + 1;
			const newConvs = await client.conversations
				.get({
					query: {
						p: page,
					},
				})
				.then(handleResponse)
				.then((r) => r.conversations)
				.catch((err) => {
					// A failed page fetch (transient 401/403/500) must not latch
					// hasMore off forever — the loader re-fires while visible.
					console.error("Failed to load more conversations", err);
					return null;
				});

			if (newConvs === null) {
				return;
			}

			if (newConvs.length === 0) {
				hasMore = false;
				return;
			}

			p = page;
			// Dedupe: a concurrent reset (data invalidation) can race the append.
			const known = new Set(conversations.map((c: ConvSidebar) => String(c.id)));
			conversations = [
				...conversations,
				...newConvs.filter((c: ConvSidebar) => !known.has(String(c.id))),
			];
		} finally {
			loadingMore = false;
		}
	}

	$effect(() => {
		if (conversations.length <= CONV_NUM_PER_PAGE) {
			// reset p to 0 if there's only one page of content
			// that would be caused by a data loading invalidation
			p = 0;
		}
	});

	let isDark = $state(false);
	let unsubscribeTheme: (() => void) | undefined;
	let showMcpModal = $state(false);

	if (browser) {
		unsubscribeTheme = subscribeToTheme(({ isDark: nextIsDark }) => {
			isDark = nextIsDark;
		});
	}

	onDestroy(() => {
		unsubscribeTheme?.();
	});
</script>

<div class="sticky top-0 z-10 flex flex-none flex-col gap-1.5 px-2 pt-3 pb-3 max-sm:pt-0">
	<div class="flex items-center gap-2">
		<a
			class="ui-cap-r flex h-10 min-w-0 flex-1 items-center gap-2 bg-ui-peach px-3 text-ui-on-peach select-none"
			href="{publicConfig.PUBLIC_ORIGIN}{base}/"
		>
			<Logo classNames="size-4 flex-none opacity-80 mix-blend-multiply dark:mix-blend-normal" />
			<span class="ui-label truncate text-[0.6875rem] font-bold">
				{publicConfig.PUBLIC_APP_NAME}
			</span>
		</a>
		<a
			href={`${base}/`}
			onclick={handleNewChatClick}
			class="ui-btn h-10 flex-none bg-ui-amber px-3.5 text-ui-on-amber shadow-xs hover:shadow-none"
			title="Ctrl/Cmd + Shift + O"
		>
			+ New Chat
		</a>
	</div>
	{#if workspaceOrigin}
		<a
			href={workspaceOrigin}
			onclick={handleWorkspaceClick}
			class="ui-cap-r flex h-7 flex-none items-center gap-2 bg-ui-sky/25 px-3 text-ui-on-sky hover:bg-ui-sky/40"
			title="Close this tab and return to the workspace console"
		>
			<span class="ui-label min-w-0 flex-1 truncate text-[0.625rem]">Workspace</span>
			<IconCornerUpLeft class="size-3 flex-none" />
		</a>
	{/if}
</div>

<div
	class="ui-panel scrollbar-custom flex touch-pan-y flex-col gap-1 overflow-y-auto rounded-r-[22px] border-l-0 px-2.5 pt-2 pb-3 text-[.9rem]"
>
	<div class="flex flex-col gap-0.5">
		{#each Object.entries(groupedConversations) as [group, convs]}
			{#if convs.length}
				<h4 class="ui-label mt-4 mb-1.5 flex items-center gap-2 pl-1 text-ui-dim first:mt-0">
					<span class="ui-cap-r h-[5px] w-3.5 flex-none bg-ui-sky"></span>
					{titles[group]}
				</h4>
				{#each convs as conv (String(conv.id))}
					<NavConversationItem
						readOnly={conv.managedBy ? true : undefined}
						allowDelete={!!conv.managedBy}
						{conv}
						{oneditConversationTitle}
						{ondeleteConversation}
					/>
				{/each}
			{/if}
		{/each}
	</div>
	{#if hasMore}
		<InfiniteScroll onvisible={handleVisible} />
	{/if}
</div>
<div
	class="flex touch-none flex-col gap-0.5 rounded-r-[22px] border-l-0 px-2.5 py-2 text-base sm:text-sm"
>
	{#if user?.username || user?.email}
		<div class="group flex h-9 items-center gap-2 rounded-lg px-2 max-sm:h-10">
			<img
				src="https://huggingface.co/api/users/{user.username}/avatar?redirect=true"
				class="size-5 rounded-[7px] border border-ui-panel-edge bg-gray-500"
				alt=""
			/>
			{#if publicConfig.isHuggingChat && user?.username}
				<a
					href="https://huggingface.co/{user.username}"
					target="_blank"
					rel="noopener noreferrer"
					class="ui-label min-w-0 truncate text-[0.625rem] text-ui-muted hover:underline"
					>{user.username}</a
				>
			{:else}
				<span class="ui-label min-w-0 truncate text-[0.625rem] text-ui-muted"
					>{user?.username || user?.email}</span
				>
			{/if}

			{#if publicConfig.isHuggingChat && $isPro === false}
				<a
					href="https://huggingface.co/subscribe/pro?from=HuggingChat"
					target="_blank"
					rel="noopener noreferrer"
					class="ui-chip ml-auto text-[0.5625rem] text-ui-muted"
				>
					<IconPro />
					Get PRO
				</a>
			{:else if publicConfig.isHuggingChat && $isPro === true}
				<span class="ui-chip ml-auto text-ui-muted">
					<IconPro />
					PRO
				</span>
			{/if}
		</div>
	{/if}
	<a
		href="{base}/models"
		class="flex h-8 flex-none items-center gap-1.5 rounded-full px-2.5 text-ui-muted hover:bg-ui-panel hover:text-ui-ink max-sm:h-10"
		onclick={handleNavItemClick}
	>
		<span class="ui-label text-[0.625rem]">Models</span>
		<span class="ui-chip ml-auto bg-ui-sky/25 text-ui-on-sky">{nModels}</span>
	</a>

	{#if user?.username || user?.email}
		<button
			onclick={() => (showMcpModal = true)}
			class="flex h-8 flex-none items-center gap-1.5 rounded-full px-2.5 text-ui-muted hover:bg-ui-panel hover:text-ui-ink max-sm:h-10"
		>
			<span class="ui-label text-[0.625rem]">MCP Servers</span>
			{#if $enabledServersCount > 0}
				<span class="ui-chip ml-auto bg-ui-sky/25 text-ui-on-sky">
					{$enabledServersCount}
				</span>
			{/if}
		</button>
	{/if}

	<span class="flex gap-0.5">
		<a
			href="{base}/settings/application"
			class="flex h-8 flex-none grow items-center gap-1.5 rounded-full px-2.5 text-ui-muted hover:bg-ui-panel hover:text-ui-ink max-sm:h-10"
			onclick={handleNavItemClick}
		>
			<span class="ui-label text-[0.625rem]">Settings</span>
		</a>
		<button
			onclick={() => {
				switchTheme();
			}}
			aria-label="Toggle theme"
			class="flex size-8 min-w-[1.5em] flex-none items-center justify-center rounded-full p-2 text-ui-muted hover:bg-ui-panel hover:text-ui-ink max-sm:size-10"
		>
			{#if browser}
				{#if isDark}
					<IconSun />
				{:else}
					<IconMoon />
				{/if}
			{/if}
		</button>
	</span>
</div>

{#if showMcpModal}
	<MCPServerManager onclose={() => (showMcpModal = false)} />
{/if}
