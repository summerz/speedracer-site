export interface TouchDrivingInput { throttle: boolean; brake: boolean; steer: number; boost: boolean }

/** Circular travel, analog horizontal steering, and a lower braking zone. */
export function joystickPosition(x: number, y: number, radius: number) {
  const length = Math.hypot(x, y);
  const scale = length > radius ? radius / length : 1;
  const px = x * scale / radius, py = y * scale / radius;
  const deadzone = .12;
  return { x: px, y: py, steer: Math.abs(px) <= deadzone ? 0 : Math.sign(px) * (Math.abs(px) - deadzone) / (1 - deadzone), brake: py > .28 };
}

/** A finger owns one control. Ending any other finger cannot release it. */
export function createTouchInput() {
  let stick: number | undefined;
  let position = joystickPosition(0, 0, 1);
  let boost: { id: number; originY: number; originLevel: number; level: number; count: number; step: number; top: number; bottom: number; y: number } | undefined;
  return {
    get position() { return position; },
    get stickPointer() { return stick; },
    get boostDirection() { return boost ? Math.sign(boost.level - boost.originLevel) : 0; },
    get boostPosition() { return boost ? (boost.y - boost.top) / (boost.bottom - boost.top) : null; },
    pressStick(id: number) { if (stick !== undefined) return false; stick = id; return true; },
    moveStick(id: number, x: number, y: number, radius: number) {
      if (id === stick) position = joystickPosition(x, y, radius);
    },
    pressBoost(id: number, originY = 0, level = 0, count = 2, top = originY - 120, bottom = originY + 120) {
      if (boost) return false;
      // The field stays the same size for every profile. More levels divide its travel.
      const travel = Math.max(24, Math.min(originY - top, bottom - originY) - 8);
      boost = { id, originY, originLevel: level, level, count, top, bottom, y: originY,
        step: travel / Math.max(1, count - 1) };
      return true;
    },
    /** Absolute selection anchored at press time; no recentering between levels. */
    moveBoost(id: number, y: number): number | undefined {
      if (!boost || id !== boost.id) return;
      boost.y = Math.max(boost.top, Math.min(boost.bottom, y));
      const offset = boost.originY - boost.y;
      const value = Math.sign(offset) * Math.max(0, Math.abs(offset) - 8) / boost.step;
      const previous = boost.level;
      // Six pixels of hysteresis keep boundary jitter from switching back and forth.
      const margin = Math.min(6 / boost.step, .2);
      while (boost.level < boost.count - 1 && value > boost.level - boost.originLevel + .5 + margin) boost.level++;
      while (boost.level > 0 && value < boost.level - boost.originLevel - .5 - margin) boost.level--;
      return boost.level === previous ? undefined : boost.level;
    },
    release(id: number) {
      const stoppedBoost = boost?.id === id;
      if (stoppedBoost) boost = undefined;
      if (id === stick) { stick = undefined; position = joystickPosition(0, 0, 1); }
      return stoppedBoost;
    },
    reset() { stick = undefined; boost = undefined; position = joystickPosition(0, 0, 1); },
    read(running: boolean): TouchDrivingInput {
      return { throttle: running && !position.brake, brake: running && position.brake, steer: running ? position.steer : 0, boost: running && boost !== undefined };
    },
  };
}
