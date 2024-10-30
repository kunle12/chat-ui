<script lang="ts">
	import { env as envPublic } from "$env/dynamic/public";
	import Logo from "$lib/components/icons/Logo.svelte";
	import { createEventDispatcher } from "svelte";
	import IconGear from "~icons/bi/gear-fill";
	import AnnouncementBanner from "../AnnouncementBanner.svelte";
	import type { Model } from "$lib/types/Model";
	import ModelCardMetadata from "../ModelCardMetadata.svelte";
	import { base } from "$app/paths";
	import JSON5 from "json5";

	export let currentModel: Model;

	const announcementBanners = envPublic.PUBLIC_ANNOUNCEMENT_BANNERS
		? JSON5.parse(envPublic.PUBLIC_ANNOUNCEMENT_BANNERS)
		: [];

	const dispatch = createEventDispatcher<{ message: string }>();
</script>

<div class="my-auto grid gap-8 lg:grid-cols-2">
	<div class="lg:col-span-3">
		<div>
			<div class="mb-3 flex items-center text-2xl font-semibold">
				<Logo classNames="mr-1 flex-none" />
				{envPublic.PUBLIC_APP_NAME}
			</div>
			<p class="text-base text-gray-600 dark:text-gray-400">
				{envPublic.PUBLIC_APP_DESCRIPTION ||
					"Making the community's best AI chat models available to everyone."}
			</p>
		</div>
	</div>
	<div class="lg:col-span-2 lg:pl-24">
		{#each announcementBanners as banner}
			<AnnouncementBanner classNames="mb-4" title={banner.title}>
				<a
					target="_blank"
					href={banner.linkHref}
					class="mr-2 flex items-center underline hover:no-underline">{banner.linkTitle}</a
				>
			</AnnouncementBanner>
		{/each}
	</div>
	{#if currentModel.promptExamples}
		<div class="lg:col-span-3 lg:mt-6">
			<p class="mb-3 text-gray-600 dark:text-gray-300">Examples</p>
			<div class="grid gap-3 lg:grid-cols-3 lg:gap-5">
				{#each currentModel.promptExamples as example}
					<button
						type="button"
						class="rounded-xl border bg-gray-50 p-3 text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 max-xl:text-sm xl:p-3.5"
						on:click={() => dispatch("message", example.prompt)}
					>
						{example.title}
					</button>
				{/each}
			</div>
		</div>{/if}
	<div class="h-40 sm:h-24" />
</div>
