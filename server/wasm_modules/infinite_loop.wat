;; infinite_loop.wat
;;
;; A minimal WASM module whose sole export "_start" spins in an infinite loop.
;; Used to exercise the sandbox's fuel/timeout termination paths.
;;
;; Convert to binary .wasm with wasmtime's wat2wasm (via Python):
;;
;;   python3 -c "
;;   from wasmtime import wat2wasm
;;   from pathlib import Path
;;   src = Path('server/wasm_modules/infinite_loop.wat').read_text()
;;   Path('server/wasm_modules/infinite_loop.wasm').write_bytes(wat2wasm(src))
;;   print('infinite_loop.wasm written')
;;   "
;;
;; Or with the wasm-tools CLI:
;;   wasm-tools parse server/wasm_modules/infinite_loop.wat \
;;               -o server/wasm_modules/infinite_loop.wasm

(module
  (func $_start (export "_start")
    (block $break
      (loop $loop
        ;; Unconditional branch back to loop — never breaks.
        (br $loop)
      )
    )
  )
)
