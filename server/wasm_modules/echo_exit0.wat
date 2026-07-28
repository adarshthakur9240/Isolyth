;; echo_exit0.wat
;;
;; A minimal WASM module that:
;;   1. Exports "_start" (WASI command convention)
;;   2. Calls proc_exit(0) immediately – a clean exit with no output
;;
;; This is used in tests to verify the sandbox can run a valid module
;; without needing a C/Rust compiler or the factorial.wasm.
;;
;; Compile with:
;;   python3 -c "
;;   from wasmtime import wat2wasm
;;   from pathlib import Path
;;   src = Path('server/wasm_modules/echo_exit0.wat').read_text()
;;   Path('server/wasm_modules/echo_exit0.wasm').write_bytes(wat2wasm(src))
;;   "

(module
  ;; Import the WASI proc_exit function
  (import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit (param i32)))

  (func $_start (export "_start")
    ;; Exit with code 0 (success)
    (call $proc_exit (i32.const 0))
    (unreachable)
  )

  (memory (export "memory") 1)
)
