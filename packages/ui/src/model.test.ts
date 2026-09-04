import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PAGE,
  type Doc,
  defaultPrefs,
  Model,
  normalisePageName,
  parseDoc,
  parsePrefs,
  serialiseDoc,
} from './model.ts';

function stripIds(doc: Doc): Array<[string, Array<[string, boolean]>]> {
  return doc.pages.map(s => [s.name, s.items.map(i => [i.text, i.done])]);
}

test('round_trips', () => {
  const md =
    '## Inbox\n\n- [ ] plain\n- [x] done\n- [ ] multi\n  second line\n\n  after a blank\n\n## Refactor\n\n- [ ] only one\n\n';
  const doc = parseDoc(md);
  assert.equal(doc.pages.length, 2);
  assert.equal(doc.pages[0].items.length, 3);
  assert.equal(doc.pages[0].items[2].text, 'multi\nsecond line\n\nafter a blank');
  assert.equal(doc.pages[0].items[1].done, true);
  assert.equal(serialiseDoc(doc), md);
  assert.deepEqual(stripIds(doc), stripIds(parseDoc(serialiseDoc(doc))));
});

test('headless_bullets_land_in_the_default_page', () => {
  const doc = parseDoc('- loose note\n');
  assert.equal(doc.pages[0].name, DEFAULT_PAGE);
  assert.equal(doc.pages[0].items[0].text, 'loose note');
});

test('empty_file_still_has_a_page', () => {
  assert.equal(parseDoc('').pages.length, 1);
});

test('page_names_reject_anything_that_would_break_the_file', () => {
  assert.equal(normalisePageName('  Inbox  '), 'Inbox');
  assert.equal(normalisePageName(''), null);
  assert.equal(normalisePageName('   '), null);
  // A multiline composer makes this reachable by pasting.
  assert.equal(normalisePageName('Inbox\n## Injected'), null);
  assert.equal(normalisePageName('Inbox\rInjected'), null);
});

test('move_items_before_reorders_within_and_across_pages', () => {
  const doc = parseDoc('## A\n\n- [ ] one\n- [ ] two\n- [ ] three\n\n## B\n\n');
  const model = new Model(doc, { ...defaultPrefs });
  const one = doc.pages[0].items[0].id;
  const three = doc.pages[0].items[2].id;

  // Within a page: "one" in front of "three".
  assert.equal(model.moveItemsBefore([one], three, 'A'), true);
  assert.deepEqual(
    doc.pages[0].items.map(i => i.text),
    ['two', 'one', 'three'],
  );

  // No `before`: lands at the end of the named page, even another one.
  assert.equal(model.moveItemsBefore([one], null, 'B'), true);
  assert.equal(doc.pages[1].items[0].text, 'one');

  // A `before` that exists elsewhere wins over the named page.
  assert.equal(model.moveItemsBefore([three], one, 'A'), true);
  assert.equal(doc.pages[1].items[0].text, 'three');

  // A vanished item moves nothing.
  assert.equal(model.moveItemsBefore([999], null, 'A'), false);
});

test('moving_several_items_keeps_their_order_and_a_noop_reports_false', () => {
  const doc = parseDoc('## A\n\n- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four\n\n');
  const model = new Model(doc, { ...defaultPrefs });
  const ids = doc.pages[0].items.map(i => i.id);

  // "one" and "three" in front of "four": document order wins over the
  // order the ids were passed in.
  assert.equal(model.moveItemsBefore([ids[2], ids[0]], ids[3], 'A'), true);
  assert.deepEqual(
    doc.pages[0].items.map(i => i.text),
    ['two', 'one', 'three', 'four'],
  );

  // Dropping them right back where they already sit changes nothing,
  // and says so, so the caller does not rewrite the file.
  assert.equal(model.moveItemsBefore([ids[0], ids[2]], ids[3], 'A'), false);
});

test('old_prefs_without_update_channel_preserves_fields_and_defaults_to_stable', () => {
  const json = '{"active":"Work","zoom":1.2,"width":400.0,"height":800.0}';
  const { prefs, extra } = parsePrefs(json);
  assert.equal(prefs.active, 'Work');
  assert.equal(prefs.zoom, 1.2);
  assert.equal(prefs.update_channel, 'stable');
  // Behaviours a build this old never heard of arrive switched on.
  assert.equal(prefs.check_on_copy, true);
  assert.equal(prefs.group_done, true);
  assert.equal(prefs.theme, 'dark');
  assert.equal(extra.width, 400.0);
  assert.equal(extra.height, 800.0);
});

test('beta_channel_and_stable_round_trip_parse', () => {
  assert.equal(parsePrefs('{"update_channel":"beta"}').prefs.update_channel, 'beta');
  assert.equal(parsePrefs('{"update_channel":"stable"}').prefs.update_channel, 'stable');
  assert.equal(parsePrefs('{"update_channel":"dev"}').prefs.update_channel, 'dev');
});

test('unknown_theme_falls_back_to_dark_and_keeps_fields', () => {
  const json = '{"active":"Work","zoom":1.2,"width":400.0,"height":800.0,"theme":"sepia"}';
  const { prefs } = parsePrefs(json);
  assert.equal(prefs.theme, 'dark');
  assert.equal(prefs.zoom, 1.2);

  const json2 = '{"active":"Work","zoom":1.0,"width":1.0,"height":1.0,"theme":"system"}';
  const { prefs: prefs2 } = parsePrefs(json2);
  assert.equal(prefs2.theme, 'system');
});

