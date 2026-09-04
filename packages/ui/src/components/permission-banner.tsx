import { useHost, usePermissions } from '../context.tsx';

export function PermissionBanner() {
  const host = useHost();
  const permissions = usePermissions();

  // Accessibility is the prerequisite, and Input Monitoring follows from it
  // without a prompt, so naming both at once would send people hunting for a
  // permission they never have to grant by hand.
  const missingPermission = !permissions.trusted
    ? 'Accessibility'
    : !permissions.inputMonitoring
      ? 'Input Monitoring'
      : null;

  if (!missingPermission) return null;

  return (
    <button
      onClick={() => void host.permissions.request()}
      className="shrink-0 bg-amber-500/15 px-3 py-2 text-left text-xs text-amber-700 dark:text-amber-300"
    >
      Double-tap Shift needs {missingPermission}. Click to open Settings.
    </button>
  );
}
