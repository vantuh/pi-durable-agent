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

- A command that does not parse (also one still streaming in) shows as written, in every view.
- A command with a heredoc or a here-string (`<<`) shows as written: splitting the line a heredoc
  starts on could move its body.
- A statement already written over several lines, and an `if`, loop, subshell or `{ }` group, stays
  as written; in Panels it is plain text, without highlighting.
- A short pipeline stays one row, with the first command's icon and its redirects left in the text.
- A wrapper's options are recognised only by their look (`-u`, `3`, `X=1`): `sudo -u root rm` takes
  `root` as the program.
- Panels have no copy button; Raw and Formatted do.
- It shows the command, not its run: which part ran or failed is not marked.
