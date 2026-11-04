<!--
	Deployments dashboard in Vue 3 with @heroui/styles. The layout and classes match the React example.
	Vue has no HeroUI components, so this file uses native elements with the kit's classes.
-->
<script setup lang="ts">
import { buttonVariants, chipVariants } from "@heroui/styles";
import { computed, onMounted, ref } from "vue";

type DeploymentStatus = "ready" | "building" | "failed";

type Deployment = {
	id: string;
	project: string;
	branch: string;
	status: DeploymentStatus;
	durationSec: number;
};

type PageState =
	| { kind: "loading" }
	| { kind: "error"; message: string }
	| { kind: "ready"; deployments: Deployment[] };

// Replace with a real request. Parse the response here so the template can trust the type.
async function getDeployments(): Promise<Deployment[]> {
	return [
		{ id: "d_1", project: "api-gateway", branch: "main", status: "ready", durationSec: 42 },
		{ id: "d_2", project: "web", branch: "fix/checkout-total", status: "building", durationSec: 18 },
		{ id: "d_3", project: "worker", branch: "main", status: "failed", durationSec: 77 },
	];
}

const statusChip = {
	ready: { color: "success", label: "Ready" },
	building: { color: "warning", label: "Building" },
	failed: { color: "danger", label: "Failed" },
} as const satisfies Record<DeploymentStatus, { color: "success" | "warning" | "danger"; label: string }>;

const state = ref<PageState>({ kind: "loading" });

onMounted(async () => {
	try {
		state.value = { kind: "ready", deployments: await getDeployments() };
	} catch (e: unknown) {
		state.value = { kind: "error", message: e instanceof Error ? e.message : "Unknown error" };
	}
});

const stats = computed(() => {
	if (state.value.kind !== "ready" || state.value.deployments.length === 0) return [];
	const list = state.value.deployments;
	const failed = list.filter((d) => d.status === "failed").length;
	const avgSec = Math.round(list.reduce((sum, d) => sum + d.durationSec, 0) / list.length);
	return [
		{ label: "Deployments today", value: String(list.length), note: "2 more than yesterday" },
		{ label: "Failed", value: String(failed), note: failed > 0 ? "Check the logs below" : "None today" },
		{ label: "Average build", value: `${avgSec}s`, note: "4s faster than yesterday" },
	];
});
</script>

<template>
	<div class="min-h-dvh bg-background text-foreground">
		<header class="border-b border-separator">
			<div class="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
				<a href="/" class="flex items-center gap-2 text-sm font-semibold">
					<span aria-hidden="true" class="size-5 rounded-md bg-accent" />
					Acme
				</a>
				<nav class="flex gap-4 text-sm">
					<a href="/deployments" aria-current="page" class="text-foreground">Deployments</a>
					<a href="/projects" class="text-muted hover:text-foreground">Projects</a>
					<a href="/billing" class="text-muted hover:text-foreground">Billing</a>
				</nav>
				<span class="avatar avatar--sm ml-auto">
					<span class="avatar__fallback avatar__fallback--default">JR</span>
				</span>
			</div>
		</header>

		<main class="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
			<div class="flex flex-wrap items-end justify-between gap-4">
				<div class="flex flex-col gap-1">
					<h1 class="text-2xl font-semibold tracking-tight">Deployments</h1>
					<p class="text-sm text-muted">
						{{ state.kind === "ready" ? `${state.deployments.length} today across all projects.` : "Today across all projects." }}
					</p>
				</div>
				<button type="button" :class="buttonVariants({ variant: 'primary' })">Deploy now</button>
			</div>

			<div v-if="state.kind === 'loading'" class="grid gap-4 sm:grid-cols-3">
				<div v-for="i in 3" :key="i" class="skeleton skeleton--shimmer h-28 rounded-3xl" />
			</div>

			<div v-else-if="state.kind === 'error'" class="alert alert--danger" role="alert">
				<div class="alert__content">
					<p class="alert__title">Couldn't load deployments</p>
					<p class="alert__description">{{ state.message }}</p>
				</div>
			</div>

			<div
				v-else-if="state.deployments.length === 0"
				class="flex flex-col items-center gap-3 rounded-3xl bg-surface-secondary px-6 py-12 text-center"
			>
				<p class="text-sm font-medium">No deployments yet</p>
				<p class="max-w-sm text-sm text-muted">
					Push to <code class="font-mono">main</code> or run <code class="font-mono">acme deploy</code> to create the first one.
				</p>
				<button type="button" :class="buttonVariants({ variant: 'secondary', size: 'sm' })">Read the deploy guide</button>
			</div>

			<template v-else>
				<div class="grid gap-4 sm:grid-cols-3">
					<article v-for="s in stats" :key="s.label" class="card card--default">
						<div class="card__content flex flex-col gap-1">
							<span class="text-sm text-muted">{{ s.label }}</span>
							<span class="text-3xl font-semibold tabular-nums">{{ s.value }}</span>
							<span class="text-xs text-muted">{{ s.note }}</span>
						</div>
					</article>
				</div>

				<section class="flex flex-col gap-4">
					<h2 class="text-base font-semibold">Recent deployments</h2>
					<div class="table-root table-root--primary">
						<div class="table__scroll-container">
							<table class="table__content min-w-[560px]" aria-label="Recent deployments">
								<thead class="table__header">
									<tr>
										<th class="table__column" scope="col">Project</th>
										<th class="table__column" scope="col">Branch</th>
										<th class="table__column" scope="col">Status</th>
										<th class="table__column" scope="col">Duration</th>
									</tr>
								</thead>
								<tbody class="table__body">
									<tr v-for="d in state.deployments" :key="d.id" class="table__row">
										<th class="table__cell text-start font-normal" scope="row">{{ d.project }}</th>
										<td class="table__cell font-mono text-xs text-muted">{{ d.branch }}</td>
										<td class="table__cell">
											<span :class="chipVariants({ color: statusChip[d.status].color, size: 'sm' }).base()">
												<span class="chip__label">{{ statusChip[d.status].label }}</span>
											</span>
										</td>
										<td class="table__cell tabular-nums">{{ d.durationSec }}s</td>
									</tr>
								</tbody>
							</table>
						</div>
					</div>
				</section>
			</template>
		</main>
	</div>
</template>
