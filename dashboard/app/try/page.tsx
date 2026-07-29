"use client";

import { motion } from "framer-motion";
import { Zap, ChevronLeft } from "lucide-react";
import { TryPanel } from "../components/TryPanel";

export default function TryPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-base)",
      }}
    >
      {/* ── Top Bar ──────────────────────────────────────────────────── */}
      <header
        style={{
          background: "var(--bg-panel)",
          borderBottom: "3px solid #000",
          boxShadow: "0 3px 0 #000",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 58,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <a
              href="/overview"
              className="btn-brut btn-outline"
              style={{ padding: "5px 12px", fontSize: 12, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}
            >
              <ChevronLeft size={14} /> Back to Dashboard
            </a>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  background: "var(--yellow)",
                  border: "2px solid #000",
                  borderRadius: 4,
                  boxShadow: "2px 2px 0 #000",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#000",
                }}
              >
                <Zap size={14} strokeWidth={3} />
              </div>
              <span style={{ fontSize: 14, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
                ISOLYTH · Interactive Tool Tester
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 1400, margin: "0 auto", width: "100%", padding: "24px 24px 40px" }}>
        <TryPanel />
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: "2px solid rgba(255,255,255,0.04)",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
          ISOLYTH · TRY A TOOL · HTTP BRIDGE API
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          POST http://localhost:8000/tools/call
        </span>
      </footer>
    </div>
  );
}
