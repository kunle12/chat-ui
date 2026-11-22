<script lang="ts">
	import { loginInNewTab } from "$lib/utils/auth";
	import Modal from "$lib/components/Modal.svelte";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	const publicConfig = usePublicConfig();

	interface Props {
		close: () => void;
	}

	let { close }: Props = $props();
</script>

<Modal closeOnBackdrop={false} onclose={close} width="max-w-[420px]! m-4!">
	<!-- LCARS access panel: peach title bar, display headline, amber action pill. -->
	<div class="ui-panel w-full overflow-hidden rounded-[22px]">
		<div class="flex items-center justify-between bg-lcars-peach px-5 py-3 text-lcars-on-peach">
			<span class="ui-label text-[0.625rem] font-bold">Access panel · 01</span>
			<span class="text-xs tracking-[0.3em] text-lcars-on-peach/60">●●●</span>
		</div>
		<div class="flex flex-col gap-4 px-6 pt-5 pb-6">
			<span class="ui-kicker text-lcars-dim">Identity verification · deck 01</span>
			<h2 class="ui-display -mt-1 text-[34px] leading-none text-lcars-ink">Welcome aboard</h2>
			<p class="text-sm leading-relaxed text-lcars-muted">
				Welcome to {publicConfig.PUBLIC_APP_NAME}, this is a private AI assistant for kunle12.org.
			</p>
			{#if $loginInNewTab}<p class="text-xs leading-relaxed text-lcars-dim">
					Continue signing in in the new tab. If you return here after signing in, reload this page.
					If your browser blocks embedded cookies, use the app in the new tab.
				</p>{/if}
			<button
				class="ui-btn mt-1 w-full bg-lcars-amber py-3 text-[0.6875rem] text-lcars-on-amber shadow-md"
				onclick={close}
			>
				Start chatting
			</button>
			<div class="flex overflow-hidden rounded-full">
				<div class="flex-1 bg-lcars-lilac px-3 py-2 text-center text-lcars-on-lilac">
					<span class="ui-label font-bold">Registered crew only</span>
				</div>
				<div class="flex-1 bg-lcars-sky px-3 py-2 text-center text-lcars-on-sky">
					<span class="ui-label font-bold">Secure</span>
				</div>
			</div>
		</div>
	</div>
</Modal>
