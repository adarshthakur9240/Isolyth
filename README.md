# Isolyth

> A secure, observable, production-ready **MCP (Model Context Protocol) server** built with the official Python MCP SDK.

---

## Project Structure

```
isolyth/
├── server/
│   ├── core/
│   │   ├── mcp_server.py     # Server bootstrap, tool registry, MCP handlers
│   │   ├── sandbox.py        # Execution sandbox (filesystem / network isolation)
│   │   ├── auth.py           # JWT-based authentication
│   │   ├── rate_limit.py     # Token-bucket rate limiter (in-process + Redis)
│   │   └── telemetry.py      # OpenTelemetry traces + Prometheus metrics
│   ├── tools/
│   │   ├── db_query_tool.py  # Read-only SQL via asyncpg
│   │   ├── web_fetch_tool.py # HTTP fetch via httpx
│   │   ├── file_ops_tool.py  # Sandboxed file read/write/list
│   │   └── code_exec_tool.py # Sandboxed Python execution (wasmtime)
│   ├── wasm_modules/         # Compiled WebAssembly modules (build artifacts)
│   └── tests/
│       └── test_mcp_server.py
├── requirements.txt
├── Dockerfile                # Multi-stage, non-root production image
├── docker-compose.yml        # Full stack: server + Redis + Postgres + Prometheus
└── README.md
```

---

## Quick Start

### 1. Local development

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run the server (communicates over stdio)
python -m server.core.mcp_server
```

### 2. Run tests

```bash
pytest server/tests/ -v
```

### 3. Docker

```bash
# Build and start the full stack
docker compose up --build

# With observability (Prometheus)
docker compose --profile observability up --build
```

---

## Architecture

### `ToolRegistry`
A runtime dictionary of `ToolEntry` objects. Tools can be registered or unregistered at any point before or after server start:

```python
registry.register(
    name="my_tool",
    description="Does something useful",
    input_schema={"type": "object", "properties": {...}},
    handler=my_async_handler,
)
```

### MCP Handlers
- **`list_tools()`** – returns all registered tools in MCP `Tool` format.
- **`call_tool(name, arguments)`** – dispatches to the registered handler; wraps all exceptions in a structured JSON error `TextContent` block so the MCP client always receives a valid response.

### Structured Logging
Every log line is a single JSON object on stderr:
```json
{"timestamp": "...", "level": "INFO", "logger": "isolyth", "message": "Tool registered", "extra": {"tool": "db_query"}}
```

### Telemetry
- **OpenTelemetry** – spans exported for each tool call (configurable exporter).
- **Prometheus** – `isolyth_tool_calls_total` counter and `isolyth_tool_call_duration_seconds` histogram.

---

## Environment Variables

| Variable       | Default                                      | Description                        |
|----------------|----------------------------------------------|------------------------------------|
| `LOG_LEVEL`    | `INFO`                                       | Python logging level               |
| `REDIS_URL`    | `redis://localhost:6379/0`                   | Redis connection string            |
| `DB_URL`       | `postgresql://sentinel:sentinel@localhost/sentineldb` | PostgreSQL DSN            |
| `JWT_SECRET`   | *(required in production)*                   | HMAC secret for JWT verification   |

---

## Roadmap

- [ ] Implement `db_query_tool` with asyncpg connection pool
- [ ] Implement `web_fetch_tool` with allowlist-based egress control
- [ ] Implement `file_ops_tool` with sandbox path enforcement
- [ ] Implement `code_exec_tool` with wasmtime isolation
- [ ] Wire `AuthManager` into MCP request pipeline
- [ ] Wire `RedisRateLimiter` for multi-replica deployments
- [ ] Prometheus `/metrics` HTTP endpoint (sidecar FastAPI app)
- [ ] Load / performance tests with Locust

---

## License

MIT
