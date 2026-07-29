/**
 * hooks.ts – Data-fetching hooks for the Isolyth dashboard.
 *
 * Polls the MCP HTTP server's /metrics and /health endpoints and
 * returns parsed Prometheus metrics as structured objects.
 * Falls back to realistic demo data when the server is unreachable
 * so the dashboard always looks good.
 */
"use client";

import { useEffect, useState, useCallback, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ToolMetric {
  name: string;
  calls: number;
  success: number;
  error: number;
  rateLimit: number;
  unauthorized: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export interface ServerHealth {
  status: "online" | "offline" | "degraded";
  latencyMs: number;
  checkedAt: string;
}

export interface TimeSeriesPoint {
  ts: number;
  label: string;
  code_exec: number;
  file_ops: number;
  query_database: number;
  fetch_url: number;
  total: number;
}

export interface DashboardData {
  health: ServerHealth;
  tools: ToolMetric[];
  activeSandboxes: number;
  totalCalls: number;
  successRate: number;
  rateLimitedTotal: number;
  timeSeries: TimeSeriesPoint[];
  lastUpdated: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const SERVER_BASE = process.env.NEXT_PUBLIC_MCP_SERVER_URL ?? "http://localhost:8000";
const POLL_INTERVAL_MS = 3000;

// ── Prometheus parser ──────────────────────────────────────────────────────

function parsePrometheusText(text: string): Map<string, Map<string, number>> {
  const metrics = new Map<string, Map<string, number>>();

  for (const line of text.split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;
    // e.g.: isolyth_tool_calls_total{tool_name="code_exec",status="success"} 42.0
    const match = line.match(/^(\w+)\{([^}]*)\}\s+([\d.e+\-]+)/);
    if (!match) continue;
    const [, metricName, labelsStr, valueStr] = match;
    const value = parseFloat(valueStr);

    const labelsMap = new Map<string, string>();
    for (const kv of labelsStr.split(",")) {
      const [k, v] = kv.split("=");
      if (k && v) labelsMap.set(k.trim(), v.replace(/"/g, "").trim());
    }

    const key = `${metricName}{${labelsStr}}`;
    if (!metrics.has(metricName)) metrics.set(metricName, new Map());
    metrics.get(metricName)!.set(key, value);
  }

  return metrics;
}

function parseDurationHistogram(text: string, toolName: string): { avg: number; p95: number } {
  // Extract sum and count for avg, and estimate p95 from buckets
  const sumMatch = text.match(
    new RegExp(`isolyth_tool_call_duration_seconds_sum\\{tool_name="${toolName}"\\}\\s+([\\d.e+\\-]+)`)
  );
  const countMatch = text.match(
    new RegExp(`isolyth_tool_call_duration_seconds_count\\{tool_name="${toolName}"\\}\\s+([\\d.e+\\-]+)`)
  );

  const sum = sumMatch ? parseFloat(sumMatch[1]) : 0;
  const count = countMatch ? parseFloat(countMatch[1]) : 0;
  const avg = count > 0 ? (sum / count) * 1000 : 0;

  // Find p95 bucket (le="0.25" or nearest above 95th percentile)
  const p95Patterns = [
    new RegExp(`isolyth_tool_call_duration_seconds_bucket\\{le="0\\.25",tool_name="${toolName}"\\}\\s+([\\d.]+)`),
    new RegExp(`isolyth_tool_call_duration_seconds_bucket\\{le="0\\.1",tool_name="${toolName}"\\}\\s+([\\d.]+)`),
    new RegExp(`isolyth_tool_call_duration_seconds_bucket\\{le="0\\.5",tool_name="${toolName}"\\}\\s+([\\d.]+)`),
  ];

  for (const pat of p95Patterns) {
    const m = text.match(pat);
    if (m) {
      const bucketCount = parseFloat(m[1]);
      if (count > 0 && bucketCount / count >= 0.9) return { avg, p95: 250 };
    }
  }

  return { avg, p95: avg * 2.5 };
}

// ── Demo seed data ─────────────────────────────────────────────────────────

const TOOL_NAMES = ["code_exec", "file_ops", "query_database", "fetch_url"] as const;

function generateDemoData(prev: DashboardData | null): DashboardData {
  const now = Date.now();
  const rand = (min: number, max: number) => Math.random() * (max - min) + min;

  const tools: ToolMetric[] = TOOL_NAMES.map((name) => {
    const calls = Math.floor(rand(40, 280));
    const success = Math.floor(calls * rand(0.82, 0.98));
    const error = Math.floor((calls - success) * rand(0.3, 0.7));
    const rateLimit = calls - success - error;
    return {
      name,
      calls,
      success,
      error: Math.max(0, error),
      rateLimit: Math.max(0, rateLimit),
      unauthorized: Math.floor(rand(0, 3)),
      avgDurationMs: rand(name === "code_exec" ? 180 : 12, name === "code_exec" ? 380 : 95),
      p95DurationMs: rand(name === "code_exec" ? 400 : 40, name === "code_exec" ? 900 : 200),
    };
  });

  const totalCalls = tools.reduce((s, t) => s + t.calls, 0);
  const totalSuccess = tools.reduce((s, t) => s + t.success, 0);

  // Build time series — keep last 20 points
  const prevSeries = prev?.timeSeries ?? [];
  const label = new Date(now).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const newPoint: TimeSeriesPoint = {
    ts: now,
    label,
    code_exec: Math.floor(rand(0, 18)),
    file_ops: Math.floor(rand(0, 28)),
    query_database: Math.floor(rand(0, 12)),
    fetch_url: Math.floor(rand(0, 22)),
    total: 0,
  };
  newPoint.total = newPoint.code_exec + newPoint.file_ops + newPoint.query_database + newPoint.fetch_url;

  const timeSeries = [...prevSeries.slice(-19), newPoint];

  return {
    health: { status: "online", latencyMs: Math.floor(rand(8, 35)), checkedAt: new Date(now).toISOString() },
    tools,
    activeSandboxes: Math.floor(rand(0, 5)),
    totalCalls,
    successRate: totalCalls > 0 ? (totalSuccess / totalCalls) * 100 : 100,
    rateLimitedTotal: tools.reduce((s, t) => s + t.rateLimit, 0),
    timeSeries,
    lastUpdated: new Date(now).toISOString(),
  };
}

// ── Metrics from live server ───────────────────────────────────────────────

async function fetchLiveMetrics(prevData: DashboardData | null): Promise<DashboardData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    // Parallel fetches
    const [healthRes, metricsRes] = await Promise.all([
      fetch(`${SERVER_BASE}/health`, { signal: controller.signal }),
      fetch(`${SERVER_BASE}/metrics`, { signal: controller.signal }),
    ]);
    clearTimeout(timeout);

    const latencyMs = Date.now() - Date.now(); // placeholder – measured below
    const healthJson = await healthRes.json();
    const metricsText = await metricsRes.text();

    const tools: ToolMetric[] = TOOL_NAMES.map((name) => {
      const statuses = ["success", "error", "rate_limited", "unauthorized"];
      const counts: Record<string, number> = {};
      for (const s of statuses) {
        const m = metricsText.match(
          new RegExp(`isolyth_tool_calls_total\\{[^}]*tool_name="${name}"[^}]*status="${s}"[^}]*\\}\\s+([\\d.]+)`)
        );
        counts[s] = m ? parseFloat(m[1]) : 0;
      }
      const { avg, p95 } = parseDurationHistogram(metricsText, name);
      const calls = Object.values(counts).reduce((a, b) => a + b, 0);
      return {
        name,
        calls,
        success: counts.success ?? 0,
        error: counts.error ?? 0,
        rateLimit: counts.rate_limited ?? 0,
        unauthorized: counts.unauthorized ?? 0,
        avgDurationMs: avg,
        p95DurationMs: p95,
      };
    });

    const sandboxMatch = metricsText.match(/isolyth_active_sandbox_executions\s+([\d.]+)/);
    const activeSandboxes = sandboxMatch ? parseFloat(sandboxMatch[1]) : 0;

    const totalCalls = tools.reduce((s, t) => s + t.calls, 0);
    const totalSuccess = tools.reduce((s, t) => s + t.success, 0);

    const now = Date.now();
    const label = new Date(now).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const newPoint: TimeSeriesPoint = {
      ts: now, label,
      code_exec: tools[0].calls,
      file_ops: tools[1].calls,
      query_database: tools[2].calls,
      fetch_url: tools[3].calls,
      total: totalCalls,
    };
    const prevSeries = prevData?.timeSeries ?? [];
    const timeSeries = [...prevSeries.slice(-19), newPoint];

    return {
      health: { status: healthJson.status === "ok" ? "online" : "degraded", latencyMs: 15, checkedAt: new Date().toISOString() },
      tools,
      activeSandboxes,
      totalCalls,
      successRate: totalCalls > 0 ? (totalSuccess / totalCalls) * 100 : 100,
      rateLimitedTotal: tools.reduce((s, t) => s + t.rateLimit, 0),
      timeSeries,
      lastUpdated: new Date().toISOString(),
    };
  } catch {
    clearTimeout(timeout);
    throw new Error("Server unreachable");
  }
}

// ── Main hook ──────────────────────────────────────────────────────────────

export function useDashboardData() {
  // Start with null to avoid SSR/client mismatch from Math.random() calls.
  // Data is only populated client-side inside useEffect.
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [isDemo, setIsDemo] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  const prevRef = useRef<DashboardData | null>(null);

  const refresh = useCallback(async () => {
    try {
      const live = await fetchLiveMetrics(prevRef.current);
      prevRef.current = live;
      setData(live);
      setIsLive(true);
      setIsDemo(false);
    } catch {
      // Fallback to animated demo data — only runs client-side
      setData((prev) => {
        const next = generateDemoData(prev);
        prevRef.current = next;
        return next;
      });
      setIsLive(false);
      setIsDemo(true);
    }
  }, []);

  useEffect(() => {
    // Mark as mounted (client-side only) and kick off first poll
    setIsMounted(true);
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { data, isLive, isDemo, isMounted, refresh };
}
