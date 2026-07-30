"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Terminal,
  Database,
  Globe,
  FolderOpen,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Key,
  Copy,
  Check,
} from "lucide-react";

// ── Tool Options ─────────────────────────────────────────────────────────────

export const TOOLS = [
  {
    id: "execute_code",
    canonicalName: "code_exec",
    label: "execute_code (code_exec)",
    description: "Evaluates arithmetic & math expressions inside a Wasmtime WASM sandbox.",
    icon: <Cpu size={16} strokeWidth={2.5} color="var(--yellow)" />,
    accent: "var(--yellow)",
    defaultArgs: { expression: "2+2" },
    helpNote: "Runs a restricted math evaluator in WASM (e.g. 2 + 2, sqrt(16), pi * 4^2). Full language runtimes are excluded by design for zero-trust security.",
  },
  {
    id: "query_database",
    canonicalName: "db_query",
    label: "query_database (db_query)",
    description: "Executes read-only SQL SELECT queries against PostgreSQL via asyncpg.",
    icon: <Database size={16} strokeWidth={2.5} color="var(--blue)" />,
    accent: "var(--blue)",
    defaultArgs: { query: "SELECT 1 as id, 'Alice' as username, 'admin' as role;" },
    helpNote: "Only SELECT statements are permitted. Mutations (INSERT, UPDATE, DROP, etc.) are blocked by regex pre-guard and READ ONLY transaction level.",
  },
  {
    id: "fetch_url",
    canonicalName: "web_fetch",
    label: "fetch_url (web_fetch)",
    description: "Fetches public URL body content via httpx with dual-layer SSRF protection.",
    icon: <Globe size={16} strokeWidth={2.5} color="var(--coral)" />,
    accent: "var(--coral)",
    defaultArgs: { url: "https://api.github.com/zen" },
    helpNote: "Blocks RFC-1918 private IPs, loopback, and AWS metadata (169.254.169.254). Redirect hooks prevent open-redirect SSRF bypasses.",
  },
  {
    id: "read_file",
    canonicalName: "file_ops",
    label: "read_file / file_ops",
    description: "Reads files or lists directories inside the sandboxed workspace (/workspace).",
    icon: <FolderOpen size={16} strokeWidth={2.5} color="var(--green)" />,
    accent: "var(--green)",
    defaultArgs: { operation: "list_directory", path: "." },
    helpNote: "Strict Path.resolve() resolution prevents ../ path traversal and symlink escapes outside the sandboxed root.",
  },
] as const;

export type ToolId = (typeof TOOLS)[number]["id"];

// ── Default hardcoded fallback JWT token ────────────────────────────────────
// Used when local GET /auth/dev-token endpoint is offline or unavailable.
// Signed with JWT_SECRET_KEY: "isolyth-dev-secret-key-change-in-production"
const FALLBACK_DEV_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZXYtdXNlciIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0ODAwMDAwMDAwLCJyb2xlcyI6WyJhZG1pbiIsImRldmVsb3BlciJdfQ.placeholder_token";

// ── Component ────────────────────────────────────────────────────────────────

