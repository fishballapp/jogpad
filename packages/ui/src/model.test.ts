import { expect, test } from 'vitest';
import {
  DEFAULT_PAGE,
  type Doc,
  defaultPrefs,
  joinItem,
  Model,
  normalisePageName,
  parseDoc,
  parsePrefs,
  serialiseDoc,
  splitItem,
} from './model.ts';

function stripIds(doc: Doc): Array<[string, Array<[string, boolean]>]> {
  return doc.pages.map(s => [s.name, s.items.map(i => [i.text, i.isDone])]);
}

test('round-trips a document through markdown', () => {
  const md =
    '## Inbox\n\n- [ ] plain\n- [x] done\n- [ ] multi\n  second line\n\n  after a blank\n\n## Refactor\n\n- [ ] only one\n\n';
  const doc = parseDoc(md);
  expect(doc.pages.length).toBe(2);
  expect(doc.pages[0]!.items.length).toBe(3);
  expect(doc.pages[0]!.items[2]!.text).toBe('multi\nsecond line\n\nafter a blank');
  expect(doc.pages[0]!.items[1]!.isDone).toBe(true);
  expect(serialiseDoc(doc)).toBe(md);
  expect(stripIds(doc)).toEqual(stripIds(parseDoc(serialiseDoc(doc))));
});

test('headless bullets land in the default page', () => {
  const doc = parseDoc('- loose note\n');
  expect(doc.pages[0]!.name).toBe(DEFAULT_PAGE);
  expect(doc.pages[0]!.items[0]!.text).toBe('loose note');
});

test('empty file still has a page', () => {
  expect(parseDoc('').pages.length).toBe(1);
});

test('page names reject anything that would break the file', () => {
  expect(normalisePageName('  Inbox  ')).toBe('Inbox');
  expect(normalisePageName('')).toBe(null);
  expect(normalisePageName('   ')).toBe(null);
  // A multiline composer makes this reachable by pasting.
  expect(normalisePageName('Inbox\n## Injected')).toBe(null);
  expect(normalisePageName('Inbox\rInjected')).toBe(null);
});

test('move page before reorders headings', () => {
  const model = new Model(parseDoc('## A\n\n## B\n\n## C\n'), { ...defaultPrefs });
  const names = () => model.doc.pages.map(p => p.name);
  expect(model.movePageBefore('C', 'A')).toBe(true);
  expect(names()).toEqual(['C', 'A', 'B']);
  expect(model.movePageBefore('C', null)).toBe(true);
  expect(names()).toEqual(['A', 'B', 'C']);
  expect(model.movePageBefore('A', 'A')).toBe(false);
  expect(model.movePageBefore('Missing', 'A')).toBe(false);
  expect(names()).toEqual(['A', 'B', 'C']);
});

test('move items before reorders within and across pages', () => {
  const doc = parseDoc('## A\n\n- [ ] one\n- [ ] two\n- [ ] three\n\n## B\n\n');
  const model = new Model(doc, { ...defaultPrefs });
  const one = doc.pages[0]!.items[0]!.id;
  const three = doc.pages[0]!.items[2]!.id;

  // Within a page: "one" in front of "three".
  expect(model.moveItemsBefore([one], three, 'A')).toBe(true);
  expect(doc.pages[0]!.items.map(i => i.text)).toEqual(['two', 'one', 'three']);

  // No `before`: lands at the end of the named page, even another one.
  expect(model.moveItemsBefore([one], null, 'B')).toBe(true);
  expect(doc.pages[1]!.items[0]!.text).toBe('one');

  // A `before` that exists elsewhere wins over the named page.
  expect(model.moveItemsBefore([three], one, 'A')).toBe(true);
  expect(doc.pages[1]!.items[0]!.text).toBe('three');

  // A vanished item moves nothing.
  expect(model.moveItemsBefore([999], null, 'A')).toBe(false);
});

