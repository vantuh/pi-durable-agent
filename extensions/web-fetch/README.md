# Fetching a page

`extensions/web-fetch` gives Pi `fetch_content`: one `url`, and `offset` to read on. It returns
`# <title>`, `URL: <final URL>` and the page as Markdown, at most 40 000 characters a call, with a
note saying which `offset` continues it. A call is also kept under the harness's 50 KiB and 2000
lines (the tool declares them), so multibyte or many-line pages return fewer characters, and the
note's `offset` is always where the next call starts.

- HTML goes through linkedom, Readability and Turndown (the path of `pi-web-access`'s `extract.ts`);
  links are made absolute first, and inline `data:` images are replaced by their alt text. A page
  Readability finds no article in (often one built by JavaScript) returns its title, URL and a line
  saying there is no readable text. Plain text, Markdown and JSON skip HTML extraction, but all
  output is trimmed and runs of three or more newlines collapse to two; it is not byte-preserving.
- The charset comes from a BOM, then `Content-Type`, then a `<meta>` in the first 4 KiB (where
  utf-16 and utf-32 are read as UTF-8, as browsers do), else UTF-8.
- 30 s timeout, a 5 MiB cap on the body (reading stops there), and a content type that is not text,
  HTML or JSON is refused before the body is read. PDFs are not read.
- There is no guard against private addresses: the agent has `bash` and `curl` on the same machine,
  so refusing them here would protect nothing.
- The name `fetch_content` is the one `pi-web-access` uses, for the same reason as `web_search`.