test('a_channel_this_build_does_not_know_falls_back_without_losing_the_rest', () => {
  const json =
    '{"active":"Work","zoom":1.2,"width":400.0,"height":800.0,"update_channel":"nightly"}';
  const { prefs } = parsePrefs(json);
  assert.equal(prefs.update_channel, 'stable');
  assert.equal(prefs.active, 'Work');
  assert.equal(prefs.zoom, 1.2);
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
  assert.equal(prefs.active, 'Home');
  assert.equal(prefs.zoom, 1.5);
  assert.deepEqual(extra, {
    customField: 'hello',
    nested: { a: 1 },
    width: 380,
    height: 720,
  });

  // Non-json returns default prefs and empty extra
  assert.deepEqual(parsePrefs('invalid json'), { prefs: defaultPrefs, extra: {} });
  assert.deepEqual(parsePrefs(null), { prefs: defaultPrefs, extra: {} });
});

test('add_item', () => {
  const model = new Model(parseDoc(''), { ...defaultPrefs });
  const id = model.addItem('new task');
  assert.notEqual(id, null);
  const activePage = model.doc.pages.find(p => p.name === model.prefs.active);
  assert.equal(
    activePage?.items.some(i => i.text === 'new task'),
    true,
  );
});

test('merge_keeps_position_and_done', () => {
  const md = '## Inbox\n\n- [x] first\n- [ ] second\n- [x] third\n';
  const doc = parseDoc(md);
  const ids = doc.pages[0].items.map(i => i.id);
  const model = new Model(doc, { ...defaultPrefs });

  assert.equal(model.mergeItems([ids[0], ids[1]]), true);
  const inbox = model.doc.pages[0];
  assert.equal(inbox.items.length, 2);
  assert.equal(inbox.items[0].id, ids[0]);
  assert.equal(inbox.items[0].text, 'first\n\nsecond');
  assert.equal(inbox.items[0].done, true);
  assert.equal(inbox.items[1].id, ids[2]);
});

test('move_items_before_across_pages_and_noop', () => {
  const md = '## PageA\n\n- [ ] item 1\n- [ ] item 2\n\n## PageB\n\n- [ ] item 3\n- [ ] item 4\n';
  const doc = parseDoc(md);
  const item1 = doc.pages[0].items[0].id;
  const item4 = doc.pages[1].items[1].id;
  const model = new Model(doc, { ...defaultPrefs });

  assert.equal(model.moveItemsBefore([item1], item4, 'PageB'), true);
  assert.deepEqual(
    model.doc.pages[1].items.map(i => i.text),
    ['item 3', 'item 1', 'item 4'],
  );
  assert.equal(model.doc.pages[0].items.length, 1);

  // No-op drop back to where it already sits
  assert.equal(model.moveItemsBefore([item1], item4, 'PageB'), false);
});

test('list_text_formatting_plus_check_off', () => {
  const md = '## Inbox\n\n- [ ] first item\n- [ ] second\n  line\n';
  const doc = parseDoc(md);
  const ids = doc.pages[0].items.map(i => i.id);
  const model = new Model(doc, { ...defaultPrefs });

  // Single item
  assert.equal(model.listText([ids[0]]), 'first item');

  // Several items with multiline indentation
  assert.equal(model.listText(ids), '1. first item\n2. second\n   line');

  // check_off with check_on_copy true
  model.setCheckOnCopy(true);
  assert.equal(model.checkOff(ids), true);
  assert.equal(model.doc.pages[0].items[0].done, true);
  assert.equal(model.doc.pages[0].items[1].done, true);

  // Second check_off is false because all are already checked
  assert.equal(model.checkOff(ids), false);

  // When check_on_copy is false, returns false
  model.setCheckOnCopy(false);
  model.doc.pages[0].items[0].done = false;
  assert.equal(model.checkOff(ids), false);
  assert.equal(model.doc.pages[0].items[0].done, false);
});

test('delete_page_fallbacks', () => {
  const md = '## First\n\n## Second\n\n';
  const doc = parseDoc(md);
  const prefs = {
    ...defaultPrefs,
    active: 'First',
  };
  const model = new Model(doc, prefs);

  assert.equal(model.deletePage('First'), true);
  assert.equal(model.doc.pages.length, 1);
  assert.equal(model.doc.pages[0].name, 'Second');
  assert.equal(model.prefs.active, 'Second');

  assert.equal(model.deletePage('Second'), true);
  assert.equal(model.doc.pages.length, 1);
  assert.equal(model.doc.pages[0].name, DEFAULT_PAGE);
  assert.equal(model.prefs.active, DEFAULT_PAGE);
});

test('set_zoom_clamp_and_rounding', () => {
  const model = new Model(parseDoc(''), { ...defaultPrefs });
  assert.equal(model.setZoom(1.5), 1.5);
  assert.equal(model.prefs.zoom, 1.5);

  assert.equal(model.setZoom(1.234), 1.23);
  assert.equal(model.prefs.zoom, 1.23);

  // Clamp upper bound 2.0
  assert.equal(model.setZoom(5.0), 2.0);
  assert.equal(model.prefs.zoom, 2.0);

  // Clamp lower bound 0.6
  assert.equal(model.setZoom(0.1), 0.6);
  assert.equal(model.prefs.zoom, 0.6);
});