test('moving several items keeps their order and a noop reports false', () => {
  const doc = parseDoc('## A\n\n- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four\n\n');
  const model = new Model(doc, { ...defaultPrefs });
  const ids = doc.pages[0]!.items.map(i => i.id);

  // "one" and "three" in front of "four": document order wins over the
  // order the ids were passed in.
  expect(model.moveItemsBefore([ids[2]!, ids[0]!], ids[3]!, 'A')).toBe(true);
  expect(doc.pages[0]!.items.map(i => i.text)).toEqual(['two', 'one', 'three', 'four']);

  // Dropping them right back where they already sit changes nothing,
  // and says so, so the caller does not rewrite the file.
  expect(model.moveItemsBefore([ids[0]!, ids[2]!], ids[3]!, 'A')).toBe(false);
});

test('old prefs without update channel preserves fields and defaults to stable', () => {
  const json = '{"active":"Work","zoom":1.2,"width":400.0,"height":800.0}';
  const { prefs, extra } = parsePrefs(json);
  expect(prefs.active).toBe('Work');
  expect(prefs.zoom).toBe(1.2);
  expect(prefs.update_channel).toBe('stable');
  // Behaviours a build this old never heard of arrive switched on.
  expect(prefs.check_on_copy).toBe(true);
  expect(prefs.group_done).toBe(true);
  expect(prefs.theme).toBe('dark');
  expect(extra.width).toBe(400.0);
  expect(extra.height).toBe(800.0);
});

test('beta channel and stable round trip parse', () => {
  expect(parsePrefs('{"update_channel":"beta"}').prefs.update_channel).toBe('beta');
  expect(parsePrefs('{"update_channel":"stable"}').prefs.update_channel).toBe('stable');
  expect(parsePrefs('{"update_channel":"dev"}').prefs.update_channel).toBe('dev');
});

test('unknown theme falls back to dark and keeps fields', () => {
  const json = '{"active":"Work","zoom":1.2,"width":400.0,"height":800.0,"theme":"sepia"}';
  const { prefs } = parsePrefs(json);
  expect(prefs.theme).toBe('dark');
  expect(prefs.zoom).toBe(1.2);

  const json2 = '{"active":"Work","zoom":1.0,"width":1.0,"height":1.0,"theme":"system"}';
  const { prefs: prefs2 } = parsePrefs(json2);
  expect(prefs2.theme).toBe('system');
});

test('a channel this build does not know falls back without losing the rest', () => {
  const json =
    '{"active":"Work","zoom":1.2,"width":400.0,"height":800.0,"update_channel":"nightly"}';
  const { prefs } = parsePrefs(json);
  expect(prefs.update_channel).toBe('stable');
  expect(prefs.active).toBe('Work');
  expect(prefs.zoom).toBe(1.2);
});

test('parsePrefs carries unknown keys', () => {
  const json = JSON.stringify({
    active: 'Home',
    zoom: 1.5,
    customField: 'hello',
    nested: { a: 1 },
    width: 380,
    height: 720,
  });
  const { prefs, extra } = parsePrefs(json);
  expect(prefs.active).toBe('Home');
  expect(prefs.zoom).toBe(1.5);
  expect(extra).toEqual({
    customField: 'hello',
    nested: { a: 1 },
    width: 380,
    height: 720,
  });

  // Non-json returns default prefs and empty extra
  expect(parsePrefs('invalid json')).toEqual({ prefs: defaultPrefs, extra: {} });
  expect(parsePrefs(null)).toEqual({ prefs: defaultPrefs, extra: {} });
});

test('adds an item to the active page', () => {
  const model = new Model(parseDoc(''), { ...defaultPrefs });
  const id = model.addItem('new task');
  expect(id).not.toBe(null);
  const activePage = model.doc.pages.find(p => p.name === model.prefs.active);
  expect(activePage?.items.some(i => i.text === 'new task')).toBe(true);
});

