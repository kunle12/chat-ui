<script lang="ts">
	interface Props {
		/**
		 * True once the model upstream has answered. Selects the wording:
		 * "waiting" while the server is unreachable, "no models" once it is up
		 * but has nothing running.
		 */
		ready?: boolean;
	}

	let { ready = false }: Props = $props();
</script>

<!-- LCARS standby panel: the rippling amber beacon from the design mockups,
     with a mono status strip underneath. Full-height wrapper so the beacon
     sits centred on every page that renders it. -->
<div class="flex min-h-full w-full items-center justify-center px-6 py-10">
	<div class="flex w-full max-w-md flex-col items-center text-center">
		<div class="relative grid size-28 place-items-center" aria-hidden="true">
			{#if !ready}
				<span class="ring"></span>
				<span class="ring"></span>
				<span class="ring"></span>
			{/if}
			<span class="lcars-beacon grid size-[76px] place-items-center opacity-90">
				<span class="size-2 rounded-full bg-white/80"></span>
			</span>
		</div>

		<h2 class="lcars-display mt-6 text-[26px] text-lcars-ink">
			{!ready ? "Standing by" : "No models available"}
		</h2>
		<p class="mt-2 max-w-sm text-sm leading-relaxed text-lcars-muted">
			{#if !ready}
				The model server is not reachable yet. This page will show the models as soon as the server
				comes online.
			{:else}
				The model server is up but no model is running. Start a model there and it will show up here
				automatically.
			{/if}
		</p>

		<div class="mt-6 flex overflow-hidden rounded-full">
			<span class="bg-lcars-lilac px-4 py-2 text-lcars-on-lilac">
				<span class="lcars-label font-bold">{!ready ? "Awaiting launch" : "Server online"}</span>
			</span>
			<span class="bg-lcars-sky px-4 py-2 text-lcars-on-sky">
				<span class="lcars-label font-bold">{!ready ? "Auto-retry 5s" : "Idle"}</span>
			</span>
		</div>
	</div>
</div>

<style>
	.ring {
		position: absolute;
		inset: 0;
		border-radius: 9999px;
		border: 2px solid rgba(255, 153, 51, 0.55);
		animation: lcars-ripple 3.6s cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
	}
	.ring:nth-child(2) {
		animation-delay: 1.2s;
		border-color: rgba(232, 117, 28, 0.4);
	}
	.ring:nth-child(3) {
		animation-delay: 2.4s;
		border-color: rgba(255, 204, 153, 0.95);
	}
	@keyframes lcars-ripple {
		0% {
			transform: scale(0.9);
			opacity: 0.85;
		}
		70% {
			opacity: 0;
		}
		100% {
			transform: scale(2.05);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ring {
			animation: none;
			opacity: 0.35;
		}
	}
</style>
