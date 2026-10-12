import type { GestureInput, Host } from './host.ts';
import type { Store } from './store.ts';

/**
 * One gesture covers the three things you can want from a scratchpad: put
 * away the one you are typing in, file what you have selected, or open it to
 * type. Which one you meant is decided by where the keyboard is and whether
 * anything is selected.
 */
export async function runGesture(
  { focused: isFocused, selection }: GestureInput,
  store: Store,
  host: Host,
): Promise<void> {
  if (isFocused) {
    await host.window.hide();
    return;
  }
  if (selection) {
    // File first, then show without taking the keyboard: you double-tapped
    // in the middle of reading something, and the next thing you type
    // belongs in that app, not here.
    await store.capture(selection);
    await host.window.show({ focus: false });
    return;
  }
  await host.window.show({ focus: true });
  // The panel has the keyboard; now put it in the composer. Done here, not
  // by each host, so no host can forget to.
  store.emit('focus-input', undefined);
}
