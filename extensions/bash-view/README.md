# Bash view

Shows a `bash` call's command in the transcript in a form that reads, instead of one long `$ `
line.

## Usage

Pick the view in the Extensions dialog: open **Bash view** and choose **Command view**. The choice
holds for every `bash` step and is saved in this browser; the default is **Formatted**.

- **Raw**: the command as the model wrote it, highlighted as bash.
- **Formatted**: one statement per line, and each `&&`, `||` and `|` chain longer than 60 characters
  one part per line, a later part indented under the first. A shorter chain, such as
  `git status | head`, stays on one line:

    ```bash
    pnpm check > /tmp/check.log 2>&1 &&
      pnpm test > /tmp/test.log 2>&1
    result=$?
    tail -n 12 /tmp/check.log
    exit "$result"
    ```

    The layout is still valid bash with the same meaning, so the copy button copies a command that
    runs the same way.

- **Panels**: the same rows in one frame, a row per command. An icon says what kind of program it runs (git,
  a package manager, a file reader, a search, the network; `rm` in the danger tone), its redirects
  become badges in words (`writes /tmp/test.log`, `errors into output`, `hides errors`), and the
  line between two rows says what joins them (`if it succeeds`, `if it fails`, `output into`).

## Embedded Python and JavaScript

All three views highlight static interpreter code inside the command's existing frame, without a
second panel, header or duplicate copy of the code:

- `python -c '...'` and `python3 -c '...'`;
- `node -e '...'` and `node --eval '...'`;
- stdin heredocs, such as `python3 <<'PY'` or `node <<'JS'`, with an optional `-` stdin argument.

Shell syntax stays highlighted as Bash; embedded code uses Python or JavaScript highlighting.
The text keeps its shell quotes, escapes, heredoc delimiters, tabs and redirects. Code is not
reformatted or executed. Raw and Formatted retain one copy button for the complete command.

Complete lines of embedded code have a subtle theme background, a left marker and a visual inset,
including blank lines. The shell header and heredoc delimiter stay outside that marked region.
The inset never adds spaces to the displayed or copied command. Inline code that shares a shell
line keeps syntax highlighting without marking the whole shell line.

Interpreter paths such as `/usr/bin/python3` work. Before the code argument, Python accepts the
flag-only options `-u`, `-B`, `-I`, `-S`, `-E`, `-s`, `-O` and `-OO`; Node accepts
`--input-type=module` and `--input-type=commonjs`.

## Behavior

- The browser half (`web.tsx`) adds a tool view for `bash`; `details.tsx` holds the view choice;
  `server.ts` installs nothing but the extension itself, so it is listed in the Extensions dialog.
  Turned off, a `bash` step shows the plain `$ command` line again.
- The command is parsed with [`unbash`](https://github.com/webpro-nl/unbash), a direct dependency.
  Every piece of text is cut from the command as written: words, quotes and redirects are never
  re-quoted.
- Comments stay, each on its own line; blank lines between statements stay as one.
- The icon comes from the program past wrappers such as `sudo`, `env` or `timeout 3`; a program the
  extension does not know gets the terminal icon.

## Limits

- Inline colouring follows the source spelling; shell escapes and concatenated quote segments can make
  embedded token colours approximate. The displayed and copied text is always preserved.
- Embedded highlighting skips shell expansions, dynamic `eval`, interpreter wrappers, unknown options,
  ANSI-C quoted arguments, and unquoted heredocs with backslashes. Ambiguous input keeps Bash highlighting.
- A heredoc uses an embedded grammar only when it is the command's sole stdin redirect and the interpreter
  is not running a script file or inline code. Incomplete heredocs keep Bash highlighting.
- A command that does not parse (also one still streaming in) shows as written, in every view.
- Heredoc headers and bodies stay together, including any other statements on the same header line.
  Commands before and after that block still format normally. Here-strings do not block formatting.
- Physical line breaks between commands, and an `if`, loop, subshell or `{ }` group, stay as written.
  Newlines inside arguments, such as a multiline `git commit -m` message, do not block splitting the
  surrounding chain. The argument's text and whitespace stay intact, including in Panels.
- A short pipeline stays one row, with the first command's icon and its redirects left in the text.
- A wrapper's options are recognised only by their look (`-u`, `3`, `X=1`): `sudo -u root rm` takes
  `root` as the program.
- Panels have no copy button; Raw and Formatted do.
- It shows the command, not its run: which part ran or failed is not marked.
