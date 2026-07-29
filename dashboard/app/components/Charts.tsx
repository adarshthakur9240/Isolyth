"use client";

import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  RadialBarChart,
  RadialBar,
} from "recharts";
import type { DashboardData, ToolMetric } from "../lib/hooks";
import { TOOL_CONFIG, AnimatedNumber, MiniBar, SectionHeading } from "./ui";
import { motion as m } from "framer-motion";

// ── Custom chart tooltip ──────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "var(--bg-raised)",
        border: "2px solid #000",
        borderRadius: 4,
        padding: "10px 14px",
        boxShadow: "4px 4px 0 #000",
        fontFamily: "Poppins, sans-serif",
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6, fontSize: 11 }}>
        {label}
      </div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 16, color: p.color }}>
          <span style={{ fontWeight: 600 }}>{p.name || p.dataKey}</span>
          <span style={{ fontWeight: 800 }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Throughput area chart ─────────────────────────────────────────────────

export function ThroughputChart({ data }: { data: DashboardData }) {
  return (
    <motion.div
      className="nm-card"
      style={{ padding: "20px 16px 16px" }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.1 }}
    >
      <div style={{ padding: "0 8px", marginBottom: 16 }}>
        <SectionHeading accent="var(--yellow)">Throughput — Requests / Poll</SectionHeading>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data.timeSeries} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
          <defs>
            {Object.entries(TOOL_CONFIG).map(([key, cfg]) => (
              <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={cfg.color} stopOpacity={0.35} />
                <stop offset="95%" stopColor={cfg.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "Poppins" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "Poppins" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          {Object.entries(TOOL_CONFIG).map(([key, cfg]) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={cfg.label}
              stroke={cfg.color}
              strokeWidth={2}
              fill={`url(#grad-${key})`}
              dot={false}
              activeDot={{ r: 4, fill: cfg.color, stroke: "#000", strokeWidth: 2 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

// ── Duration bar chart ────────────────────────────────────────────────────

export function DurationChart({ data }: { data: DashboardData }) {
  const chartData = data.tools.map((t) => ({
    name: t.name.replace("_", "\n"),
    "Avg (ms)": parseFloat(t.avgDurationMs.toFixed(1)),
    "p95 (ms)": parseFloat(t.p95DurationMs.toFixed(1)),
  }));

  return (
    <motion.div
      className="nm-card"
      style={{ padding: "20px 16px 16px" }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.18 }}
    >
      <div style={{ padding: "0 8px", marginBottom: 16 }}>
        <SectionHeading accent="var(--blue)">Latency — Avg & p95 (ms)</SectionHeading>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "Poppins" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "Poppins" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11, fontFamily: "Poppins", color: "var(--text-secondary)", paddingTop: 8 }}
          />
          <Bar dataKey="Avg (ms)" fill="var(--blue)" radius={[2, 2, 0, 0]} maxBarSize={32} />
          <Bar dataKey="p95 (ms)" fill="var(--coral)" radius={[2, 2, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

// ── Per-tool breakdown table ───────────────────────────────────────────────

export function ToolBreakdown({ data }: { data: DashboardData }) {
  const maxCalls = Math.max(...data.tools.map((t) => t.calls), 1);

  return (
    <motion.div
      className="nm-card"
      style={{ padding: "20px 20px" }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.24 }}
    >
      <SectionHeading accent="var(--coral)">Per-Tool Breakdown</SectionHeading>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 8 }}>
        {data.tools.map((tool, i) => {
          const cfg = TOOL_CONFIG[tool.name];
          const successPct = tool.calls > 0 ? (tool.success / tool.calls) * 100 : 0;

          return (
            <motion.div
              key={tool.name}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.05 * i }}
            >
              {/* Header row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      color: cfg?.color ?? "var(--text-primary)",
                      display: "flex",
                      alignItems: "center",
                      background: "var(--bg-raised)",
                      padding: 5,
                      borderRadius: 4,
                      border: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    {cfg?.icon}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>
                    {tool.name}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
                    {tool.calls} calls
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: successPct >= 90 ? "var(--green)" : successPct >= 70 ? "var(--yellow)" : "var(--coral)",
                    }}
                  >
                    {successPct.toFixed(1)}% ok
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <MiniBar value={tool.calls} max={maxCalls} color={cfg?.color ?? "var(--blue)"} />

              {/* Breakdown pills */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 8,
                  flexWrap: "wrap",
                }}
              >
                {[
                  { label: "✓ ok", value: tool.success, color: "var(--green)" },
                  { label: "✗ err", value: tool.error, color: "var(--coral)" },
                  { label: "⊘ limit", value: tool.rateLimit, color: "var(--yellow)" },
                  { label: "⛔ auth", value: tool.unauthorized, color: "var(--purple)" },
                ].map(({ label, value, color }) => (
                  <span
                    key={label}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color,
                      background: "var(--bg-raised)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      padding: "2px 7px",
                      borderRadius: 3,
                    }}
                  >
                    {label} {value}
                  </span>
                ))}
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    background: "var(--bg-raised)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    padding: "2px 7px",
                    borderRadius: 3,
                    marginLeft: "auto",
                  }}
                >
                  avg {tool.avgDurationMs.toFixed(0)}ms
                </span>
              </div>

              {i < data.tools.length - 1 && (
                <div className="divider" style={{ marginTop: 16 }} />
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Success / error donut ──────────────────────────────────────────────────

export function SuccessDonut({ data }: { data: DashboardData }) {
  const totalSuccess = data.tools.reduce((s, t) => s + t.success, 0);
  const totalError = data.tools.reduce((s, t) => s + t.error, 0);
  const totalRateLimit = data.tools.reduce((s, t) => s + t.rateLimit, 0);
  const totalUnauth = data.tools.reduce((s, t) => s + t.unauthorized, 0);

  const donutData = [
    { name: "Success", value: totalSuccess, fill: "var(--green)" },
    { name: "Error", value: totalError, fill: "var(--coral)" },
    { name: "Rate Limit", value: totalRateLimit, fill: "var(--yellow)" },
    { name: "Unauth", value: totalUnauth, fill: "var(--purple)" },
  ].filter((d) => d.value > 0);

  return (
    <motion.div
      className="nm-card"
      style={{ padding: "20px" }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.3 }}
    >
      <SectionHeading accent="var(--green)">Call Outcomes</SectionHeading>

      <ResponsiveContainer width="100%" height={180}>
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="40%"
          outerRadius="80%"
          barSize={14}
          data={donutData}
          startAngle={90}
          endAngle={-270}
        >
          <RadialBar
            dataKey="value"
            cornerRadius={4}
            background={{ fill: "var(--bg-raised)" }}
          />
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div
                  style={{
                    background: "var(--bg-raised)",
                    border: "2px solid #000",
                    padding: "6px 10px",
                    borderRadius: 3,
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: "Poppins",
                  }}
                >
                  <span style={{ color: payload[0].payload.fill }}>{payload[0].name}</span>
                  {": "}
                  {payload[0].value}
                </div>
              ) : null
            }
          />
        </RadialBarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {donutData.map((d) => (
          <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: d.fill,
                border: "1.5px solid #000",
                display: "inline-block",
              }}
            />
            <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>
              {d.name} ({d.value})
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