test('merge keeps position and done', () => {
  const md = '## Inbox\n\n- [x] first\n- [ ] second\n- [x] third\n';
  const doc = parseDoc(md);
  const ids = doc.pages[0]!.items.map(i => i.id);
  const model = new Model(doc, { ...defaultPrefs });

  expect(model.mergeItems([ids[0]!, ids[1]!])).toBe(true);
  const inbox = model.doc.pages[0]!;
  expect(inbox.items.length).toBe(2);
  expect(inbox.items[0]!.id).toBe(ids[0]!);
  expect(inbox.items[0]!.text).toBe('first\n\nsecond');
  expect(inbox.items[0]!.isDone).toBe(true);
  expect(inbox.items[1]!.id).toBe(ids[2]!);
});

test('move items before across pages and noop', () => {
  const md = '## PageA\n\n- [ ] item 1\n- [ ] item 2\n\n## PageB\n\n- [ ] item 3\n- [ ] item 4\n';
  const doc = parseDoc(md);
  const item1 = doc.pages[0]!.items[0]!.id;
  const item4 = doc.pages[1]!.items[1]!.id;
  const model = new Model(doc, { ...defaultPrefs });

  expect(model.moveItemsBefore([item1], item4, 'PageB')).toBe(true);
  expect(model.doc.pages[1]!.items.map(i => i.text)).toEqual(['item 3', 'item 1', 'item 4']);
  expect(model.doc.pages[0]!.items.length).toBe(1);

  // No-op drop back to where it already sits
  expect(model.moveItemsBefore([item1], item4, 'PageB')).toBe(false);
});

test('list text formatting plus check off', () => {
  const md = '## Inbox\n\n- [ ] first item\n- [ ] second\n  line\n';
  const doc = parseDoc(md);
  const ids = doc.pages[0]!.items.map(i => i.id);
  const model = new Model(doc, { ...defaultPrefs });

  // Single item
  expect(model.listText([ids[0]!])).toBe('first item');

  // Several items with multiline indentation
  expect(model.listText(ids)).toBe('1. first item\n2. second\n   line');

  // check_off with check_on_copy true
  model.setCheckOnCopy(true);
  expect(model.checkOff(ids)).toBe(true);
  expect(model.doc.pages[0]!.items[0]!.isDone).toBe(true);
  expect(model.doc.pages[0]!.items[1]!.isDone).toBe(true);

  // Second check_off is false because all are already checked
  expect(model.checkOff(ids)).toBe(false);

  // When check_on_copy is false, returns false
  model.setCheckOnCopy(false);
  model.doc.pages[0]!.items[0]!.isDone = false;
  expect(model.checkOff(ids)).toBe(false);
  expect(model.doc.pages[0]!.items[0]!.isDone).toBe(false);
});

test('delete page fallbacks', () => {
  const md = '## First\n\n## Second\n\n';
  const doc = parseDoc(md);
  const prefs = {
    ...defaultPrefs,
    active: 'First',
  };
  const model = new Model(doc, prefs);

  expect(model.deletePage('First')).toBe(true);
  expect(model.doc.pages.length).toBe(1);
  expect(model.doc.pages[0]!.name).toBe('Second');
  expect(model.prefs.active).toBe('Second');

  expect(model.deletePage('Second')).toBe(true);
  expect(model.doc.pages.length).toBe(1);
  expect(model.doc.pages[0]!.name).toBe(DEFAULT_PAGE);
  expect(model.prefs.active).toBe(DEFAULT_PAGE);
});

test('set zoom clamp and rounding', () => {
  const model = new Model(parseDoc(''), { ...defaultPrefs });
  expect(model.setZoom(1.5)).toBe(1.5);
  expect(model.prefs.zoom).toBe(1.5);

  expect(model.setZoom(1.234)).toBe(1.23);
  expect(model.prefs.zoom).toBe(1.23);

  // Clamp upper bound 2.0
  expect(model.setZoom(5.0)).toBe(2.0);
  expect(model.prefs.zoom).toBe(2.0);

  // Clamp lower bound 0.6
  expect(model.setZoom(0.1)).toBe(0.6);
  expect(model.prefs.zoom).toBe(0.6);
});

