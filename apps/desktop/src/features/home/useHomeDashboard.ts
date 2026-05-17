import { useEffect, useMemo, useState } from 'react';
import {
  getProgressSummary as getFallbackProgressSummary,
  type ProgressSummary as FallbackProgressSummary,
} from '../../lib/progress';
import { useProfiles } from '../../lib/profileContext';
import {
  fetchProgressByCase,
  fetchProgressSummary,
  fetchRecentActivity,
  isReviewAvailable,
  type AttemptSummary as SqliteAttemptSummary,
  type CaseProgress,
  type ProgressSummary as SqliteProgressSummary,
} from '../../lib/review';
import type { AttemptResult, VascCase } from '../../types';

const ACTIVITY_DAYS = 14;
const RECENT_ACTIVITY_LIMIT = 100;

export type HomeDashboardSource = 'sqlite' | 'localStorage';

export interface HomeDashboardAttempt {
  id: string;
  caseId: string;
  caseTitle: string;
  startedAt: string | null;
  completedAt: string | null;
  score: number | null;
  maxScore: number;
  percent: number | null;
  totalElapsedMs: number | null;
}

export interface HomeDashboardCategory {
  categoryId: string;
  categoryTitle: string;
  attempts: number;
  averagePercent: number;
}

export interface HomeDashboardState {
  loading: boolean;
  source: HomeDashboardSource;
  fallbackReason: 'review-unavailable' | 'sqlite-summary-unavailable' | null;
  summary: {
    attempts: number;
    completedAttempts: number;
    completedCases: number;
    averagePercent: number;
    bestPercent: number | null;
    bestCaseTitle: string | null;
    hasCompletedAttempts: boolean;
  };
  activity: number[];
  recentAttempts: HomeDashboardAttempt[];
  continueCaseIds: string[];
  categoryBreakdown: HomeDashboardCategory[];
}

interface UseHomeDashboardOptions {
  cases: VascCase[];
  refreshKey?: number;
}

export function useHomeDashboard({
  cases,
  refreshKey = 0,
}: UseHomeDashboardOptions): HomeDashboardState {
  const { activeProfileId } = useProfiles();
  const caseIndex = useMemo(() => new Map(cases.map((item) => [item.id, item])), [cases]);
  const [dashboard, setDashboard] = useState<HomeDashboardState>(() =>
    emptyDashboard(isReviewAvailable() ? 'sqlite' : 'localStorage', true),
  );

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      if (isReviewAvailable()) {
        setDashboard(emptyDashboard('sqlite', true));
        const [summary, byCase, recent] = await Promise.all([
          fetchProgressSummary(),
          fetchProgressByCase(),
          fetchRecentActivity(RECENT_ACTIVITY_LIMIT),
        ]);
        if (cancelled) return;

        if (summary) {
          setDashboard(buildSqliteDashboard(summary, byCase, recent, caseIndex));
          return;
        }

        setDashboard(buildFallbackDashboard(getFallbackProgressSummary(), 'sqlite-summary-unavailable'));
        return;
      }

      setDashboard(buildFallbackDashboard(getFallbackProgressSummary(), 'review-unavailable'));
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, caseIndex, refreshKey]);

  return dashboard;
}

function emptyDashboard(source: HomeDashboardSource, loading: boolean): HomeDashboardState {
  return {
    loading,
    source,
    fallbackReason: null,
    summary: {
      attempts: 0,
      completedAttempts: 0,
      completedCases: 0,
      averagePercent: 0,
      bestPercent: null,
      bestCaseTitle: null,
      hasCompletedAttempts: false,
    },
    activity: emptyActivity(),
    recentAttempts: [],
    continueCaseIds: [],
    categoryBreakdown: [],
  };
}

function buildSqliteDashboard(
  summary: SqliteProgressSummary,
  byCase: CaseProgress[],
  recent: SqliteAttemptSummary[],
  caseIndex: Map<string, VascCase>,
): HomeDashboardState {
  const recentAttempts = recent.map(fromSqliteAttempt).sort(sortRecentFirst);
  const bestCase = byCase
    .filter((row) => row.bestPercent !== null)
    .slice()
    .sort((a, b) => (b.bestPercent ?? 0) - (a.bestPercent ?? 0))[0];

  return {
    loading: false,
    source: 'sqlite',
    fallbackReason: null,
    summary: {
      attempts: summary.totalAttempts,
      completedAttempts: summary.completedAttempts,
      completedCases: summary.casesCompleted,
      averagePercent: summary.completedAttempts > 0 ? summary.averagePercent : 0,
      bestPercent: summary.completedAttempts > 0 ? summary.bestPercent : null,
      bestCaseTitle: bestCase?.caseTitle ?? null,
      hasCompletedAttempts: summary.completedAttempts > 0,
    },
    activity: activityFromAttempts(recentAttempts),
    recentAttempts,
    continueCaseIds: uniqueCaseIds(recentAttempts),
    categoryBreakdown: categoryBreakdownFromSqlite(byCase, caseIndex),
  };
}

