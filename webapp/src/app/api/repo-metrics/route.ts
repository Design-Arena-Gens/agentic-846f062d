import { NextResponse } from "next/server";
import {
  MetricSnapshot,
  mockMetricSnapshot,
  RepoMetric,
  EngineerMetric,
  HighImpactPR,
  RangeDescriptor,
} from "@/lib/sample-data";

type GitHubRepo = {
  name: string;
  full_name: string;
  owner: { login: string };
  language: string | null;
  languages_url: string;
};

type GitHubPullRequest = {
  id: number;
  number: number;
  title: string;
  user: { login: string; avatar_url?: string };
  merged_at: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  head: { ref: string };
  base: { ref: string };
  html_url: string;
  draft: boolean;
};

const GITHUB_API = "https://api.github.com";
const DEFAULT_RANGE_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const token = process.env.GITHUB_TOKEN;

async function fetchFromGitHub<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (!token) {
    throw new Error("Missing GITHUB_TOKEN");
  }

  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "repo-performance-dashboard",
      ...(init?.headers ?? {}),
    },
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    const errorMessage = await res.text();
    throw new Error(
      `GitHub API error: ${res.status} ${res.statusText} - ${errorMessage}`,
    );
  }

  return res.json() as Promise<T>;
}

function coerceRange(range: string | undefined) {
  const numericRange = Number(range);
  if (!Number.isFinite(numericRange) || numericRange <= 0) {
    return DEFAULT_RANGE_DAYS;
  }
  return Math.min(90, Math.max(7, Math.floor(numericRange)));
}

function getRangeDayCount(range: RangeDescriptor) {
  const diff =
    new Date(range.until).getTime() - new Date(range.since).getTime();
  return Math.max(1, Math.round(Math.abs(diff) / MILLISECONDS_PER_DAY));
}

function computeRangeDescriptor(
  since?: string,
  until?: string,
  rangeDays?: string,
): RangeDescriptor {
  if (since && until) {
    return {
      since,
      until,
      label: `${since.slice(0, 10)} → ${until.slice(0, 10)}`,
    };
  }

  const now = new Date();
  const days = coerceRange(rangeDays);
  const untilDate = now.toISOString();
  const sinceDate = new Date(
    now.getTime() - days * 24 * 60 * 60 * 1000,
  ).toISOString();

  return {
    since: sinceDate,
    until: untilDate,
    label: `Last ${days} days`,
  };
}

async function listOrgRepos(org: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;
  let shouldContinue = true;

  while (shouldContinue && page <= 5) {
    const chunk = await fetchFromGitHub<GitHubRepo[]>(
      `/orgs/${org}/repos?per_page=100&page=${page}&sort=pushed`,
    );
    repos.push(...chunk);
    shouldContinue = chunk.length === 100;
    page += 1;
  }

  return repos;
}

async function fetchRepoLanguages(repo: GitHubRepo): Promise<string[]> {
  try {
    const data = await fetchFromGitHub<Record<string, number>>(
      `/repos/${repo.full_name}/languages`,
    );
    return Object.keys(data);
  } catch {
    return repo.language ? [repo.language] : [];
  }
}

function withinRange(timestamp: string | null, range: RangeDescriptor) {
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  return (
    time >= new Date(range.since).getTime() &&
    time <= new Date(range.until).getTime()
  );
}

function calculateImpactScore(pr: GitHubPullRequest): number {
  const sizeFactor = Math.min(30, pr.additions + pr.deletions) / 30;
  const filesFactor = Math.min(20, pr.changed_files) / 20;
  const commitsFactor = Math.min(10, pr.commits) / 10;
  const draftPenalty = pr.draft ? 0.9 : 1;
  return Math.round(
    (50 * sizeFactor + 30 * filesFactor + 20 * commitsFactor) * draftPenalty,
  );
}

