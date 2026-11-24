const metadata = new Set(['.git', '.ssh', '.gnupg', '.aws', '.kube', '.docker', '.npmrc', '.netrc', '.pypirc']);
const privateName = /^(?:\.env(?:\.|$)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|(?:credentials|secrets?|token-cache|keychain)(?:\.|$))|\.(?:pem|key|p12|pfx|jks|crt|cer)$/i;
const decoder = new TextDecoder('utf-8', { fatal: true });

export function comparePaths(left, right) {
  const a = [...left];
  const b = [...right];
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const delta = a[i].codePointAt(0) - b[i].codePointAt(0);
    if (delta) return delta;
  }
  return a.length - b.length;
}

function relativePath(path) {
  return typeof path === 'string' && path !== '' && !/[\\:\x00-\x1f]/.test(path)
    && path.split('/').every(part => part && part !== '.' && part !== '..');
}

function denied(path) {
  return path.split('/').some(part => metadata.has(part.toLowerCase()) || privateName.test(part));
}

const literal = char => char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

function globSource(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') { source += '(?:[^/]+/)*'; i += 2; }
      else { source += '.*'; i += 1; }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (char === '[' && pattern.indexOf(']', i + 1) !== -1) {
      const end = pattern.indexOf(']', i + 1);
      const value = pattern.slice(i + 1, end);
      if (/^!?[a-z0-9_-]+$/i.test(value)) {
        source += '[' + (value.startsWith('!') ? '^/' + value.slice(1) : value) + ']';
        i = end;
      } else source += literal(char);
    } else if (char === '{' && pattern.indexOf('}', i + 1) !== -1) {
      const end = pattern.indexOf('}', i + 1);
      const values = pattern.slice(i + 1, end).split(',');
      source += '(?:' + values.map(globSource).join('|') + ')';
      i = end;
    } else source += literal(char);
  }
  return source;
}

function matcher(pattern, start = '^', end = '$') {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 256) throw new TypeError('Choose a bounded context glob.');
  return new RegExp(start + globSource(pattern) + end, 'u');
}

function ignoreRules(scopes) {
  return Object.entries(scopes).filter(([scope]) => scope === '' || relativePath(scope))
    .sort(([a], [b]) => a.split('/').length - b.split('/').length || comparePaths(a, b))
    .flatMap(([scope, rules]) => rules.split(/\r?\n/).flatMap(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return [];
      const negated = trimmed.startsWith('!');
      const rule = trimmed.slice(negated ? 1 : 0);
      const directory = rule.endsWith('/');
      const anchored = rule.startsWith('/');
      const name = rule.replace(/^\//, '').replace(/\/$/, '');
      if (!name) return [];
      const start = anchored || name.includes('/') ? '^' : '(?:^|/)';
      return [{ scope, negated, pattern: matcher(name, start, directory ? '/' : '(?:/|$)') }];
    }));
}

function ignored(path, rules) {
  let blocked = false;
  for (const rule of rules) {
    if (rule.scope && !path.startsWith(rule.scope + '/')) continue;
    const subpath = rule.scope ? path.slice(rule.scope.length + 1) : path;
    if (rule.pattern.test(subpath)) blocked = !rule.negated;
  }
  return blocked;
}

function fileText(bytes) {
  if (!(bytes instanceof Uint8Array)) return { reason: 'missing-bytes' };
  if (bytes.includes(0)) return { reason: 'binary' };
  try { return { text: decoder.decode(bytes) }; }
  catch { return { reason: 'binary' }; }
}

export function selectContextFiles({ files, include = [], exclude = [], ignore = {}, applyIgnore = true,
  includeHidden = false, overrides = {}, order = 'path' } = {}) {
  if (!Array.isArray(files) || !['path', 'mtime-newest', 'mtime-oldest'].includes(order)) {
    throw new TypeError('Choose candidate files and a supported order.');
  }
  const includes = include.map(value => matcher(value));
  const excludes = exclude.map(value => matcher(value));
  const rules = applyIgnore ? ignoreRules(ignore) : [];
  const selection = { files: [], omitted: [], unknown: [] };
  const seen = new Set();
  const ordered = files.filter(item => {
    if (relativePath(item?.path)) return true;
    selection.unknown.push({ reason: 'invalid-path' });
    return false;
  }).sort((a, b) => comparePaths(a.path, b.path));
  for (const item of ordered) {
    const { path } = item;
    if (seen.has(path)) throw new TypeError('Choose one candidate per context path.');
    seen.add(path);
    const override = Object.hasOwn(overrides, path) ? overrides[path] : null;
    const omit = reason => selection.omitted.push({ path, reason });
    if (denied(path)) { omit('denied'); continue; }
    if (override === 'exclude' || excludes.some(rule => rule.test(path))) { omit('excluded'); continue; }
    if (override !== 'include') {
      if (!includeHidden && path.split('/').some(part => part.startsWith('.'))) { omit('hidden'); continue; }
      if (includes.length && !includes.some(rule => rule.test(path))) { omit('excluded'); continue; }
      if (ignored(path, rules)) { omit('ignored'); continue; }
    }
    if (item.kind === 'symlink') { selection.unknown.push({ path, reason: 'symlink' }); continue; }
    const { bytes } = item;
    const data = fileText(bytes);
    if (data.reason === 'binary') { omit('binary'); continue; }
    if (data.reason) { selection.unknown.push({ path, reason: data.reason }); continue; }
    selection.files.push({ path, bytes, text: data.text, mtime: Number.isFinite(item.mtime) ? item.mtime : 0 });
  }
  if (order !== 'path') {
    const direction = order === 'mtime-newest' ? -1 : 1;
    selection.files.sort((a, b) => direction * (a.mtime - b.mtime) || comparePaths(a.path, b.path));
  }
  return selection;
}
