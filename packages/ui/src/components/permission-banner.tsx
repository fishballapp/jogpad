import { missingPermission, useHost, usePermissions } from '../context.tsx';

export function PermissionBanner() {
  const host = useHost();
  const permissions = usePermissions();

  const missing = missingPermission(permissions);
  if (!missing) return null;

  return (
    <button
      onClick={() => void host.permissions.request()}
      className="shrink-0 bg-amber-500/15 px-3 py-2 text-left text-xs text-amber-700 dark:text-amber-300"
    >
      Double-tap Shift needs {missing}. Click to open Settings.
    </button>
  );
}
