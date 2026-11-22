<script lang="ts">
	import { loginInNewTab } from "$lib/utils/auth";
	import Modal from "$lib/components/Modal.svelte";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { getActiveTheme } from "$lib/themes/themes.svelte";

	const publicConfig = usePublicConfig();
	const structure = $derived(getActiveTheme().manifest.chrome.structure);

	interface Props {
		close: () => void;
	}

	let { close }: Props = $props();
</script>

<Modal closeOnBackdrop={false} onclose={close} width="max-w-[420px]! m-4!">
	<!-- Welcome modal. structure "classic" renders the original plain dialog
	     (no LCARS access-panel chrome); lcars keeps the peach title bar. -->
	<div class="ui-panel w-full overflow-hidden rounded-(--ui-radius-xl)">
		{#if structure === "classic"}
			<div class="flex flex-col gap-4 px-6 pt-6 pb-6">
				<h2 class="text-2xl font-semibold text-ui-ink">
					Welcome to {publicConfig.PUBLIC_APP_NAME}
				</h2>
				<p class="text-sm leading-relaxed text-ui-muted">
					This is a private AI assistant{publicConfig.PUBLIC_APP_NAME
						? ` — ${publicConfig.PUBLIC_APP_NAME}`
						: ""}.
				</p>
				<button
					class="mt-1 w-full rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
					onclick={close}
				>
					Start chatting
				</button>
			</div>
		{:else}
			<div class="flex items-center justify-between bg-ui-peach px-5 py-3 text-ui-on-peach">
				<span class="ui-label text-[0.625rem] font-bold">Access panel · 01</span>
				<span class="text-xs tracking-[0.3em] text-ui-on-peach/60">●●●</span>
			</div>
			<div class="flex flex-col gap-4 px-6 pt-5 pb-6">
				<span class="ui-kicker text-ui-dim">Identity verification · deck 01</span>
				<h2 class="ui-display -mt-1 text-[34px] leading-none text-ui-ink">Welcome aboard</h2>
				<p class="text-sm leading-relaxed text-ui-muted">
					Welcome to {publicConfig.PUBLIC_APP_NAME}, this is a private AI assistant for kunle12.org.
				</p>
				{#if $loginInNewTab}<p class="text-xs leading-relaxed text-ui-dim">
						Continue signing in in the new tab. If you return here after signing in, reload this
						page. If your browser blocks embedded cookies, use the app in the new tab.
					</p>{/if}
				<button
					class="ui-btn mt-1 w-full bg-ui-amber py-3 text-[0.6875rem] text-ui-on-amber shadow-md"
					onclick={close}
				>
					Start chatting
				</button>
				<div class="flex overflow-hidden rounded-full">
					<div class="flex-1 bg-ui-lilac px-3 py-2 text-center text-ui-on-lilac">
						<span class="ui-label font-bold">Registered crew only</span>
					</div>
					<div class="flex-1 bg-ui-sky px-3 py-2 text-center text-ui-on-sky">
						<span class="ui-label font-bold">Secure</span>
					</div>
				</div>
			</div>
		{/if}
	</div>
</Modal>
