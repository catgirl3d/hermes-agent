# Hermes Windows-Specific Quirks

Hermes runs natively on Windows, but a few Win32 versus POSIX differences are
worth remembering.

## Input and Keybindings

Alt+Enter usually does not insert a newline because Windows Terminal and mintty
grab it before `prompt_toolkit` sees it. Use Ctrl+Enter instead. To inspect how
the terminal reports a keystroke, run:

```bash
python scripts/keystroke_diagnostic.py
```

## Config and Files

HTTP 400 `No models provided` on first run often means `config.yaml` was saved
with a UTF-8 BOM. Re-save as UTF-8 without BOM. `hermes config edit` writes the
correct encoding.

## `execute_code` and Sandbox

`WinError 10106` from sandbox child processes usually means the environment
scrubber dropped `SYSTEMROOT`, `WINDIR`, or `COMSPEC`, not that Winsock is
broken. `tools/code_execution_tool.py` preserves them through
`_WINDOWS_ESSENTIAL_ENV_VARS`. If it still fails, inspect `os.environ` inside
an `execute_code` block and confirm that `SYSTEMROOT` is present.

## Testing on Windows

`scripts/run_tests.sh` is POSIX-oriented. A direct pytest fallback is:

```bash
"/c/Program Files/Python311/python" -m pip install --user pytest pytest-xdist pyyaml
export PYTHONPATH="$(pwd)"
"/c/Program Files/Python311/python" -m pytest tests/foo/test_bar.py -v --tb=short -n 0
```

POSIX-only tests need skip guards.

## Path and Filesystem Notes

- Line-ending warnings like `LF will be replaced by CRLF` are usually cosmetic because `.gitattributes` normalizes committed files.
- Prefer forward slashes in paths such as `C:/Users/...`; they work almost everywhere and reduce escaping issues in bash.
