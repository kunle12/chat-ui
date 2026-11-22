<script lang="ts">
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { tick } from "svelte";
	import { DropdownMenu } from "bits-ui";

	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonEdit from "~icons/carbon/edit";
	import BiRobot from "~icons/bi/robot";
	import LucideEllipsis from "~icons/lucide/ellipsis";
	import type { ConvSidebar } from "$lib/types/ConvSidebar";

	import EditConversationModal from "$lib/components/EditConversationModal.svelte";
	import DeleteConversationModal from "$lib/components/DeleteConversationModal.svelte";
	import { requireAuthUser } from "$lib/utils/auth";
	import {
		useActiveGenerationsStore,
		type LiveTurnStatus,
	} from "$lib/stores/activeGenerations.svelte";

	const activeGenerations = useActiveGenerationsStore();

	// One entry per turn status an ML Intern row can be in (idle = no live turn).
	// One hue per state so they read apart at dot size: orange = generating,
	// blue = needs an answer, red = failed, gray = parked on a timer. The two
	// states that move (or want the user) pulse; the settled ones hold still.
	const ML_TURN_BADGE: Record<LiveTurnStatus | "idle", { label: string; dot?: string }> = {
		running: { label: "Generating…", dot: "animate-pulse bg-[#ea580c] dark:bg-[#fb923c]" },
		waiting: { label: "Waiting to resume", dot: "bg-gray-400 dark:bg-gray-500" },
		awaiting_input: {
			label: "Needs your answer",
			dot: "animate-pulse bg-blue-500 dark:bg-blue-400",
		},
		failed: { label: "Failed", dot: "bg-red-500 dark:bg-red-400" },
		idle: { label: "Idle" },
	};

	interface Props {
		conv: ConvSidebar;
		readOnly?: true;
		allowDelete?: boolean;
		ondeleteConversation?: (id: string) => void;
		oneditConversationTitle?: (payload: { id: string; title: string }) => void;
	}

	let {
		conv,
		readOnly,
		allowDelete = false,
		ondeleteConversation,
		oneditConversationTitle,
	}: Props = $props();

	let deleteOpen = $state(false);
	let renameOpen = $state(false);
	let isMenuOpen = $state(false);
	let inlineEditing = $state(false);
	let inlineCancelled = $state(false);
	let inlineTitle = $state("");
	let inputEl: HTMLInputElement | undefined = $state();

	async function startInlineEdit() {
		if (readOnly || requireAuthUser()) return;
		inlineTitle = conv.title;
		inlineCancelled = false;
		inlineEditing = true;
		await tick();
		inputEl?.focus();
		inputEl?.select();
	}

	function commitInlineEdit() {
		if (!inlineEditing || inlineCancelled) return;
		const trimmed = inlineTitle.trim();
		inlineEditing = false;
		if (trimmed && trimmed !== conv.title) {
			oneditConversationTitle?.({ id: conv.id.toString(), title: trimmed });
		}
	}

	function cancelInlineEdit() {
		inlineCancelled = true;
		inlineEditing = false;
	}
</script>

<div
	class="group flex h-8 flex-none items-center gap-1.5 rounded-r-[18px] pr-1.5 pl-0 text-base text-lcars-muted hover:bg-lcars-peach/15 max-sm:h-10 sm:text-sm
		{conv.id === page.params.id ? 'bg-lcars-panel text-lcars-ink' : ''}"
