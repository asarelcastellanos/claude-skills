// Deployments dashboard: app shell, page header, stat row, and table section,
// with loading, empty, and error states. Works in Next.js (add "use client") or Vite + React.
import { Alert, Avatar, Button, Card, Chip, Skeleton, Table } from "@heroui/react";
import { useEffect, useState } from "react";

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

// Replace with a real request. Parse the response here so the components can trust the type.
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

export default function Dashboard() {
	const [state, setState] = useState<PageState>({ kind: "loading" });

	useEffect(() => {
		getDeployments()
			.then((deployments) => setState({ kind: "ready", deployments }))
			.catch((e: unknown) =>
				setState({ kind: "error", message: e instanceof Error ? e.message : "Unknown error" }),
			);
	}, []);

	return (
		<div className="min-h-dvh bg-background text-foreground">
			<header className="border-b border-separator">
				<div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
					<a href="/" className="flex items-center gap-2 text-sm font-semibold">
						<span aria-hidden="true" className="size-5 rounded-md bg-accent" />
						Acme
					</a>
					<nav className="flex gap-4 text-sm">
						<a href="/deployments" aria-current="page" className="text-foreground">Deployments</a>
						<a href="/projects" className="text-muted hover:text-foreground">Projects</a>
						<a href="/billing" className="text-muted hover:text-foreground">Billing</a>
					</nav>
					<div className="ml-auto">
						<Avatar size="sm">
							<Avatar.Fallback>JR</Avatar.Fallback>
						</Avatar>
					</div>
				</div>
			</header>

			<main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div className="flex flex-col gap-1">
						<h1 className="text-2xl font-semibold tracking-tight">Deployments</h1>
						<p className="text-sm text-muted">
							{state.kind === "ready" ? `${state.deployments.length} today across all projects.` : "Today across all projects."}
						</p>
					</div>
					<Button variant="primary">Deploy now</Button>
				</div>

				<Body state={state} />
			</main>
		</div>
	);
}

function Body({ state }: { state: PageState }) {
	switch (state.kind) {
		case "loading":
			return (
				<div className="grid gap-4 sm:grid-cols-3">
					{[0, 1, 2].map((i) => (
						<Skeleton key={i} className="h-28 rounded-3xl" />
					))}
				</div>
			);
		case "error":
			return (
				<Alert status="danger">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Title>Couldn't load deployments</Alert.Title>
						<Alert.Description>{state.message}</Alert.Description>
					</Alert.Content>
				</Alert>
			);
		case "ready":
			return state.deployments.length === 0 ? <Empty /> : <Ready deployments={state.deployments} />;
		default: {
			const _exhaustive: never = state;
			return _exhaustive;
		}
	}
}

function Ready({ deployments }: { deployments: Deployment[] }) {
	const failed = deployments.filter((d) => d.status === "failed").length;
	const avgSec = Math.round(deployments.reduce((sum, d) => sum + d.durationSec, 0) / deployments.length);
	const stats = [
		{ label: "Deployments today", value: String(deployments.length), note: "2 more than yesterday" },
		{ label: "Failed", value: String(failed), note: failed > 0 ? "Check the logs below" : "None today" },
		{ label: "Average build", value: `${avgSec}s`, note: "4s faster than yesterday" },
	];

	return (
		<>
			<div className="grid gap-4 sm:grid-cols-3">
				{stats.map((s) => (
					<Card key={s.label}>
						<Card.Content className="flex flex-col gap-1">
							<span className="text-sm text-muted">{s.label}</span>
							<span className="text-3xl font-semibold tabular-nums">{s.value}</span>
							<span className="text-xs text-muted">{s.note}</span>
						</Card.Content>
					</Card>
				))}
			</div>

			<section className="flex flex-col gap-4">
				<h2 className="text-base font-semibold">Recent deployments</h2>
				<Table>
					<Table.ScrollContainer>
						<Table.Content aria-label="Recent deployments" className="min-w-[560px]">
							<Table.Header>
								<Table.Column isRowHeader>Project</Table.Column>
								<Table.Column>Branch</Table.Column>
								<Table.Column>Status</Table.Column>
								<Table.Column>Duration</Table.Column>
							</Table.Header>
							<Table.Body>
								{deployments.map((d) => (
									<Table.Row key={d.id}>
										<Table.Cell>{d.project}</Table.Cell>
										<Table.Cell className="font-mono text-xs text-muted">{d.branch}</Table.Cell>
										<Table.Cell>
											<Chip size="sm" color={statusChip[d.status].color}>
												{statusChip[d.status].label}
											</Chip>
										</Table.Cell>
										<Table.Cell className="tabular-nums">{d.durationSec}s</Table.Cell>
									</Table.Row>
								))}
							</Table.Body>
						</Table.Content>
					</Table.ScrollContainer>
				</Table>
			</section>
		</>
	);
}

function Empty() {
	return (
		<div className="flex flex-col items-center gap-3 rounded-3xl bg-surface-secondary px-6 py-12 text-center">
			<p className="text-sm font-medium">No deployments yet</p>
			<p className="max-w-sm text-sm text-muted">
				Push to <code className="font-mono">main</code> or run <code className="font-mono">acme deploy</code> to create the first one.
			</p>
			<Button variant="secondary" size="sm">Read the deploy guide</Button>
		</div>
	);
}
