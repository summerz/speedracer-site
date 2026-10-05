export type PadAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause' | 'cockpit' | 'track' | 'focus';
export interface PadSnapshot { connected: boolean; steer: number; brake: boolean; boost: boolean }
export interface PadSample { mapping: string; axes: readonly number[]; buttons: readonly { pressed: boolean; value: number }[] }
export const gamepadDriving: PadSnapshot = { connected: false, steer: 0, brake: false, boost: false };

/** Normalize standard-layout controllers; edge actions and menu repeats use a shared clock. */
export function createPadReader() {
  let held = new Set<PadAction>(), nextRepeat = 0, direction: PadAction | undefined;
  let boostArmed = false, wasDriving = false;
  return {
    read(pad: PadSample | null, now: number, driving: boolean) {
      const pressed = (index: number) => !!pad?.buttons[index]?.pressed || (pad?.buttons[index]?.value ?? 0) > .5;
      const connected = pad?.mapping === 'standard';
      const axis = connected && Number.isFinite(pad?.axes[0]) ? pad!.axes[0] : 0;
      const steer = Math.abs(axis) <= .18 ? 0 : Math.sign(axis) * Math.min(1, (Math.abs(axis) - .18) / .82);
      const current = new Set<PadAction>();
      if (connected) {
        if (pressed(12) || (!driving && (pad?.axes[1] ?? 0) < -.55)) current.add('up');
        if (pressed(13) || (!driving && (pad?.axes[1] ?? 0) > .55)) current.add('down');
        if (pressed(14) || (!driving && axis < -.55)) current.add('left');
        if (pressed(15) || (!driving && axis > .55)) current.add('right');
        for (const [index, action] of [[0,'confirm'],[1,'back'],[2,'cockpit'],[3,'track'],[4,'focus'],[9,'pause']] as const) if (pressed(index)) current.add(action);
      }
      const actions = [...current].filter(action => !held.has(action));
      const nextDirection = (['up','down','left','right'] as const).find(action => current.has(action));
      if (driving || !nextDirection) { direction = undefined; nextRepeat = 0; }
      else if (nextDirection !== direction) { direction = nextDirection; nextRepeat = now + 400; }
      else if (now >= nextRepeat) { if (!actions.includes(nextDirection)) actions.push(nextDirection); nextRepeat = now + 150; }
      if (!driving || !wasDriving) boostArmed = false;
      if (connected && driving && !pressed(7) && !pressed(5)) boostArmed = true;
      const snapshot = { connected, steer: driving ? steer : 0, brake: connected && driving && pressed(6), boost: connected && driving && boostArmed && (pressed(7) || pressed(5)) };
      held = current; wasDriving = driving;
      return { actions, snapshot };
    },
  };
}