test('attachments lead the item and survive a round trip', () => {
  const md =
    '## Inbox\n\n- [ ] ![shot.png](attachments/abc.png)\n  [invoice.pdf](attachments/def.pdf)\n  Ask about Q3\n\n';
  const doc = parseDoc(md);
  const { attachments, body } = splitItem(doc.pages[0]!.items[0]!.text);
  expect(attachments).toEqual([
    { name: 'shot.png', ref: 'attachments/abc.png' },
    { name: 'invoice.pdf', ref: 'attachments/def.pdf' },
  ]);
  expect(body).toBe('Ask about Q3');
  expect(joinItem(attachments, body)).toBe(doc.pages[0]!.items[0]!.text);
  expect(serialiseDoc(doc)).toBe(md);
});

test('a link in the middle of the text is text', () => {
  const { attachments, body } = splitItem('see\n![x](attachments/a.png)');
  expect(attachments.length).toBe(0);
  expect(body).toBe('see\n![x](attachments/a.png)');
});

test('editing the body keeps the attachments', () => {
  const m = new Model(parseDoc(''), { ...defaultPrefs });
  const id = m.addItem('hello', undefined, [{ name: 'a.png', ref: 'attachments/a.png' }]);
  expect(id).toBeTruthy();
  m.updateItem(id as number, 'changed');
  expect(m.doc.pages[0]!.items[0]!.text).toBe('![a.png](attachments/a.png)\nchanged');
  // Blank body with a picture still there is still an item.
  m.updateItem(id as number, '   ');
  expect(m.doc.pages[0]!.items[0]!.text).toBe('![a.png](attachments/a.png)');
  // Taking the picture away from an item with no body deletes it.
  m.detach(id as number, 'attachments/a.png');
  expect(m.doc.pages[0]!.items.length).toBe(0);
});

test('attach dedupes and merge puts every attachment first', () => {
  const m = new Model(parseDoc(''), { ...defaultPrefs });
  const a = m.addItem('one', undefined, [{ name: 'a.png', ref: 'attachments/a.png' }]) as number;
  const b = m.addItem('two', undefined, [{ name: 'b.pdf', ref: 'attachments/b.pdf' }]) as number;
  expect(m.attach(a, [{ name: 'a.png', ref: 'attachments/a.png' }])).toBe(true);
  expect(splitItem(m.doc.pages[0]!.items[0]!.text).attachments.length).toBe(1);
  m.mergeItems([a, b]);
  expect(m.doc.pages[0]!.items[0]!.text).toBe(
    '![a.png](attachments/a.png)\n[b.pdf](attachments/b.pdf)\none\n\ntwo',
  );
});

test('copy lists attachments as paths before the text', () => {
  const m = new Model(parseDoc(''), { ...defaultPrefs });
  const a = m.addItem('Ask about Q3', undefined, [
    { name: 'a.png', ref: 'attachments/a.png' },
  ]) as number;
  const b = m.addItem('plain') as number;
  const pathOf = (ref: string) => `/data/${ref}`;
  expect(m.listText([a], pathOf)).toBe('Attached: `/data/attachments/a.png`\nAsk about Q3');
  expect(m.listText([a, b], pathOf)).toBe(
    '1. Attached: `/data/attachments/a.png`\n   Ask about Q3\n2. plain',
  );
  expect(m.attachmentRefs([a, b])).toEqual(['attachments/a.png']);
});

test('a note added to a page with a blank name is not lost', () => {
  const doc = parseDoc('##  \n\n- [ ] old\n');
  const model = new Model(doc, { ...defaultPrefs, active: '' });
  expect(model.addItem('new')).not.toBe(null);
  expect(model.doc.pages.some(p => p.items.some(i => i.text === 'new'))).toBe(true);
});
