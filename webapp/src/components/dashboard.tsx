"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MetricSnapshot,
  mockMetricSnapshot,
  RepoMetric,
  EngineerMetric,
  HighImpactPR,
} from "@/lib/sample-data";

type FetchPayload = {
  org?: string;
  repos?: string[];
  range?: string;
  since?: string;
  until?: string;
};

type DashboardProps = {
  defaultOrg?: string;
  defaultRangeDays?: number;
};

const formatter = new Intl.NumberFormat("en-US");

function sum<T>(collection: T[], selector: (item: T) => number) {
  return collection.reduce((acc, item) => acc + selector(item), 0);
}

function average<T>(collection: T[], selector: (item: T) => number) {
  if (collection.length === 0) return 0;
  return sum(collection, selector) / collection.length;
}

async function fetchMetrics(payload: FetchPayload) {
  const response = await fetch("/api/repo-metrics", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to load metrics (${response.status})`);
  }

  const data = await response.json();
  if (data?.fallback) {
    return {
      snapshot: data.fallback as MetricSnapshot,
      notice: data.error as string,
      usedFallback: true,
    };
  }

  return {
    snapshot: data as MetricSnapshot,
    notice: null,
    usedFallback: false,
  };
}

function SummaryCard({
  title,
  value,
  delta,
  badge,
}: {
  title: string;
  value: string;
  delta?: string;
  badge?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/60 p-5 shadow-sm backdrop-blur-sm transition hover:border-blue-200 hover:shadow">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-500">{title}</span>
        {badge ? (
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-3xl font-semibold text-slate-900">{value}</p>
      {delta ? (
        <p className="mt-2 text-sm font-medium text-emerald-600">{delta}</p>
      ) : null}
    </div>
  );
}

function RepoTable({ repos }: { repos: RepoMetric[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Repositories
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Activity and health across tracked repos
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3 font-semibold">Repo</th>
              <th className="px-6 py-3 font-semibold">Merged PRs</th>
              <th className="px-6 py-3 font-semibold">Commits</th>
              <th className="px-6 py-3 font-semibold">Lines ±</th>
              <th className="px-6 py-3 font-semibold">Lead Time</th>
              <th className="px-6 py-3 font-semibold">Health</th>
              <th className="px-6 py-3 font-semibold">Languages</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {repos.map((repo) => {
              const net = repo.linesAdded - repo.linesDeleted;
              return (
                <tr key={repo.fullName} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-900">
                        {repo.fullName}
                      </span>
                      <span className="text-xs text-slate-500">
                        {repo.activeContributors} active contributors
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-semibold text-slate-900">
                      {formatter.format(repo.mergedPRs)}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {repo.openPRs} open
                    </span>
                  </td>
                  <td className="px-6 py-4">{formatter.format(repo.commits)}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-emerald-600">
                        +{formatter.format(repo.linesAdded)}
                      </span>
                      <span className="text-xs text-rose-500">
                        -{formatter.format(repo.linesDeleted)}
                      </span>
                      <span className="text-xs text-slate-500">
                        Net {net >= 0 ? "+" : "-"}
                        {formatter.format(Math.abs(net))}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {repo.averageLeadTimeHours}h avg
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 rounded-full bg-slate-200">
                        <div
                          className="h-1.5 rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${repo.healthScore}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-slate-700">
                        {repo.healthScore}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {repo.languages.slice(0, 4).map((language) => (
                        <span
                          key={`${repo.fullName}-${language}`}
                          className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
                        >
                          {language}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EngineerTable({ engineers }: { engineers: EngineerMetric[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Engineer Impact
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Cycle time, activity, and impact weighted across repos
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3 font-semibold">Engineer</th>
              <th className="px-6 py-3 font-semibold">Impact</th>
              <th className="px-6 py-3 font-semibold">Merged PRs</th>
              <th className="px-6 py-3 font-semibold">Commits</th>
              <th className="px-6 py-3 font-semibold">Lines ±</th>
              <th className="px-6 py-3 font-semibold">Cycle Time</th>
              <th className="px-6 py-3 font-semibold">Repos</th>
              <th className="px-6 py-3 font-semibold">Last Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {engineers.map((engineer) => (
              <tr key={engineer.engineer} className="hover:bg-slate-50">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                      {engineer.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={engineer.avatarUrl}
                          alt={engineer.engineer}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-500">
                          {engineer.engineer.charAt(0)}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-900">
                        {engineer.engineer}
                      </span>
                      <span className="text-xs text-slate-500">
                        {engineer.repos.join(", ")}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-slate-200">
                      <div
                        className="h-1.5 rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${Math.min(engineer.impactScore, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-slate-800">
                      {Math.round(engineer.impactScore)}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4">{engineer.mergedPRs}</td>
                <td className="px-6 py-4">{engineer.commits}</td>
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-emerald-600">
                      +{formatter.format(engineer.linesAdded)}
                    </span>
                    <span className="text-xs text-rose-500">
                      -{formatter.format(engineer.linesDeleted)}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  {engineer.avgCycleTimeHours || "—"}h
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1.5">
                    {engineer.repos.slice(0, 3).map((repo) => (
                      <span
                        key={`${engineer.engineer}-${repo}`}
                        className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
                      >
                        {repo}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-500">
                  {new Date(engineer.lastActive).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HighImpactList({ prs }: { prs: HighImpactPR[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            High-Impact PRs
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Largest code movements merged during the selected window
          </p>
        </div>
      </div>
      <ul className="divide-y divide-slate-100">
        {prs.map((pr) => (
          <li key={pr.id} className="px-6 py-4 hover:bg-slate-50">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-indigo-600 hover:underline"
                >
                  {pr.title}
                </a>
                <p className="text-xs text-slate-500">
                  {pr.repo} • {pr.author}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  Impact
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  +{formatter.format(pr.additions)} / -
                  {formatter.format(pr.deletions)}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>Changed files: {pr.changedFiles}</span>
              <span>Lead time: {pr.leadTimeHours}h</span>
              <span>Merged {new Date(pr.mergedAt).toLocaleDateString()}</span>
              <p className="basis-full text-xs text-slate-600">{pr.summary}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TimelineChart({
  timeline,
}: {
  timeline: MetricSnapshot["timeline"];
}) {
  if (!timeline.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No timeline data for this selection yet.
      </div>
    );
  }

  const maxPRs = Math.max(...timeline.map((t) => t.mergedPRs));
  const maxLines = Math.max(
    ...timeline.map((t) => t.linesAdded + t.linesDeleted),
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Delivery Trend
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Weekly merged PRs and code movement
          </p>
        </div>
      </div>
      <div className="grid gap-6 p-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="relative h-64 w-full">
            <svg
              viewBox="0 0 1000 260"
              xmlns="http://www.w3.org/2000/svg"
              className="h-full w-full text-indigo-500"
            >
              <defs>
                <linearGradient id="prGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity="0.15" />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polyline
                fill="url(#prGradient)"
                stroke="#6366f1"
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={timeline
                  .map((point, index) => {
                    const x =
                      (index / Math.max(1, timeline.length - 1)) * 1000;
                    const y =
                      240 -
                      (point.mergedPRs / Math.max(1, maxPRs)) * 200 -
                      10;
                    return `${x},${y}`;
                  })
                  .join(" ")}
              />
            </svg>
          </div>
        </div>
        <div className="space-y-4">
          {timeline.map((point) => (
            <div
              key={point.week}
              className="rounded-xl border border-slate-100 bg-slate-50 p-4"
            >
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Week of {point.week}
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-900">
                {point.mergedPRs} merged PRs
              </p>
              <div className="mt-3 space-y-2 text-xs text-slate-600">
                <div className="flex items-center justify-between">
                  <span>Commits</span>
                  <span className="font-semibold">
                    {formatter.format(point.commits)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-emerald-600">
                  <span>Lines added</span>
                  <span className="font-semibold">
                    +{formatter.format(point.linesAdded)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-rose-500">
                  <span>Lines deleted</span>
                  <span className="font-semibold">
                    -{formatter.format(point.linesDeleted)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Net change</span>
                  <span className="font-semibold">
                    {formatter.format(
                      point.linesAdded - point.linesDeleted,
                    )}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-indigo-400"
                    style={{
                      width: `${Math.round(
                        ((point.linesAdded + point.linesDeleted) /
                          Math.max(1, maxLines)) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Dashboard({
  defaultOrg = "acme-inc",
  defaultRangeDays = 45,
}: DashboardProps) {
  const [org, setOrg] = useState(defaultOrg);
  const [reposInput, setReposInput] = useState("");
  const [customSince, setCustomSince] = useState<string>("");
  const [customUntil, setCustomUntil] = useState<string>("");
  const [rangeDays, setRangeDays] = useState(defaultRangeDays);
  const [metrics, setMetrics] = useState<MetricSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadMetrics = useCallback(
    async (payload?: Partial<FetchPayload>) => {
      setLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetchMetrics({
          org: org || undefined,
          repos:
            reposInput.trim().length > 0
              ? reposInput
                  .split(",")
                  .map((repo) => repo.trim())
                  .filter(Boolean)
              : undefined,
          range: customSince && customUntil ? undefined : String(rangeDays),
          since: customSince || undefined,
          until: customUntil || undefined,
          ...payload,
        });

        setMetrics(response.snapshot);
        setNotice(response.notice);
      } catch (error) {
        setMetrics(mockMetricSnapshot);
        setErrorMessage(
          (error as Error).message ?? "Unexpected error loading metrics",
        );
      } finally {
        setLoading(false);
      }
    },
    [org, reposInput, rangeDays, customSince, customUntil],
  );

  useEffect(() => {
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    if (!metrics) {
      return {
        totalMergedPRs: 0,
        totalCommits: 0,
        totalLinesAdded: 0,
        totalLinesDeleted: 0,
        activeEngineers: 0,
        averageImpact: 0,
      };
    }

    const totalMergedPRs = sum(metrics.repos, (repo) => repo.mergedPRs);
    const totalCommits = sum(metrics.repos, (repo) => repo.commits);
    const totalLinesAdded = sum(metrics.repos, (repo) => repo.linesAdded);
    const totalLinesDeleted = sum(metrics.repos, (repo) => repo.linesDeleted);
    const activeEngineers = metrics.engineers.length;
    const averageImpact = Math.round(
      average(metrics.engineers, (engineer) => engineer.impactScore),
    );

    return {
      totalMergedPRs,
      totalCommits,
      totalLinesAdded,
      totalLinesDeleted,
      activeEngineers,
      averageImpact,
    };
  }, [metrics]);

  return (
    <div className="min-h-screen bg-slate-950/3 pb-16 text-slate-900">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-6 rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-100/80 p-8 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-indigo-500">
              Engineering Intelligence
            </p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900 lg:text-4xl">
              Repository Performance Control Center
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-600 lg:text-base">
              Track software engineering throughput, impact, and delivery health
              across your GitHub footprint. Plug in your org or specific repos
              to surface cycle time, code movement, and standout pull requests.
            </p>
            {notice ? (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                {notice}
              </p>
            ) : null}
            {errorMessage ? (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
                {errorMessage}
              </p>
            ) : null}
          </div>
          <form
            className="grid w-full max-w-xl grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur-sm lg:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              loadMetrics();
            }}
          >
            <div className="lg:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                GitHub Org / Owner
              </label>
              <input
                type="text"
                value={org}
                onChange={(event) => setOrg(event.target.value)}
                placeholder="acme-inc"
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-inner focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Repos (optional, comma separated owner/name)
              </label>
              <input
                type="text"
                value={reposInput}
                onChange={(event) => setReposInput(event.target.value)}
                placeholder="acme-inc/web-frontend, acme-inc/platform-api"
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-inner focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Rolling Window (days)
              </label>
              <select
                value={rangeDays}
                onChange={(event) => {
                  setRangeDays(Number(event.target.value));
                  setCustomSince("");
                  setCustomUntil("");
                }}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-inner focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                <option value={30}>Last 30 days</option>
                <option value={45}>Last 45 days</option>
                <option value={60}>Last 60 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Or pick a custom range
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={customSince}
                  onChange={(event) => setCustomSince(event.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <input
                  type="date"
                  value={customUntil}
                  onChange={(event) => setCustomUntil(event.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>
            </div>
            <div className="lg:col-span-2">
              <button
                type="submit"
                className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-wait disabled:opacity-70"
                disabled={loading}
              >
                {loading ? "Crunching metrics…" : "Refresh metrics"}
              </button>
            </div>
          </form>
        </header>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            title="Merged Pull Requests"
            value={formatter.format(totals.totalMergedPRs)}
            delta={
              metrics
                ? `${metrics.range.label} • ${metrics.repos.length} repos`
                : undefined
            }
          />
          <SummaryCard
            title="Code Movement"
            value={`+${formatter.format(totals.totalLinesAdded)} / -${formatter.format(
              totals.totalLinesDeleted,
            )}`}
            delta="Additions vs deletions"
          />
          <SummaryCard
            title="Active Engineers"
            value={formatter.format(totals.activeEngineers)}
            badge="Impact Avg"
            delta={`${totals.averageImpact} impact score avg`}
          />
          <SummaryCard
            title="Total Commits"
            value={formatter.format(totals.totalCommits)}
            delta="Across selected repos"
          />
        </section>

        {metrics ? (
          <>
            <TimelineChart timeline={metrics.timeline} />
            <div className="grid gap-8 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <RepoTable repos={metrics.repos} />
              </div>
              <HighImpactList prs={metrics.highImpactPRs} />
            </div>
            <EngineerTable engineers={metrics.engineers} />
          </>
        ) : null}
      </div>
    </div>
  );
}
