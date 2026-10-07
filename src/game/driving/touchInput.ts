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
  const boosts = new Map<number, { originY: number; direction: number }>();
  return {
    get position() { return position; },
    get stickPointer() { return stick; },
    get boostDirection() { return [...boosts.values()].find(gesture => gesture.direction)?.direction ?? 0; },
    pressStick(id: number) { if (stick !== undefined) return false; stick = id; return true; },
    moveStick(id: number, x: number, y: number, radius: number) {
      if (id === stick) position = joystickPosition(x, y, radius);
    },
    pressBoost(id: number, originY = 0) { boosts.set(id, { originY, direction: 0 }); },
    /** One altitude step per swipe; returning near the press point rearms it. */
    moveBoost(id: number, y: number): number {
      const gesture = boosts.get(id);
      if (!gesture) return 0;
      const offset = y - gesture.originY;
      if (Math.abs(offset) <= 10) { gesture.direction = 0; return 0; }
      if (gesture.direction || Math.abs(offset) < 28) return 0;
      gesture.direction = offset < 0 ? 1 : -1;
      return gesture.direction;
    },
    release(id: number) {
      const wasBoosting = boosts.size > 0;
      boosts.delete(id);
      if (id === stick) { stick = undefined; position = joystickPosition(0, 0, 1); }
      return wasBoosting && boosts.size === 0;
    },
    reset() { stick = undefined; boosts.clear(); position = joystickPosition(0, 0, 1); },
    read(running: boolean): TouchDrivingInput {
      return { throttle: running && !position.brake, brake: running && position.brake, steer: running ? position.steer : 0, boost: running && boosts.size > 0 };
    },
  };
}
