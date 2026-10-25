import assert from 'node:assert/strict';
import {test} from 'node:test';
import {htmlToMarkdown, isHtml} from '../../src/html/markdown.js';

const page = (body: string, head = '<title> My  page </title>') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

test('isHtml trusts the content type, and sniffs only an untyped body', () => {
	assert.equal(isHtml('text/html; charset=utf-8'), true);
	assert.equal(isHtml('application/xhtml+xml'), true);
	assert.equal(isHtml('text/plain', '<!doctype html>'), false);
	assert.equal(isHtml(undefined, '<!-- x -->\n<!DOCTYPE html><html>'), true);
	assert.equal(isHtml(undefined, '<html lang="en">'), true);
	assert.equal(isHtml(undefined, '<div>fragment</div>'), false);
	assert.equal(isHtml(undefined), false);
});

test('keeps headings, text, lists and code; returns the title', () => {
	const out = htmlToMarkdown(page('<h1>Hello</h1><p>Some <strong>bold</strong> text.</p><ul><li>a</li><li>b</li></ul><pre><code>x = 1</code></pre>'));
	assert.equal(out.title, 'My page');
	assert.match(out.markdown, /^# Hello/);
	assert.match(out.markdown, /Some \*\*bold\*\* text\./);
	assert.match(out.markdown, /^- a$/m);
	assert.match(out.markdown, /```\nx = 1\n```/);
});

test('drops scripts, styles, menus, forms, hidden parts and decorative images', () => {
	const out = htmlToMarkdown(page(`
		<nav><a href="/home">Home</a></nav><script>alert(1)</script><style>p{}</style>
		<div class="vector-dropdown"><a href="/de">Deutsch</a></div><div hidden>secret</div>
		<form><input name="q"><button>Search</button></form>
		<p>Body <img src="/dot.gif"> <img src="/cat.png" alt="A cat"></p>
		<footer>Copyright</footer>`));
	for (const gone of ['Home', 'alert', 'p{}', 'Deutsch', 'secret', 'Search', 'dot.gif', 'Copyright']) {
		assert.equal(out.markdown.includes(gone), false, gone);
	}
	assert.match(out.markdown, /Body !\[A cat\]\(\/cat\.png\)/);
});

test('prefers the single main or article element over the whole body', () => {
	const out = htmlToMarkdown(page('<div>sidebar</div><main><p>main text</p></main>'));
	assert.equal(out.markdown, 'main text');
	const feed = htmlToMarkdown(page('<p>intro</p><article>one</article><article>two</article>'));
	assert.match(feed.markdown, /intro[\s\S]*one[\s\S]*two/);
});

test('resolves relative links against the base URL and drops link titles', () => {
	const out = htmlToMarkdown(page('<p><a href="/docs?a=1" title="Docs page">docs</a> <a href="#top">top</a> <a href="mailto:x@y.z">mail</a></p>'), {
		baseUrl: 'https://example.com/a/b',
	});
	assert.match(out.markdown, /\[docs\]\(https:\/\/example\.com\/docs\?a=1\)/);
	assert.equal(out.markdown.includes('Docs page'), false);
	assert.match(out.markdown, /\[top\]\(#top\)/);
	assert.match(out.markdown, /mailto:x@y\.z/);
	assert.doesNotThrow(() => htmlToMarkdown(page('<a href="/x">x</a>'), {baseUrl: 'not a url'}));
});

test('data tables stay tables without padding; layout tables become blocks', () => {
	const data = htmlToMarkdown(page('<table><tr><th>Name</th><th>Age</th></tr><tr><td>A very long name here</td><td>3</td></tr></table>'));
	assert.match(data.markdown, /^\| Name \| Age \|$/m);
	assert.match(data.markdown, /^\| --- \| --- \|$/m);
	assert.equal(/ {2,}\|/.test(data.markdown), false);
	const layout = htmlToMarkdown(page('<table><tr><td><table><tr><td>inner</td></tr></table></td><td>side</td></tr></table>'));
	assert.match(layout.markdown, /side/);
	assert.equal(layout.markdown.split('\n').filter(l => l.startsWith('|')).length <= 2, true);
	const fenced = htmlToMarkdown(page('<pre><code>|  a  |\n| ---- |</code></pre>'));
	assert.match(fenced.markdown, /\|  a  \|\n\| ---- \|/);
});

test('spaces at the edges of link and image text are trimmed, except inside code blocks', () => {
	const out = htmlToMarkdown(page(`<ul>
		<li><a href="https://t.me/x">Telegram <span aria-hidden="true">→</span></a></li>
		<li><a href="https://g.test/">
			GitHub
		</a></li>
		<li><a href="https://e.test/"><img src="https://e.test/i.png" alt="Logo"> </a></li>
	</ul><pre><code>[keep ](as-is)</code></pre>`));
	assert.match(out.markdown, /^- \[Telegram\]\(https:\/\/t\.me\/x\)$/m);
	assert.match(out.markdown, /^- \[GitHub\]\(https:\/\/g\.test\/\)$/m);
	assert.match(out.markdown, /\[!\[Logo\]\(https:\/\/e\.test\/i\.png\)\s*\]\(https:\/\/e\.test\/\)/);
	assert.match(out.markdown, /\[keep \]\(as-is\)/);
});