function buildFallbackDashboard(
  progress: FallbackProgressSummary,
  fallbackReason: HomeDashboardState['fallbackReason'],
): HomeDashboardState {
  const recentAttempts = progress.attempts.map(fromFallbackAttempt).sort(sortRecentFirst);
  return {
    loading: false,
    source: 'localStorage',
    fallbackReason,
    summary: {
      attempts: progress.totalAttempts,
      completedAttempts: progress.totalAttempts,
      completedCases: progress.completedCases,
      averagePercent: progress.totalAttempts > 0 ? progress.averagePercent : 0,
      bestPercent: progress.bestCase ? progress.bestCase.percent : null,
      bestCaseTitle: progress.bestCase?.caseTitle ?? null,
      hasCompletedAttempts: progress.totalAttempts > 0,
    },
    activity: activityFromAttempts(recentAttempts),
    recentAttempts,
    continueCaseIds: uniqueCaseIds(recentAttempts),
    categoryBreakdown: progress.categoryBreakdown,
  };
}

function fromSqliteAttempt(attempt: SqliteAttemptSummary): HomeDashboardAttempt {
  return {
    id: attempt.id,
    caseId: attempt.caseId,
    caseTitle: attempt.caseTitle,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    score: attempt.score,
    maxScore: attempt.maxScore,
    percent: attempt.percent,
    totalElapsedMs: null,
  };
}

function fromFallbackAttempt(attempt: AttemptResult): HomeDashboardAttempt {
  return {
    id: attempt.id,
    caseId: attempt.caseId,
    caseTitle: attempt.caseTitle,
    startedAt: attempt.completedAt,
    completedAt: attempt.completedAt,
    score: attempt.score,
    maxScore: attempt.maxScore,
    percent: attempt.percent,
    totalElapsedMs: attempt.totalElapsedMs,
  };
}

function categoryBreakdownFromSqlite(
  byCase: CaseProgress[],
  caseIndex: Map<string, VascCase>,
): HomeDashboardCategory[] {
  const groups = new Map<
    string,
    { categoryId: string; categoryTitle: string; attempts: number; weightedPercent: number }
  >();

  byCase.forEach((row) => {
    const sourceCase = caseIndex.get(row.caseId);
    const categoryId = sourceCase?.categoryId ?? row.category;
    const categoryTitle = row.category || sourceCase?.categoryId || 'Uncategorized';
    const current =
      groups.get(categoryId) ??
      {
        categoryId,
        categoryTitle,
        attempts: 0,
        weightedPercent: 0,
      };
    const attempts = Math.max(0, row.attempts);
    current.attempts += attempts;
    current.weightedPercent += (row.averagePercent ?? 0) * attempts;
    groups.set(categoryId, current);
  });

  return Array.from(groups.values()).map((row) => ({
    categoryId: row.categoryId,
    categoryTitle: row.categoryTitle,
    attempts: row.attempts,
    averagePercent: row.attempts > 0 ? row.weightedPercent / row.attempts : 0,
  }));
}

function activityFromAttempts(attempts: HomeDashboardAttempt[]): number[] {
  const days = Array.from({ length: ACTIVITY_DAYS }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (ACTIVITY_DAYS - 1 - index));
    return day;
  });

  return days.map((day) => {
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    return attempts.filter((attempt) => {
      const raw = attempt.completedAt ?? attempt.startedAt;
      if (!raw) return false;
      const date = new Date(raw);
      return date >= day && date < next;
    }).length;
  });
}

function uniqueCaseIds(attempts: HomeDashboardAttempt[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  attempts.forEach((attempt) => {
    if (!attempt.caseId || seen.has(attempt.caseId)) return;
    seen.add(attempt.caseId);
    ids.push(attempt.caseId);
  });
  return ids;
}

function sortRecentFirst(a: HomeDashboardAttempt, b: HomeDashboardAttempt): number {
  return timestampForAttempt(b) - timestampForAttempt(a);
}

function timestampForAttempt(attempt: HomeDashboardAttempt): number {
  const raw = attempt.completedAt ?? attempt.startedAt;
  if (!raw) return 0;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function emptyActivity(): number[] {
  return Array.from({ length: ACTIVITY_DAYS }, () => 0);
}