export function TryPanel({ onToolExecuted }: { onToolExecuted?: () => void }) {
  const [selectedToolId, setSelectedToolId] = useState<ToolId>("execute_code");
  const [codeExpr, setCodeExpr] = useState("2+2");
  const [sqlQuery, setSqlQuery] = useState("SELECT 1 as id, 'Alice' as username, 'admin' as role;");
  const [fetchUrl, setFetchUrl] = useState("https://api.github.com/zen");
  const [filePath, setFilePath] = useState(".");
  const [fileOperation, setFileOperation] = useState<"read_file" | "list_directory">("list_directory");

  const [jwtToken, setJwtToken] = useState("");
  const [loadingToken, setLoadingToken] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionTimeMs, setExecutionTimeMs] = useState<number | null>(null);
  const [responseResult, setResponseResult] = useState<any | null>(null);
  const [responseStatus, setResponseStatus] = useState<"idle" | "success" | "error">("idle");
  const [copied, setCopied] = useState(false);

  const selectedTool = TOOLS.find((t) => t.id === selectedToolId) ?? TOOLS[0];

  // Fetch fresh dev token on mount
  useEffect(() => {
    async function fetchToken() {
      setLoadingToken(true);
      try {
        const res = await fetch("http://localhost:8000/auth/dev-token");
        if (res.ok) {
          const data = await res.json();
          if (data.token) {
            setJwtToken(data.token);
            setLoadingToken(false);
            return;
          }
        }
      } catch (err) {
        // HTTP server offline or endpoint not reachable
      }
      setJwtToken(FALLBACK_DEV_TOKEN);
      setLoadingToken(false);
    }
    fetchToken();
  }, []);

  // Build arguments dictionary based on active tool
  const getToolArguments = () => {
    switch (selectedToolId) {
      case "execute_code":
        return { expression: codeExpr };
      case "query_database":
        return { query: sqlQuery };
      case "fetch_url":
        return { url: fetchUrl };
      case "read_file":
        return { operation: fileOperation, path: filePath };
    }
  };

  const handleRun = async () => {
    setExecuting(true);
    setResponseStatus("idle");
    setResponseResult(null);
    const startTime = performance.now();

    const payload = {
      name: selectedTool.canonicalName,
      arguments: {
        ...getToolArguments(),
        _auth_token: jwtToken ? `Bearer ${jwtToken}` : undefined,
      },
    };

    try {
      const res = await fetch("http://localhost:8000/tools/call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const elapsed = Math.round(performance.now() - startTime);
      setExecutionTimeMs(elapsed);

      const json = await res.json();
      setResponseResult(json);
      if (res.ok && json.success !== false) {
        setResponseStatus("success");
      } else {
        setResponseStatus("error");
      }

      if (onToolExecuted) onToolExecuted();
    } catch (err: any) {
      const elapsed = Math.round(performance.now() - startTime);
      setExecutionTimeMs(elapsed);
      setResponseStatus("error");
      setResponseResult({
        error: "NetworkError",
        message: err.message || "Failed to connect to Isolyth HTTP server at http://localhost:8000",
        hint: "Ensure python server/http_server.py is running on port 8000.",
      });
    } finally {
      setExecuting(false);
    }
  };

  const copyToClipboard = () => {
    if (!responseResult) return;
    navigator.clipboard.writeText(JSON.stringify(responseResult, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ── Header banner ────────────────────────────────────────────── */}
      <motion.div
        className="nm-panel"
        style={{ padding: "24px", position: "relative", overflow: "hidden" }}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="accent-bar" style={{ background: "var(--yellow)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Terminal size={20} color="var(--yellow)" strokeWidth={2.5} />
              <h2 style={{ fontSize: 18, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
                Interactive Tool Execution Console
              </h2>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
              Test Isolyth tools in real-time over the HTTP API bridge (`POST http://localhost:8000/tools/call`).
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="badge badge-yellow" style={{ fontSize: 10 }}>
              <Key size={11} /> JWT Bearer Auth Active
            </span>
          </div>
        </div>
      </motion.div>

      {/* ── Main 2-column layout ──────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }} className="charts-grid">

        {/* ── Column 1: Controls Form ──────────────────────────────────── */}
        <motion.div
          className="brut-card"
          style={{ padding: 24, boxShadow: `6px 6px 0 ${selectedTool.accent}` }}
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35 }}
        >
          {/* Tool selector dropdown */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Select Tool
            </label>
            <div style={{ position: "relative" }}>
              <select
                value={selectedToolId}
                onChange={(e) => setSelectedToolId(e.target.value as ToolId)}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  background: "var(--bg-raised)",
                  color: "var(--text-primary)",
                  border: "3px solid #000",
                  borderRadius: 4,
                  fontWeight: 700,
                  fontSize: 13,
                  fontFamily: "Poppins, sans-serif",
                  cursor: "pointer",
                  appearance: "none",
                  boxShadow: "3px 3px 0 #000",
                }}
              >
                {TOOLS.map((t) => (
                  <option key={t.id} value={t.id} style={{ background: "#18191d", color: "#fff" }}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6, fontWeight: 500 }}>
              {selectedTool.description}
            </div>
          </div>

          {/* Dynamic Inputs */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Arguments
            </label>

            {/* tool 1: execute_code */}
            {selectedToolId === "execute_code" && (
              <div>
                <input
                  type="text"
                  value={codeExpr}
                  onChange={(e) => setCodeExpr(e.target.value)}
                  placeholder="Enter a math expression like 2+2 or sqrt(16)..."
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    background: "var(--bg-base)",
                    color: "var(--yellow)",
                    border: "2px solid #000",
                    borderRadius: 4,
                    fontFamily: "monospace",
                    fontSize: 13,
                    fontWeight: 700,
                    boxShadow: "inset 2px 2px 4px rgba(0,0,0,0.5)",
                  }}
                />
              </div>
            )}

            {/* tool 2: query_database */}
            {selectedToolId === "query_database" && (
              <div>
                <textarea
                  rows={4}
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  placeholder="SELECT * FROM users LIMIT 10;"
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    background: "var(--bg-base)",
                    color: "var(--blue)",
                    border: "2px solid #000",
                    borderRadius: 4,
                    fontFamily: "monospace",
                    fontSize: 13,
                    fontWeight: 700,
                    boxShadow: "inset 2px 2px 4px rgba(0,0,0,0.5)",
                    resize: "vertical",
                  }}
                />
              </div>
            )}

            {/* tool 3: fetch_url */}
            {selectedToolId === "fetch_url" && (
              <div>
                <input
                  type="url"
                  value={fetchUrl}
                  onChange={(e) => setFetchUrl(e.target.value)}
                  placeholder="https://api.github.com/zen"
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    background: "var(--bg-base)",
                    color: "var(--coral)",
                    border: "2px solid #000",
                    borderRadius: 4,
                    fontFamily: "monospace",
                    fontSize: 13,
                    fontWeight: 700,
                    boxShadow: "inset 2px 2px 4px rgba(0,0,0,0.5)",
                  }}
                />
              </div>
            )}

            {/* tool 4: read_file */}
            {selectedToolId === "read_file" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700 }}>Operation</label>
                  <select
                    value={fileOperation}
                    onChange={(e) => setFileOperation(e.target.value as any)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      background: "var(--bg-base)",
                      color: "#fff",
                      border: "2px solid #000",
                      borderRadius: 4,
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    <option value="list_directory">list_directory (Directory listing)</option>
                    <option value="read_file">read_file (File content)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700 }}>Relative Path</label>
                  <input
                    type="text"
                    value={filePath}
                    onChange={(e) => setFilePath(e.target.value)}
                    placeholder="notes/summary.txt"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      background: "var(--bg-base)",
                      color: "var(--green)",
                      border: "2px solid #000",
                      borderRadius: 4,
                      fontFamily: "monospace",
                      fontSize: 12,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Security Note / Constraint Box */}
          <div
            style={{
              padding: "12px 14px",
              background: "rgba(255,255,255,0.03)",
              border: "1px border-subtle",
              borderLeft: `4px solid ${selectedTool.accent}`,
              borderRadius: 4,
              fontSize: 11,
              color: "var(--text-secondary)",
              marginBottom: 24,
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: selectedTool.accent, fontWeight: 700 }}>Security Note: </strong>
            {selectedTool.helpNote}
          </div>

          {/* Run Button */}
          <motion.button
            onClick={handleRun}
            disabled={executing}
            className={`btn-brut ${selectedToolId === "execute_code" ? "btn-yellow" : selectedToolId === "query_database" ? "btn-blue" : selectedToolId === "fetch_url" ? "btn-coral" : "btn-yellow"}`}
            style={{
              width: "100%",
              justifyContent: "center",
              padding: "12px",
              fontSize: 14,
              opacity: executing ? 0.7 : 1,
            }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98, y: 1 }}
          >
            {executing ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  style={{ display: "inline-block" }}
                >
                  <Cpu size={16} />
                </motion.div>
                Executing in Sandbox...
              </>
            ) : (
              <>
                <Play size={16} fill="currentColor" />
                Run Tool ({selectedTool.canonicalName})
              </>
            )}
          </motion.button>
        </motion.div>

        {/* ── Column 2: Response Console ───────────────────────────────── */}
        <motion.div
          className="brut-card"
          style={{
            padding: 24,
            display: "flex",
            flexDirection: "column",
            boxShadow: responseStatus === "success" ? "6px 6px 0 var(--green)" : responseStatus === "error" ? "6px 6px 0 var(--coral)" : "6px 6px 0 #000",
          }}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35 }}
        >
          {/* Header row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Terminal size={16} color="var(--text-muted)" />
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                Response Payload
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {executionTimeMs !== null && (
                <span className="badge badge-muted" style={{ fontSize: 10 }}>
                  <Clock size={10} /> {executionTimeMs} ms
                </span>
              )}

              {responseStatus === "success" && (
                <span className="badge badge-green" style={{ fontSize: 10 }}>
                  <CheckCircle2 size={10} /> 200 OK
                </span>
              )}

              {responseStatus === "error" && (
                <span className="badge badge-coral" style={{ fontSize: 10 }}>
                  <AlertTriangle size={10} /> Failed
                </span>
              )}

              {responseResult && (
                <button
                  onClick={copyToClipboard}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: copied ? "var(--green)" : "var(--text-muted)",
                    cursor: "pointer",
                    padding: 4,
                    display: "flex",
                    alignItems: "center",
                  }}
                  title="Copy JSON"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              )}
            </div>
          </div>

          {/* Console / Output Window */}
          <div
            style={{
              flex: 1,
              minHeight: 280,
              background: "#0d0e10",
              border: "2px solid #000",
              borderRadius: 6,
              padding: 16,
              fontFamily: "monospace",
              fontSize: 12,
              lineHeight: 1.6,
              overflowX: "auto",
              boxShadow: "inset 2px 2px 6px rgba(0,0,0,0.8)",
              position: "relative",
            }}
          >
            {/* Custom execution loading state animation */}
            {executing && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 16, padding: "40px 0" }}>
                <motion.div
                  style={{
                    width: 44,
                    height: 44,
                    background: selectedTool.accent,
                    border: "3px solid #000",
                    borderRadius: 6,
                    boxShadow: "4px 4px 0 #000",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#000",
                  }}
                  animate={{ rotate: [0, 90, 180, 270, 360], scale: [1, 1.1, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                >
                  <Cpu size={22} strokeWidth={3} />
                </motion.div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "0.04em" }}>
                    WASMTIME SANDBOX EXECUTING…
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                    Allocating fuel budget & evaluating isolated memory boundary
                  </div>
                </div>
                {/* Fuel pulse bars */}
                <div style={{ display: "flex", gap: 6, height: 16, alignItems: "flex-end" }}>
                  {[0.4, 0.9, 0.6, 1.0, 0.7].map((h, idx) => (
                    <motion.div
                      key={idx}
                      style={{ width: 4, background: selectedTool.accent, borderRadius: 2 }}
                      animate={{ height: [`${h * 100}%`, "20%", `${h * 100}%`] }}
                      transition={{ duration: 0.6, delay: idx * 0.1, repeat: Infinity }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {!executing && !responseResult && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", gap: 10, padding: "60px 0" }}>
                <Terminal size={32} opacity={0.3} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>No tool response yet.</span>
                <span style={{ fontSize: 11 }}>Select a tool on the left and click "Run Tool".</span>
              </div>
            )}

            {/* JSON Output */}
            {!executing && responseResult && (
              <pre style={{ margin: 0, color: responseStatus === "error" ? "#ff6b6b" : "#2ed573", whiteSpace: "pre-wrap" }}>
                {JSON.stringify(responseResult, null, 2)}
              </pre>
            )}
          </div>
        </motion.div>

      </div>
    </div>
  );
}
