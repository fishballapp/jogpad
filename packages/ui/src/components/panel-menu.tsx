import {
  ArrowCircleDownIcon,
  DotsThreeVerticalIcon,
  EyeSlashIcon,
  GearSixIcon,
  PowerIcon,
  ShieldCheckIcon,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { missingPermission, useHost, usePermissions, useSnapshot } from '../context.tsx';
import type { UpdateInfo } from '../host.ts';
import { Flash, useToast } from '../toast.tsx';
import { Button } from './ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.tsx';

export function PanelMenu() {
  const host = useHost();
  const permissions = usePermissions();
  const snap = useSnapshot();

  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const { flash, toast } = useToast();

  const checkGenRef = useRef(0);

  const checkForUpdate = useCallback(
    async (userInitiated = false) => {
      const generation = ++checkGenRef.current;
      setChecking(true);
      // Rust clears the pending offer when a check starts, including one
      // that fails, so a check you asked for starts from nothing. The hourly
      // one does not: it must not close the dialog you are reading, or an
      // install in progress.
      if (userInitiated) {
        setUpdate(null);
        setUpdateDialogOpen(false);
      }
      try {
        const info = await host.updates.check(snap.update_channel);
        if (generation !== checkGenRef.current) return;
        setUpdate(info);
        if (userInitiated && !info) {
          toast('JogPad is up to date');
        }
      } catch (e) {
        if (generation !== checkGenRef.current) return;
        if (userInitiated) toast(`Update check failed: ${e}`);
      } finally {
        if (generation === checkGenRef.current) setChecking(false);
      }
    },
    [host, snap.update_channel, toast],
  );

  useEffect(() => {
    void checkForUpdate(false);
    const hourly = window.setInterval(() => void checkForUpdate(false), 60 * 60 * 1000);
    return () => {
      window.clearInterval(hourly);
      checkGenRef.current++;
    };
  }, [checkForUpdate]);

  const missing = missingPermission(permissions);

  return (
    <>
      {/* A slot that is always there, first in the header's controls, so an
          update appearing moves nothing else. */}
      <span className="-order-1 flex size-7 items-center justify-center">
        {update && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" onClick={() => setUpdateDialogOpen(true)} />
              }
              aria-label={`Update to v${update.version}`}
            >
              <ArrowCircleDownIcon className="text-primary" />
            </TooltipTrigger>
            <TooltipContent>{`Update to v${update.version}`}</TooltipContent>
          </Tooltip>
        )}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />} aria-label="More">
          <DotsThreeVerticalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-56 [&_[data-slot=dropdown-menu-item]]:whitespace-nowrap"
        >
          {missing && (
            <DropdownMenuItem onClick={() => void host.permissions.request()}>
              <ShieldCheckIcon /> Grant {missing}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => void host.settings.open()}>
            <GearSixIcon /> Settings…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={checking} onClick={() => void checkForUpdate(true)}>
            <ArrowCircleDownIcon /> {checking ? 'Checking for Updates…' : 'Check for Updates…'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void host.window.hide()}>
            <EyeSlashIcon /> Hide
            <DropdownMenuShortcut>⌘W</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => void host.window.quit()}>
            <PowerIcon /> Quit JogPad
            <DropdownMenuShortcut>⌘Q</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={updateDialogOpen && update !== null} onOpenChange={setUpdateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>JogPad {update?.version} is available</DialogTitle>
            <DialogDescription className="max-h-60 overflow-y-auto whitespace-pre-wrap text-left text-foreground">
              {update?.notes?.trim() || 'No release notes.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUpdateDialogOpen(false)}
              disabled={installing}
            >
              Later
            </Button>
            <Button
              disabled={installing}
              onClick={async () => {
                setInstalling(true);
                try {
                  await host.updates.install(snap.update_channel);
                } catch (e) {
                  setInstalling(false);
                  setUpdateDialogOpen(false);
                  setUpdate(null);
                  toast(`Installation failed: ${e}`);
                }
              }}
            >
              {installing ? 'Installing…' : 'Install and Restart'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Flash message={flash} />
    </>
  );
}