>
	<span
		class="ui-cap-r h-5 w-[3px] flex-none {conv.id === page.params.id
			? 'bg-lcars-amber'
			: conv.mlAssistant
				? 'bg-lcars-sky'
				: conv.managedBy
					? 'bg-lcars-marigold'
					: 'bg-lcars-peach/60'}"
	></span>
	{#if conv.mlAssistant}
		{@const ml = ML_TURN_BADGE[activeGenerations.statusFor(conv.id) ?? "idle"]}
		<!-- The mode's own gold, in the strip's palette. A filled glyph rather than
		     an outline: at 14px a hairline robot in this orange reads as a
		     mis-tinted icon, where a solid one reads as a mark. An icon rather
		     than an "ML" chip, so a run of mode conversations doesn't read as a
		     wall of repeated text. The status dot keeps its own hue and sits
		     beside the mark, so the two never compete for the same pixels. -->
		<span
			class="flex flex-none items-center gap-1 text-[#c2410c] dark:text-[#fdba74]"
			title="ML Intern — {ml.label}"
		>
			<BiRobot class="size-[15px]" />
			{#if ml.dot}
				<span class="size-1.5 rounded-full {ml.dot}"></span>
			{/if}
			<span class="sr-only">ML Intern — {ml.label}</span>
		</span>
	{:else if activeGenerations.has(conv.id)}
		<span
			class="size-1.5 flex-none animate-pulse rounded-full bg-blue-500 dark:bg-blue-400"
			title="Generating…"
			aria-label="Generating"
		></span>
	{/if}
	{#if inlineEditing}
		<input
			bind:this={inputEl}
			type="text"
			value={inlineTitle}
			oninput={(e) => (inlineTitle = (e.currentTarget as HTMLInputElement).value)}
			onkeydown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					commitInlineEdit();
				} else if (e.key === "Escape") {
					e.preventDefault();
					cancelInlineEdit();
				}
			}}
			onblur={commitInlineEdit}
			class="my-0 h-full min-w-0 flex-1 truncate border-none bg-transparent p-0 text-inherit outline-hidden first-letter:uppercase focus:ring-0"
		/>
	{:else}
		<a
			data-sveltekit-noscroll
			data-sveltekit-preload-data="tap"
			href="{base}/conversation/{conv.id}"
			class="min-w-0 flex-1 truncate py-2 pl-1.5 first-letter:uppercase"
			onclick={(e) => {
				if (e.detail >= 2) {
					e.preventDefault();
					startInlineEdit();
				}
			}}
		>
			<span>{conv.title}</span>
		</a>

		{#if !readOnly || allowDelete}
			<DropdownMenu.Root
				bind:open={isMenuOpen}
				onOpenChange={(open) => {
					if (open && requireAuthUser()) {
						isMenuOpen = false;
						return;
					}
					isMenuOpen = open;
				}}
			>
				<DropdownMenu.Trigger
					class="flex h-6 w-6 items-center justify-center rounded-full text-lcars-dim hover:bg-lcars-peach/25 hover:text-lcars-ink data-[state=open]:bg-lcars-peach/25 data-[state=open]:text-lcars-ink md:hidden md:group-hover:flex md:data-[state=open]:flex"
					aria-label="Conversation actions"
					title="More options"
				>
					<LucideEllipsis class="text-sm" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content
						class="z-50 min-w-36 rounded-[14px] border border-lcars-panel-edge bg-lcars-panel/95 p-1 text-lcars-ink shadow-lg backdrop-blur-sm"
						side="bottom"
						align="end"
						sideOffset={4}
						trapFocus={false}
						onCloseAutoFocus={(e) => e.preventDefault()}
						interactOutsideBehavior="defer-otherwise-close"
					>
						{#if !readOnly}
							<DropdownMenu.Item
								class="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-lcars-muted select-none focus-visible:outline-hidden data-highlighted:bg-lcars-peach/20 data-highlighted:text-lcars-ink sm:h-8"
								onSelect={() => (renameOpen = true)}
							>
								<CarbonEdit class="size-4 opacity-90" />
								Rename
							</DropdownMenu.Item>{/if}
						<DropdownMenu.Item
							class="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-red-400 select-none focus-visible:outline-hidden data-highlighted:bg-red-500/10 data-highlighted:text-red-400 sm:h-8"
							onSelect={() => (deleteOpen = true)}
						>
							<CarbonTrashCan class="size-4 opacity-90" />
							Delete
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		{/if}
	{/if}
</div>

<!-- Edit title modal -->
{#if renameOpen}
	<EditConversationModal
		open={renameOpen}
		title={conv.title}
		onclose={() => (renameOpen = false)}
		onsave={(payload) => {
			renameOpen = false;
			oneditConversationTitle?.({ id: conv.id.toString(), title: payload.title });
		}}
	/>
{/if}

<!-- Delete confirmation modal -->
{#if deleteOpen}
	<DeleteConversationModal
		open={deleteOpen}
		title={conv.title}
		onclose={() => (deleteOpen = false)}
		ondelete={() => {
			deleteOpen = false;
			ondeleteConversation?.(conv.id.toString());
		}}
	/>
{/if}