function aggregateMetrics(
  repoName: string,
  repoOwner: string,
  pullRequests: GitHubPullRequest[],
  range: RangeDescriptor,
): {
  repoMetric: RepoMetric;
  engineerMetrics: EngineerMetric[];
  highImpact: HighImpactPR[];
} {
  const repoMetric: RepoMetric = {
    name: repoName,
    owner: repoOwner,
    fullName: `${repoOwner}/${repoName}`,
    activeContributors: 0,
    mergedPRs: 0,
    openPRs: 0,
    commits: 0,
    linesAdded: 0,
    linesDeleted: 0,
    deploymentFrequency: 0,
    averageLeadTimeHours: 0,
    issuesClosed: 0,
    healthScore: 0,
    languages: [],
  };

  const engineerAccumulator = new Map<string, EngineerMetric>();
  const highImpact: HighImpactPR[] = [];

  pullRequests.forEach((pr) => {
    const author = pr.user?.login ?? "unknown";
    const existing = engineerAccumulator.get(author) ?? {
      engineer: author,
      avatarUrl: pr.user?.avatar_url,
      repos: [],
      mergedPRs: 0,
      commits: 0,
      reviews: 0,
      linesAdded: 0,
      linesDeleted: 0,
      impactScore: 0,
      avgCycleTimeHours: 0,
      avgReviewTurnaroundHours: 0,
      lastActive: pr.updated_at,
    };

    if (!existing.repos.includes(repoName)) {
      existing.repos.push(repoName);
    }

    if (withinRange(pr.merged_at, range)) {
      repoMetric.mergedPRs += 1;
      repoMetric.linesAdded += pr.additions;
      repoMetric.linesDeleted += pr.deletions;
      repoMetric.commits += pr.commits;
      existing.mergedPRs += 1;
      existing.linesAdded += pr.additions;
      existing.linesDeleted += pr.deletions;
      existing.commits += pr.commits;
      existing.impactScore += calculateImpactScore(pr);
      existing.lastActive =
        new Date(pr.updated_at).getTime() >
        new Date(existing.lastActive).getTime()
          ? pr.updated_at
          : existing.lastActive;

      highImpact.push({
        id: pr.id,
        title: pr.title,
        repo: `${repoOwner}/${repoName}`,
        author,
        mergedAt: pr.merged_at!,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        leadTimeHours: Math.max(
          1,
          Math.round(
            (new Date(pr.merged_at!).getTime() -
              new Date(pr.created_at).getTime()) /
              (1000 * 60 * 60),
          ),
        ),
        url: pr.html_url,
        summary: `Merged into ${pr.base.ref} from ${pr.head.ref}`,
      });
    } else {
      repoMetric.openPRs += 1;
    }

    engineerAccumulator.set(author, existing);
  });

  repoMetric.activeContributors = engineerAccumulator.size;
  repoMetric.deploymentFrequency = Math.max(
    1,
    Math.round(repoMetric.mergedPRs / getRangeDayCount(range)),
  );
  repoMetric.averageLeadTimeHours =
    repoMetric.mergedPRs > 0
      ? Math.round(
          pullRequests
            .filter((pr) => withinRange(pr.merged_at, range))
            .reduce((acc, pr) => {
              const leadTime =
                (new Date(pr.merged_at!).getTime() -
                  new Date(pr.created_at).getTime()) /
                (1000 * 60 * 60);
              return acc + leadTime;
            }, 0) / repoMetric.mergedPRs,
        )
      : 0;

  repoMetric.healthScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        repoMetric.mergedPRs * 0.3 +
          repoMetric.deploymentFrequency * 6 +
          Math.max(0, 40 - repoMetric.openPRs * 2),
      ),
    ),
  );

  const engineerMetrics = Array.from(engineerAccumulator.values()).map(
    (entry) => ({
      ...entry,
      avgCycleTimeHours:
        entry.mergedPRs > 0
          ? Math.round(
              pullRequests
                .filter((pr) => pr.user?.login === entry.engineer)
                .filter((pr) => withinRange(pr.merged_at, range))
                .reduce((acc, pr) => {
                  const leadTime =
                    (new Date(pr.merged_at!).getTime() -
                      new Date(pr.created_at).getTime()) /
                    (1000 * 60 * 60);
                  return acc + leadTime;
                }, 0) / entry.mergedPRs,
            )
          : 0,
    }),
  );

  return {
    repoMetric,
    engineerMetrics,
    highImpact: highImpact
      .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
      .slice(0, 10),
  };
}

async function fetchPullRequestsForRepo(
  fullName: string,
  range: RangeDescriptor,
): Promise<GitHubPullRequest[]> {
  const [owner, repo] = fullName.split("/");
  const perPage = 50;
  const pullRequests: GitHubPullRequest[] = [];
  let page = 1;
  let shouldContinue = true;

  while (shouldContinue && page <= 5) {
    const batch = await fetchFromGitHub<GitHubPullRequest[]>(
      `/repos/${owner}/${repo}/pulls?state=all&per_page=${perPage}&page=${page}&sort=updated&direction=desc`,
    );

    for (const pr of batch) {
      if (
        pr.merged_at &&
        new Date(pr.merged_at).getTime() <
          new Date(range.since).getTime() - 1000 * 60 * 60 * 24
      ) {
        shouldContinue = false;
        break;
      }

      const detail = await fetchFromGitHub<GitHubPullRequest>(
        `/repos/${owner}/${repo}/pulls/${pr.number}`,
      );
      pullRequests.push(detail);
    }

    shouldContinue = batch.length === perPage;
    page += 1;
  }

  return pullRequests;
}

