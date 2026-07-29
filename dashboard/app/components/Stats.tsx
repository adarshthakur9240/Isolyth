"use client";

import { motion } from "framer-motion";
import type { DashboardData } from "../lib/hooks";
import { AnimatedNumber, StatusBadge, LatencyPill, TOOL_CONFIG } from "./ui";
import {
  Activity,
  ShieldCheck,
  Zap,
  Server,
  AlertOctagon,
  TrendingUp,
} from "lucide-react";

// ── KPI stat card ─────────────────────────────────────────────────────────

function StatCard({
  id,
  title,
  value,
  suffix,
  decimals,
  icon,
  accentColor,
  accentClass,
  subtitle,
  delay,
}: {
  id: string;
  title: string;
  value: number;
  suffix?: string;
  decimals?: number;
  icon: React.ReactNode;
  accentColor: string;
  accentClass: string;
  subtitle?: string;
  delay?: number;
}) {
  return (
    <motion.div
      id={id}
      className={`brut-card ${accentClass} relative overflow-hidden`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: delay ?? 0, ease: "easeOut" }}
    >
      {/* Accent top bar */}
      <div
        className="accent-bar"
        style={{ background: accentColor }}
      />
      <div style={{ padding: "20px 20px 16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--text-secondary)",
            }}
          >
            {title}
          </span>
          <span
            style={{
              color: accentColor,
              display: "flex",
              alignItems: "center",
              padding: "4px",
              background: "rgba(255,255,255,0.04)",
              borderRadius: 4,
            }}
          >
            {icon}
          </span>
        </div>
        <div className="metric-num" style={{ color: accentColor }}>
          <AnimatedNumber value={value} decimals={decimals ?? 0} suffix={suffix ?? ""} />
        </div>
        {subtitle && (
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: "var(--text-muted)",
              fontWeight: 500,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── KPI row ───────────────────────────────────────────────────────────────

export function KpiRow({ data }: { data: DashboardData }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 16,
      }}
    >
      <StatCard
        id="kpi-total-calls"
        title="Total Calls"
        value={data.totalCalls}
        icon={<Activity size={16} />}
        accentColor="var(--yellow)"
        accentClass="brut-card-yellow"
        subtitle="across all tools"
        delay={0}
      />
      <StatCard
        id="kpi-success-rate"
        title="Success Rate"
        value={data.successRate}
        suffix="%"
        decimals={1}
        icon={<TrendingUp size={16} />}
        accentColor="var(--green)"
        accentClass="brut-card-green"
        subtitle="last polling window"
        delay={0.06}
      />
      <StatCard
        id="kpi-active-sandboxes"
        title="Active Sandboxes"
        value={data.activeSandboxes}
        icon={<Server size={16} />}
        accentColor="var(--blue)"
        accentClass="brut-card-blue"
        subtitle="WASM executions running"
        delay={0.12}
      />
      <StatCard
        id="kpi-rate-limited"
        title="Rate Limited"
        value={data.rateLimitedTotal}
        icon={<AlertOctagon size={16} />}
        accentColor="var(--coral)"
        accentClass="brut-card-coral"
        subtitle="requests rejected"
        delay={0.18}
      />
    </div>
  );
}

// ── Server health panel ────────────────────────────────────────────────────

export function HealthPanel({
  data,
  isLive,
  isDemo,
}: {
  data: DashboardData;
  isLive: boolean;
  isDemo: boolean;
}) {
  return (
    <motion.div
      className="nm-card"
      style={{ padding: "20px 24px" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        {/* Left: server status */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              background: "var(--bg-raised)",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid rgba(255,255,255,0.06)",
            }}
          >
            <ShieldCheck size={20} color="var(--blue)" />
          </div>
          <div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: "var(--text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              Isolyth MCP Server
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginTop: 2,
                fontWeight: 500,
              }}
            >
              localhost:8000
            </div>
          </div>
        </div>

        {/* Center: metrics */}
        <div
          style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Status</div>
            <div style={{ marginTop: 4 }}>
              <StatusBadge status={data.health.status} />
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Latency</div>
            <div style={{ marginTop: 4 }}>
              <LatencyPill ms={data.health.latencyMs} />
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>Mode</div>
            <div style={{ marginTop: 4 }}>
              {isDemo ? (
                <span className="badge badge-yellow">DEMO</span>
              ) : (
                <span className="badge badge-green">
                  <span className="dot-live" style={{ width: 6, height: 6, marginRight: 2 }} />
                  LIVE
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: last updated */}
        <div
          style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, textAlign: "right" }}
        >
          <div style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>Last update</div>
          <div style={{ marginTop: 2, color: "var(--text-secondary)", fontWeight: 600 }}>
            {new Date(data.lastUpdated).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
