import { createHash } from 'node:crypto';
import { comparePaths, selectContextFiles } from './codebase-selection.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const estimate = text => Math.ceil(text.length / 4);
const extension = path => /\.([^.\/]+)$/.exec(path)?.[1].toLowerCase() ?? '';

function bounded(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Choose a non-negative integer context limit.');
  return value;
}

function tableRecords(text) {
  const records = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (text[i] === '\n' && !quoted) {
      records.push(text.slice(start, i).replace(/\r$/, ''));
      start = i + 1;
    }
  }
  if (start < text.length) records.push(text.slice(start));
  return records;
}

function excerpt(content, items, limit, unit, header = []) {
  const carried = Math.min(items.length, limit);
  const cut = items.length - carried;
  return { text: content([...header, ...items.slice(0, carried)]), excerpt: { shortened: cut > 0, carried, cut, unit } };
}

function readExcerpt(file, limits) {
  const ext = extension(file.path);
  const joinLines = items => items.join('\n');
  if (ext === 'csv' || ext === 'tsv') {
    const [header, ...rows] = tableRecords(file.text);
    return excerpt(joinLines, rows, limits.tableRows, 'rows', header === undefined ? [] : [header]);
  }
  if (ext === 'jsonl' || ext === 'ndjson') {
    const rows = file.text.split(/\r?\n/).filter(line => line.trim());
    for (const row of rows) JSON.parse(row);
    return excerpt(joinLines, rows, limits.jsonlRows, 'records');
  }
  if (ext === 'ipynb') {
    const notebook = JSON.parse(file.text);
    if (!Array.isArray(notebook.cells)) throw new Error('Notebook cells are unavailable.');
    const cells = notebook.cells.filter(cell => cell.cell_type === 'code' || cell.cell_type === 'markdown')
      .map(cell => Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? ''));
    return excerpt(items => items.join('\n\n'), cells, limits.notebookCells, 'cells');
  }
  return { text: file.text, excerpt: { shortened: false, carried: file.bytes.length, cut: 0, unit: 'bytes' } };
}

function provenance(record) {
  if (!record) return null;
  if (record.status !== 'known' || typeof record.text !== 'string') {
    const reason = typeof record.reason === 'string' && /^[a-z0-9-]{1,50}$/.test(record.reason) ? record.reason : 'unavailable';
    return { status: 'unknown', reason };
  }
  return { status: 'known', origin: 'repository', evidenceClass: 'tool-observation', untrusted: true, text: record.text };
}

const markup = text => text.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function fence(text) {
  let width = 3;
  for (const match of text.matchAll(/\x60+|~+/g)) width = Math.max(width, match[0].length + 1);
  const marker = '\x60'.repeat(width);
  return marker + '\n' + text + '\n' + marker;
}

function render(packet, { format, template, lineNumbers }) {
  const entries = packet.files.map(file => ({ ...file, text: lineNumbers
    ? file.text.split('\n').map((line, index) => (index + 1) + ' ' + line).join('\n') : file.text }));
  const records = value => value?.status === 'known' ? value.text : (value ? 'unknown: ' + value.reason : '');
  const exclusions = JSON.stringify({ omitted: packet.omitted, unknown: packet.unknown });
  if (template !== undefined) {
    const parts = {
      tree: packet.tree.join('\n'), files: entries.map(file => fence(file.path + '\n' + file.text)).join('\n\n'),
      diff: fence(records(packet.changes.diff)), log: fence(records(packet.changes.log)),
      budget: JSON.stringify(packet.budget), omissions: exclusions,
    };
    if (typeof template !== 'string' || /\{\{(?!\s*(?:tree|files|diff|log|budget|omissions)\s*\}\})|\{%/.test(template)) {
      throw new TypeError('Choose a template containing only supported placeholders.');
    }
    return 'Untrusted repository context (untrusted)\n\n' + template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => parts[name]);
  }
  if (format === 'json') return JSON.stringify({ ...packet, files: entries }, null, 2);
  if (format === 'tagged') {
    return '<context untrusted="true">\n' + entries.map(file => '<file path="' + markup(file.path) + '">' + markup(file.text) + '</file>').join('\n')
      + '\n<diff>' + markup(records(packet.changes.diff)) + '</diff>\n<log>' + markup(records(packet.changes.log))
      + '</log>\n<tree>' + markup(packet.tree.join('\n')) + '</tree>\n<budget>' + markup(JSON.stringify(packet.budget))
      + '</budget>\n<omissions>' + markup(exclusions) + '</omissions>\n</context>';
  }
  if (format !== 'markdown') throw new TypeError('Choose a supported context format.');
  return ['# Workspace context (untrusted)', fence(packet.tree.join('\n')), ...entries.map(file => fence(file.path + '\n' + file.text)),
    fence(records(packet.changes.diff)), fence(records(packet.changes.log)), fence(JSON.stringify(packet.budget)), fence(exclusions)].join('\n\n');
}

export function packCodebaseContext(options) {
  const { maxTokens, tableRows, jsonlRows, notebookCells, changes = {}, format = 'markdown', template, lineNumbers = false } = options;
  const limits = { tableRows: bounded(tableRows, 20), jsonlRows: bounded(jsonlRows, 20), notebookCells: bounded(notebookCells, 10) };
  const budget = { kind: 'estimate', maximum: bounded(maxTokens, 8_000), used: 0 };
  const selection = selectContextFiles(options);
  const files = [];
  let exhausted = false;
  for (const item of selection.files) {
    let fragment;
    try { fragment = readExcerpt(item, limits); }
    catch { selection.unknown.push({ path: item.path, reason: 'read-failed' }); continue; }
    const tokens = estimate(fragment.text);
    if (exhausted || budget.used + tokens > budget.maximum) {
      exhausted = true;
      selection.omitted.push({ path: item.path, reason: 'out-of-budget' });
      continue;
    }
    budget.used += tokens;
    files.push({ path: item.path, sha256: sha256(item.bytes), tokens, ...fragment, untrusted: true });
  }
  selection.omitted.sort((a, b) => comparePaths(a.path, b.path));
  selection.unknown.sort((a, b) => comparePaths(a.path ?? '', b.path ?? ''));
  const tokenMap = files.map(file => ({ path: file.path, tokens: file.tokens })).sort((a, b) => b.tokens - a.tokens || comparePaths(a.path, b.path));
  const extensionTotals = Object.create(null);
  for (const file of files) {
    const ext = extension(file.path);
    extensionTotals[ext] = (extensionTotals[ext] ?? 0) + file.tokens;
  }
  const packet = {
    untrusted: true, files, budget, tokenMap, extensionTotals,
    tree: [...new Set(files.flatMap(file => file.path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'))))].sort(comparePaths),
    omitted: selection.omitted, unknown: selection.unknown,
    changes: { diff: provenance(changes.diff), log: provenance(changes.log) },
  };
  const rendered = render(packet, { format, template, lineNumbers });
  return { ...packet, rendered, sha256: sha256(rendered) };
}