async function buildSnapshot(params: {
  org?: string;
  repos?: string[];
  range: RangeDescriptor;
}): Promise<MetricSnapshot> {
  const { org, repos: selectedRepos, range } = params;

  let repos: GitHubRepo[] = [];

  if (selectedRepos && selectedRepos.length > 0) {
    repos = await Promise.all(
      selectedRepos.map(async (fullName) => {
        const [owner, name] = fullName.split("/");
        return {
          ...(await fetchFromGitHub<GitHubRepo>(
            `/repos/${owner}/${name}`,
          )),
          language: null,
        };
      }),
    );
  } else if (org) {
    repos = await listOrgRepos(org);
  } else {
    throw new Error("Either org or repos must be provided");
  }

  const repoMetrics: RepoMetric[] = [];
  const engineerAggregator = new Map<string, EngineerMetric>();
  const timelinePoints: Record<string, { mergedPRs: number; commits: number; linesAdded: number; linesDeleted: number }> =
    {};
  const highImpact: HighImpactPR[] = [];

  for (const repo of repos) {
    const pullRequests = await fetchPullRequestsForRepo(
      repo.full_name,
      range,
    );
    const {
      repoMetric,
      engineerMetrics,
      highImpact: repoHighImpact,
    } = aggregateMetrics(repo.name, repo.owner.login, pullRequests, range);
    repoMetric.languages = await fetchRepoLanguages(repo);
    repoMetrics.push(repoMetric);

    engineerMetrics.forEach((metric) => {
      const existing = engineerAggregator.get(metric.engineer);
      if (existing) {
        engineerAggregator.set(metric.engineer, {
          ...existing,
          mergedPRs: existing.mergedPRs + metric.mergedPRs,
          commits: existing.commits + metric.commits,
          reviews: existing.reviews + metric.reviews,
          linesAdded: existing.linesAdded + metric.linesAdded,
          linesDeleted: existing.linesDeleted + metric.linesDeleted,
          impactScore: existing.impactScore + metric.impactScore,
          avgCycleTimeHours: Math.round(
            (existing.avgCycleTimeHours + metric.avgCycleTimeHours) / 2,
          ),
          avgReviewTurnaroundHours: Math.round(
            (existing.avgReviewTurnaroundHours +
              metric.avgReviewTurnaroundHours) /
              2,
          ),
          lastActive:
            new Date(metric.lastActive).getTime() >
            new Date(existing.lastActive).getTime()
              ? metric.lastActive
              : existing.lastActive,
          repos: Array.from(new Set([...existing.repos, ...metric.repos])),
        });
      } else {
        engineerAggregator.set(metric.engineer, metric);
      }
    });

    pullRequests
      .filter((pr) => withinRange(pr.merged_at, range))
      .forEach((pr) => {
        const weekStart = new Date(pr.merged_at!);
        const monday = new Date(weekStart);
        const day = weekStart.getUTCDay();
        const diff = weekStart.getUTCDate() - day + (day === 0 ? -6 : 1);
        monday.setUTCDate(diff);
        monday.setUTCHours(0, 0, 0, 0);
        const key = monday.toISOString().slice(0, 10);
        const bucket =
          timelinePoints[key] ??
          (() => {
            timelinePoints[key] = {
              mergedPRs: 0,
              commits: 0,
              linesAdded: 0,
              linesDeleted: 0,
            };
            return timelinePoints[key];
          })();
        bucket.mergedPRs += 1;
        bucket.commits += pr.commits;
        bucket.linesAdded += pr.additions;
        bucket.linesDeleted += pr.deletions;
      });

    highImpact.push(...repoHighImpact);
  }

  const timeline = Object.entries(timelinePoints)
    .map(([week, values]) => ({
      week,
      ...values,
    }))
    .sort((a, b) => a.week.localeCompare(b.week));

  const engineers = Array.from(engineerAggregator.values()).sort(
    (a, b) => b.impactScore - a.impactScore,
  );

  const snapshot: MetricSnapshot = {
    generatedAt: new Date().toISOString(),
    range,
    repos: repoMetrics,
    engineers,
    timeline,
    highImpactPRs: highImpact
      .sort(
        (a, b) =>
          b.additions +
          b.deletions -
          (a.additions + a.deletions),
      )
      .slice(0, 20),
  };

  return snapshot;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { org, repos, since, until, range } = body as {
    org?: string;
    repos?: string[];
    since?: string;
    until?: string;
    range?: string;
  };

  const rangeDescriptor = computeRangeDescriptor(since, until, range);

  if (!token) {
    return NextResponse.json(mockMetricSnapshot satisfies MetricSnapshot, {
      status: 200,
    });
  }

  try {
    const snapshot = await buildSnapshot({
      org,
      repos,
      range: rangeDescriptor,
    });
    return NextResponse.json(snapshot satisfies MetricSnapshot, {
      status: 200,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: (error as Error).message,
        fallback: mockMetricSnapshot,
      },
      { status: 200 },
    );
  }
}
