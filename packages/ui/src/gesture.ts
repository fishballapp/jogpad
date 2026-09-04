import type { GestureInput, Host } from './host.ts';
import type { Store } from './store.ts';

export type { GestureInput };

/// One gesture covers the three things you can want from a scratchpad: put
/// away the one you are typing in, file what you have selected, or open it to
/// type. Which one you meant is decided by where the keyboard is and whether
/// anything is selected.
export async function runGesture(input: GestureInput, store: Store, host: Host): Promise<void> {
  if (input.focused) {
    await host.window.hide();
    return;
  }
  if (input.selection) {
    // File first, then show without taking the keyboard: you double-tapped
    // in the middle of reading something, and the next thing you type
    // belongs in that app, not here.
    await store.capture(input.selection);
    await host.window.show({ focus: false });
    return;
  }
  await host.window.show({ focus: true });
}
