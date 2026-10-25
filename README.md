# http

An HTTP client for yena: other modules send requests through its public entry instead of writing their own wrappers, and the assistant (and you) use it from the console with the `http` command. Private, loopback and link-local addresses are refused by default. Kind: io (planned manifest field). Version 0.3.0; depends on `core` (for `sanitizeBlock`); runtime dependencies `undici`, `node-html-markdown` and `node-html-parser` (installed by the manifest's `install` script into the module's own `node_modules`).

## Commands
| Command | Policy for the assistant | What it does |
|---|---|---|
| `http get <url> [-H name:value]… [--json] [-i] [--raw] [--from <n>] [--timeout <s>]` | confirm | GET; prints `HTTP <status> · <size> · <ms>`, then the body (an HTML page as Markdown) |
| `http head <url> …` | confirm | HEAD |
| `http post\|put\|patch\|delete\|options <url> … [--file <path> \| --data <text…>]` | confirm | The other methods, with a body from a file or from the rest of the line |
| `http help` | safe | Lists the subcommands |

- `-H name:value` (also `--header`), repeatable. The console splits lines on whitespace, so a value cannot contain spaces; `--data` takes **the rest of the line**, joined by single spaces, so it must come last.
- `--json` checks that the body parses as JSON, sets `content-type: application/json` (when there is a body) and `accept: application/json` unless given.
- `--file <path>` (relative to the yena root) sends the file as is, at most 1 MiB.
- `-i` (`--include`) also prints the response headers. `--timeout` takes seconds (1–600, default 30).
- An HTML body (`text/html`, `application/xhtml+xml`, or no type and a body starting with `<!doctype html` or `<html`) is converted to Markdown so a page does not flood the assistant's context: a line `(HTML converted to Markdown, <size> -> <size>; --raw shows the source)`, `Title: …`, then the Markdown. `--raw` prints the HTML as it came. If conversion fails, the source is shown with a note.
- Responses over 4 MiB fail; text bodies (`text/*`, JSON, XML, JavaScript, form, YAML, GraphQL, or no type and no NUL byte) are shown in parts of up to 20 Ki characters (so a part fits core's 24 Ki output budget for the assistant), ending at a line break when one is near; a longer text ends with `… N more characters; the next part: --from <offset>`, and `--from <n>` shows the part from that character (of the Markdown when the page was converted; the request is sent again); other bodies print `(binary body, N, not shown)`. Everything printed goes through core's `sanitizeBlock`.
- Every method asks before the assistant runs it (`confirm`); there is no domain allowlist yet.

## For other modules
Add `"http": "git@github.com:hyenayena/http.git"` to `dependencies`, re-export what you use from `src/deps/http.ts`, and import `src/public.ts` there.

```ts
const http = createHttpClient({baseUrl: 'https://api.example.com/v1/', defaults: {headers: {authorization: `Bearer ${token}`}}});
const res = await http.post('items', {json: {name: 'x'}, throwOnStatus: true});
const item = res.json<{id: string}>();
const results = await http.all([{url: 'a'}, {url: 'b', method: 'DELETE'}], {concurrency: 4});
await http.close();
```

- `createHttpClient(options?)`: `baseUrl`, `defaults` (`headers`, `timeoutMs`, `maxBytes`, `redirects`, `throwOnStatus`), `allowPrivate` (for a module that calls a local service on purpose), `log` (a host `Logger`; only method, status, size, redirects, ms and error codes are logged at debug, never URLs, headers or bodies), `transport` (replaces the library).
- `request(req)` and the helpers `get`, `head`, `options`, `delete`, `post`, `put`, `patch(url, options)`. A request: `method`, `url` (string or `URL`, relative to `baseUrl`), `headers`, `query` (values or arrays; `undefined` skipped), `body` (string or `Uint8Array`) or `json`, `timeoutMs` (whole request with redirects; default 30 s), `maxBytes` (default 10 MiB), `redirects` (default 5; 0 returns the 3xx), `throwOnStatus`, `signal`.
- `HttpResponse`: `status`, `statusText` (often empty over HTTP/1.1 with undici), `ok` (2xx), `headers` (lower-case; repeats joined with `, `, `set-cookie` with `\n`), `body` (`Uint8Array`), `text()`, `json()`, `url` (final), `redirects`, `ms`.
- `all(requests, {concurrency = 6, signal})` runs requests in parallel, `sequence(requests, {signal})` one after another; both resolve to `HttpResult[]` in input order (`{ok: true, response}` or `{ok: false, error}`) and never reject. The batch `signal` cancels what has not finished.
- Failures are `HttpError` with `code`: `invalid-request`, `blocked`, `timeout`, `aborted`, `too-large`, `too-many-redirects`, `network`, `status` (with `status` and `response`), `invalid-body` (from `json()`).
- `htmlToMarkdown(html, {baseUrl?})` returns `{title?, markdown}`; `isHtml(contentType, text?)` tells whether a body is HTML (see "HTML to Markdown").
- Also exported: `HTTP_METHODS`, `DEFAULTS`, `isBlockedAddress`, and the types (`Transport`, `TransportRequest`, `TransportResponse`, …).

### Rules the client applies
- Only `http:` and `https:`; credentials in the URL are refused (send an `Authorization` header); header names must be tokens and values may not contain control characters (no header injection); `GET`/`HEAD` cannot carry a body.
- Redirects are followed by the client, not the library, and each hop is checked again: 303 (and 301/302 after a POST) becomes GET without the body and its `content-*` headers, 307/308 keep method and body; leaving the origin drops `authorization`, `cookie` and `proxy-authorization`.
- Blocked addresses (`src/client/address.ts`): IPv4 `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, the documentation ranges, `192.88.99/24`, `192.168/16`, `198.18/15`, multicast and `240/4`; IPv6 `::`, `::1`, NAT64, `100::/64`, documentation, 6to4, `fc00::/7`, `fe80::/10`, `fec0::/10`, multicast; IPv4-mapped IPv6 is matched against the IPv4 rules. IP literals are checked by the client before every hop; host names by the transport after DNS resolution, at connect time (every resolved address must be allowed), so a name or a redirect pointing inside is refused too.

### HTML to Markdown
`src/html/markdown.ts` is the only file importing `node-html-parser` and `node-html-markdown`. It keeps the single `main`, `[role=main]` or `article` element when there is exactly one (else `body`); drops scripts, styles, `noscript`, `template`, SVG, canvas, frames, forms and their controls, `nav`, `footer`, `aside`, navigation/banner/search/menu/dialog roles, hidden and `aria-hidden` parts, elements whose class contains `dropdown`, Wikipedia `[edit]` links and images without `alt`; removes link and image `title`s; resolves relative `href`/`src` against `baseUrl`; turns layout tables (with a nested table or `role=presentation`) into plain blocks; trims spaces at the edges of link and image text and strips the cell padding the library adds to Markdown tables (both outside code fences). Data URI images are dropped. Typical savings: a docs page 311 KiB -> 5 KiB, GitHub repo page 594 KiB -> 63 KiB, a long Wikipedia article 950 KiB -> 180 KiB (read in parts with `--from`).

### Replacing the library
`src/client/undici.ts` is the only file that imports `undici`. It implements the `Transport` contract from `src/client/types.ts` (one hop, no redirects; refuse blocked addresses after DNS; enforce `maxBytes` while streaming; reject on `signal`; map library errors to `HttpError` `network`). Another library means a new file with the same contract and a change of the default in `src/public.ts`; the client and the tests in `tests/client/client.test.ts` stay as they are.

## Environment
None.

## Data
None.

## Events
None.

## Dependencies
`core` (its kit `text.ts`, through `src/kit.ts`). npm: `undici` ^8, `node-html-markdown` ^2, `node-html-parser` ^6.

## Limits and known risks
- No domain allowlist: every console request from the assistant is confirmed by you, and the confirmation shows the whole line. `--file` can send any file yena can read once you confirm it.
- Response content is untrusted text for the assistant (prompt injection); it is only stripped of escapes. Markdown conversion does not make it safer: hidden or removed parts are dropped, but visible text is kept as written.
- The HTML clean-up is heuristic: a page that renders its content with JavaScript yields little text, and a site that puts content inside a dropped element (e.g. a `form` or a class with `dropdown`) loses it; `--raw` is the way out.
- Proxies (`HTTP_PROXY`) are not used; responses are not decompressed beyond what the server sends unencoded (undici does not decode `content-encoding` in `request`).
- DNS rebinding between the guard's lookup and the connection is closed because the guarded lookup is the one the connection uses; a host reachable through an allowed public address is not blocked.

## Development
`npm run typecheck`, `npm run test` (run inside the yena tree; `tsc` and `tsx` come from `/app/node_modules`). Tests: `tests/client/{address,client,undici}.test.ts` (the undici tests use a local server), `tests/{args,commands,public}.test.ts`, `tests/html/markdown.test.ts`.
