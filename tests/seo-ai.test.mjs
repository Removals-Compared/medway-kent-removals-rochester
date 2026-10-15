import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBrightLocalReport, reportRows, parseCheckImport, engineFrom, resultFrom, detectBrand, findCompetitors, positionOf, parseClaude, parsePerplexity, parseOpenAI, CLIENTS, aggregate, runChecks } from '../seo/lib/seo-ai-lib.mjs';

const page = fs.readFileSync(new URL('../seo/data/brightlocal-ai-visibility-2026-08-13.txt', import.meta.url), 'utf8');

test('a pasted BrightLocal page is read into summary, platforms, prompts, competitors and sources', () => {
  const r = parseBrightLocalReport(page);
  assert.equal(r.report_date, '2026-08-13');
  assert.deepEqual(r.summary, { visibility: 21.7, mention_rate: 36, share_of_voice: 6.8, avg_position: 2.6 });
  assert.deepEqual(r.platforms, [{ name: 'Google AI Mode', mention_rate: 50 }, { name: 'ChatGPT', mention_rate: 30 }, { name: 'Google AI Overview', mention_rate: 0 }]);
  assert.equal(r.prompts.length, 10);
  const byName = Object.fromEntries(r.prompts.map((p) => [p.name, p]));
  assert.deepEqual(byName['house removals medway'], { name: 'house removals medway', branded: false, visibility: 80, mention_rate: 100, share_of_voice: 18, avg_position: 1 });
  assert.equal(byName['removal company chatham'].avg_position, 5);
  const zeros = r.prompts.filter((p) => p.visibility === 0).map((p) => p.name).sort();
  assert.deepEqual(zeros, ['house movers', 'moving from kent', 'removals company in TN28', 'removals company neer me', 'student removals']);
  assert.equal(byName['student removals'].avg_position, null);
  assert.equal(r.competitors.length, 10);
  assert.deepEqual(r.competitors[0], { name: 'Fontana Moving Ltd', visibility: 36, mention_rate: 50, share_of_voice: 9, avg_position: 2.8 });
  assert.equal(r.sources.length, 10);
  assert.deepEqual(r.sources[0], { name: 'medwaykentremovals.co.uk', citations: 18, coverage_rate: 45, cited_by: 'ChatGPT, Google AI Mode' });
  assert.equal(r.sources[4].cited_by, 'ChatGPT, Google AI Mode, Google AI Overview');
});

test('report rows are flattened for storage, one row per item, keyed by date + kind + name', () => {
  const rows = reportRows(parseBrightLocalReport(page));
  assert.equal(rows.length, 1 + 3 + 10 + 10 + 10);
  assert.equal(new Set(rows.map((x) => `${x.report_date}|${x.kind}|${x.name}`)).size, rows.length);
  assert.ok(rows.every((x) => x.report_date === '2026-08-13'));
});

test('a wrong or empty paste is refused with a clear message', () => {
  assert.throws(() => parseBrightLocalReport('hello'), /does not look like a BrightLocal/);
  assert.throws(() => parseBrightLocalReport('Last updated August 13, 2026\nnothing else'), /visibility score/);
});

test('hand-entered results are read tolerantly and bad lines are reported, not guessed', () => {
  const { rows, errors } = parseCheckImport(`query | engine | result
best removal company in Medway | Perplexity | NAMED | 1 | Rubix; Fontana | quoted 5.0 rating
removals chatham, ChatGPT, not named
house removals medway\tGoogle AI Overviews\tCited
man and van medway | BingCopilot | absent
x | chatgpt | named
removals kent | AltaVista | named
removals kent | chatgpt | maybe`);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { query: 'best removal company in Medway', engine: 'perplexity', result: 'named', position: 1, competitors: ['Rubix', 'Fontana'], notes: 'quoted 5.0 rating' });
  assert.deepEqual(rows.map((r) => r.engine), ['perplexity', 'chatgpt', 'google_aio', 'bing_copilot']);
  assert.deepEqual(rows.map((r) => r.result), ['named', 'not_named', 'cited', 'not_named']);
  assert.deepEqual(errors.map((e) => e.line), [6, 7, 8], 'line numbers count the header');
  assert.equal(engineFrom('Google AI Mode'), 'google_ai_mode'); assert.equal(engineFrom('claude'), 'claude'); assert.equal(resultFrom('Mentioned'), 'named');
});

test('named vs cited, competitors and list position are detected from an answer', () => {
  const answer = `Here are options:\n1. Rubix Removals and Storage - well reviewed\n2. Medway & Kent Removals - fixed price, 5 stars\n3. Fontana Moving`;
  assert.deepEqual(detectBrand(answer, []), { named: true, cited: false });
  assert.deepEqual(detectBrand('no mention', ['https://www.medwaykentremovals.co.uk/storage']), { named: true, cited: true });
  assert.deepEqual(detectBrand('Try Medway Kent Removals', []), { named: true, cited: false });
  assert.deepEqual(detectBrand('Try Road Runner', ['https://notmedwaykentremovals.co.uk/']), { named: false, cited: false }, 'a lookalike domain is not us');
  assert.equal(positionOf(answer), 2);
  assert.equal(positionOf('Medway & Kent Removals is good.'), null);
  assert.deepEqual(findCompetitors(answer).sort(), ['Fontana Moving', 'Rubix Removals']);
});

