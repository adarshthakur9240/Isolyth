"use client";

import { motion } from "framer-motion";
import {
  Activity,
  Shield,
  Zap,
  Database,
  Globe,
  Code2,
  FolderOpen,
  RefreshCw,
  Cpu,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  TrendingUp,
} from "lucide-react";

// ── Tool icons / colors map ───────────────────────────────────────────────

export const TOOL_CONFIG: Record<
  string,
  { icon: React.ReactNode; color: string; accent: string; label: string }
> = {
  code_exec: {
    icon: <Code2 size={16} />,
    color: "#f5d800",
    accent: "brut-card-yellow",
    label: "code_exec",
  },
  file_ops: {
    icon: <FolderOpen size={16} />,
    color: "#00a8ff",
    accent: "brut-card-blue",
    label: "file_ops",
  },
  query_database: {
    icon: <Database size={16} />,
    color: "#ff4757",
    accent: "brut-card-coral",
    label: "query_database",
  },
  fetch_url: {
    icon: <Globe size={16} />,
    color: "#2ed573",
    accent: "brut-card-green",
    label: "fetch_url",
  },
};

// ── Animated counter ──────────────────────────────────────────────────────

export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = "",
}: {
  value: number;
  decimals?: number;
  suffix?: string;
}) {
  const formatted = value.toFixed(decimals);
  return (
    <motion.span
      key={formatted}
      initial={{ opacity: 0.4, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {formatted}
      {suffix}
    </motion.span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────

export function StatusBadge({
  status,
}: {
  status: "online" | "offline" | "degraded";
}) {
  const map = {
    online: { cls: "badge-green", label: "ONLINE", icon: <CheckCircle2 size={10} /> },
    offline: { cls: "badge-coral", label: "OFFLINE", icon: <XCircle size={10} /> },
    degraded: { cls: "badge-yellow", label: "DEGRADED", icon: <AlertTriangle size={10} /> },
  };
  const { cls, label, icon } = map[status];
  return (
    <span className={`badge ${cls}`}>
      {icon}
      {label}
    </span>
  );
}

// ── Section heading ───────────────────────────────────────────────────────

export function SectionHeading({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <h2
      style={{ color: accent ?? "var(--text-primary)" }}
      className="text-xs font-800 uppercase tracking-[0.12em] mb-3 flex items-center gap-2"
    >
      <span
        style={{ background: accent ?? "var(--text-muted)", width: 16, height: 3, borderRadius: 2, display: "inline-block" }}
      />
      {children}
    </h2>
  );
}

// ── Mini sparkline bar ────────────────────────────────────────────────────

export function MiniBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="nm-inset" style={{ height: 6, borderRadius: 3, overflow: "hidden" }}>
      <motion.div
        style={{ background: color, height: "100%", borderRadius: 3 }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </div>
  );
}

// ── Latency pill ─────────────────────────────────────────────────────────

export function LatencyPill({ ms }: { ms: number }) {
  const color =
    ms < 50
      ? "var(--green)"
      : ms < 150
      ? "var(--yellow)"
      : "var(--coral)";
  return (
    <span
      style={{
        background: color,
        color: ms < 150 ? "#000" : "#fff",
        padding: "1px 6px",
        borderRadius: 2,
        fontSize: 11,
        fontWeight: 700,
        border: "2px solid #000",
        letterSpacing: "0.04em",
      }}
    >
      {ms.toFixed(0)}ms
    </span>
  );
}

// ── Refresh button ─────────────────────────────────────────────────────────

export function RefreshButton({
  onClick,
  spinning,
}: {
  onClick: () => void;
  spinning?: boolean;
}) {
  return (
    <button
      id="refresh-btn"
      className="btn-brut btn-outline"
      onClick={onClick}
      title="Refresh metrics"
    >
      <motion.span
        animate={{ rotate: spinning ? 360 : 0 }}
        transition={{ duration: 0.6, ease: "linear", repeat: spinning ? Infinity : 0 }}
      >
        <RefreshCw size={13} />
      </motion.span>
      Refresh
    </button>
  );
}
