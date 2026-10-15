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

<div class="mx-auto my-20 max-w-xl rounded-xl border p-6 text-center dark:border-gray-700">
	{#if !ready}
		<h2 class="mb-2 text-xl font-semibold">Waiting for the model server</h2>
		<p class="text-gray-600 dark:text-gray-300">
			The model server is not reachable yet. This page will show the models as soon as the server
			comes online.
		</p>
	{:else}
		<h2 class="mb-2 text-xl font-semibold">No models available</h2>
		<p class="text-gray-600 dark:text-gray-300">
			The model server is up but no model is running. Start a model there and it will show up here
			automatically.
		</p>
	{/if}
</div>