test('each engine reply is parsed (Claude web search, Perplexity, ChatGPT) and tool errors surface', () => {
  const c = parseClaude({ content: [{ type: 'text', text: 'Answer ', citations: [{ url: 'https://a.com/1' }] }, { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://b.com/2' }] }, { type: 'text', text: 'more', citations: [{ url: 'https://a.com/1' }] }] });
  assert.deepEqual([c.text, c.urls, c.sources], ['Answer more', ['https://a.com/1'], ['https://b.com/2']]);
  assert.throws(() => parseClaude({ content: [{ type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } }] }), /max_uses_exceeded/);
  assert.deepEqual(parsePerplexity({ choices: [{ message: { content: 'hi' } }], citations: ['https://x.com', 'https://x.com'] }), { text: 'hi', urls: ['https://x.com'], sources: [] });
  assert.deepEqual(parsePerplexity({ choices: [{ message: { content: 'hi' } }], search_results: [{ url: 'https://y.com' }] }).urls, ['https://y.com']);
  const o = parseOpenAI({ output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'hello', annotations: [{ type: 'url_citation', url: 'https://z.com' }] }] }] });
  assert.deepEqual([o.text, o.urls], ['hello', ['https://z.com']]);
});

test('the engine clients send the right request and report API errors clearly', async () => {
  const seen = [];
  const mk = (body, status = 200) => async (url, init) => { seen.push({ url, init, body: JSON.parse(init.body) }); return { ok: status < 300, status, json: async () => body }; };
  await CLIENTS.claude({ apiKey: 'k', model: 'm', fetchFn: mk({ content: [{ type: 'text', text: 't' }] }) })('best removals medway');
  assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen[0].init.headers['x-api-key'], 'k');
  assert.equal(seen[0].body.tools[0].type, 'web_search_20250305');
  assert.equal(seen[0].body.tools[0].user_location.country, 'GB');
  assert.equal(seen[0].body.messages[0].content, 'best removals medway', 'the question is asked as a customer would ask it');
  await CLIENTS.perplexity({ apiKey: 'p', fetchFn: mk({ choices: [{ message: { content: 'x' } }] }) })('q q q');
  assert.equal(seen[1].url, 'https://api.perplexity.ai/chat/completions'); assert.equal(seen[1].init.headers.authorization, 'Bearer p');
  await CLIENTS.chatgpt({ apiKey: 'o', fetchFn: mk({ output: [] }) })('q q q');
  assert.equal(seen[2].url, 'https://api.openai.com/v1/responses'); assert.equal(seen[2].body.tools[0].type, 'web_search_preview');
  await assert.rejects(CLIENTS.claude({ apiKey: 'k', fetchFn: mk({ error: { message: 'web search is not enabled for this organization' } }, 400) })('q q q'), /Claude 400: web search is not enabled/);
});

test('several samples are combined: cited beats named beats not named, competitors and links are merged', () => {
  const s = (named, cited, text, urls = []) => ({ named, cited, text, urls, position: null });
  const a = aggregate([s(false, false, 'Rubix Removals is best'), s(true, false, 'Medway & Kent Removals and Fontana Moving'), s(true, true, 'cited', ['https://www.medwaykentremovals.co.uk/'])]);
  assert.deepEqual([a.samples, a.hits_named, a.hits_cited, a.result], [3, 2, 1, 'cited']);
  assert.ok(a.competitors.includes('Rubix Removals') && a.competitors.includes('Fontana Moving'));
  assert.equal(aggregate([s(false, false, 'x'), s(true, false, 'y')]).result, 'named');
  assert.equal(aggregate([s(false, false, 'x')]).result, 'not_named');
});

test('a failing engine is dropped after its first error so a bad key cannot burn the budget', async () => {
  let claudeCalls = 0, pCalls = 0;
  const engines = {
    claude: async () => { claudeCalls++; return { text: 'Medway & Kent Removals', urls: [] }; },
    perplexity: async () => { pCalls++; throw new Error('Perplexity 401: invalid key'); },
  };
  const out = await runChecks({ queries: ['q one', 'q two', 'q three'], engines, samples: 2, sleep: async () => {} });
  assert.equal(pCalls, 1, 'one failed attempt, then it stops asking');
  assert.equal(claudeCalls, 6);
  assert.equal(out.rows.length, 3);
  assert.ok(out.rows.every((r) => r.engine === 'claude' && r.result === 'named' && r.samples === 2));
  assert.match(out.errors.perplexity, /invalid key/);
  assert.equal(out.calls, 6);
});
