import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const script = /<script id="demo-boot-recovery">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

function browser(storage = new Map(), storageBlocked = false) {
  const listeners = new Map(), notices = [];
  const pending = [];
  let reloads = 0, time = 0;
  const location = { origin: 'https://demo.example', href: 'https://demo.example/?capture=saved',
    reload() { reloads++; } };
  const element = tagName => ({ tagName, style: {}, textContent: '', children: [], setAttribute() {},
    append(...children) { this.children.push(...children); },
    addEventListener(name, action) { this[name] = action; } });
  const document = { body: { append: notice => notices.push(notice) }, createElement: element };
  const sessionStorage = {
    getItem(key) { if (storageBlocked) throw new Error('Blocked'); return storage.get(key) ?? null; },
    setItem(key, value) { if (storageBlocked) throw new Error('Blocked'); storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  };
  runInNewContext(script, {
    window: { addEventListener: (name, action) => listeners.set(name, action) },
    document, location, sessionStorage, URL, Math: { random: () => 0 },
    setTimeout(action, delay) { pending.push({ action, at: time + delay }); },
  });
  return {
    fail(tagName = 'SCRIPT', url = '/assets/index-demo.js', rel = '') {
      listeners.get('error')?.({ target: { tagName, src: new URL(url, location.origin).href,
        href: new URL(url, location.origin).href, rel } });
    },
    loaded() { listeners.get('load')?.(); },
    advance(ms) { time += ms; for (const task of pending.splice(0)) {
      if (task.at <= time) task.action(); else pending.push(task);
    } },
    get reloads() { return reloads; }, notices, location,
  };
}

test('a temporarily rejected entry script automatically retries the same page once for a burst of asset errors', () => {
  const page = browser();
  page.fail();
  page.fail('LINK', '/assets/index-demo.css', 'stylesheet');
  page.advance(999);
  assert.equal(page.reloads, 0);
  page.advance(1);
  assert.equal(page.reloads, 1);
  assert.equal(page.location.href, 'https://demo.example/?capture=saved');
});

test('stylesheet failures recover, but external map tiles and later application errors cannot reset a running simulation', () => {
  const css = browser();
  css.fail('LINK', '/assets/index-demo.css', 'stylesheet');
  css.advance(1000);
  assert.equal(css.reloads, 1);
  const page = browser();
  page.fail('IMG', 'https://tile.openstreetmap.org/1.png');
  page.fail('SCRIPT', 'https://external.example/assets/other.js');
  page.loaded();
  page.fail();
  page.advance(10000);
  assert.equal(page.reloads, 0);
});

test('repeated failures stop after three automatic reloads and offer an explicit retry', () => {
  const storage = new Map();
  for (const delay of [1000, 2000, 4000]) {
    const page = browser(storage);
    page.fail();
    page.advance(delay);
    assert.equal(page.reloads, 1);
  }
  const exhausted = browser(storage);
  exhausted.fail();
  exhausted.advance(30000);
  assert.equal(exhausted.reloads, 0);
  const retry = exhausted.notices[0]?.children.find(child => child.tagName === 'button');
  assert.ok(retry, 'A failed initial load must leave a usable retry button');
  retry.click();
  assert.equal(exhausted.reloads, 1);
  assert.equal(storage.size, 0);
});

test('a successful load clears retry history for a later visit', () => {
  const storage = new Map();
  const failed = browser(storage);
  failed.fail();
  failed.advance(1000);
  assert.equal(storage.size, 1);
  browser(storage).loaded();
  assert.equal(storage.size, 0);
});

test('blocked browser storage cannot cause an unbounded automatic reload loop', () => {
  const page = browser(new Map(), true);
  page.fail();
  page.advance(30000);
  assert.equal(page.reloads, 0);
  assert.ok(page.notices[0]?.children.some(child => child.tagName === 'button'));
});
