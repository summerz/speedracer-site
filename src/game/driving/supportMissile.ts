/** Player-only automatic consumable. All durations use unpaused real race seconds. */
export const SUPPORT_MISSILE_FLIGHT = .4;
export const SUPPORT_MISSILE_STOP = 2;
export type MissilePosition = { x: number; y: number; z: number };
export interface MissileRacer {
  id: string; active: boolean; distance: number; offset: number; altitude: number;
  routeId: string | null; position: MissilePosition;
}
export interface SupportMissileSnapshot {
  phase: 'armed' | 'waiting' | 'flying' | 'hit' | 'spent';
  requestId: number | null; canLaunch: boolean; targetId: string | null;
  progress: number; position: MissilePosition | null; launchPosition: MissilePosition | null;
  /** Monotonic within this race; retained after the hit so slow HUD frames cannot miss it. */
  hitEventId: number;
  stopRemaining: number;
}
const closeEnough = (player: MissileRacer, rival: MissileRacer, range: number) => {
  const gap = rival.distance - player.distance;
  return player.active && rival.active && rival.routeId === player.routeId && gap >= 0 && gap <= range
    && Math.abs(rival.offset - player.offset) <= 10 && Math.abs(rival.altitude - player.altitude) <= 1.5;
};
const worldDistance = (a: MissilePosition, b: MissilePosition) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function createSupportMissile() {
  let spent = false, serial = 0, hitEventId = 0, targetId: string | null = null;
  let requestId: number | null = null, requestAge = 0, flight = 0, stopRemaining = 0;
  let launchPosition: MissilePosition | null = null, position: MissilePosition | null = null;
  const behind = new Set<string>();
  const previous = new Map<string, number>();
  const clearRequest = () => { requestId = null; requestAge = 0; if (!spent) targetId = null; };
  const target = (rivals: readonly MissileRacer[]) => rivals.find(rival => rival.id === targetId);
  const canLaunch = (player: MissileRacer, rivals: readonly MissileRacer[], cooldown: number) => {
    const rival = target(rivals);
    return !spent && requestId !== null && cooldown <= 1e-8 && !!rival && closeEnough(player, rival, 180);
  };
  return {
    /** A boundary keeps hit/expiration exact even at low rendering frame rates. */
    boundary: () => flight > 1e-8 ? flight : stopRemaining > 1e-8 ? stopRemaining : Infinity,
    stopped: (id: string) => targetId === id && stopRemaining > 1e-8,
    snapshot(player: MissileRacer, rivals: readonly MissileRacer[], cooldown: number): SupportMissileSnapshot {
      return { phase: !spent ? requestId === null ? 'armed' : 'waiting' : flight > 1e-8 ? 'flying' : stopRemaining > 1e-8 ? 'hit' : 'spent',
        requestId, canLaunch: canLaunch(player, rivals, cooldown), targetId,
        progress: spent ? Math.min(1, 1 - flight / SUPPORT_MISSILE_FLIGHT) : 0,
        position: position && { ...position }, launchPosition: launchPosition && { ...launchPosition }, hitEventId, stopRemaining };
    },
    launch(id: number, player: MissileRacer, rivals: readonly MissileRacer[], cooldown: number) {
      if (id !== requestId || !canLaunch(player, rivals, cooldown)) return false;
      spent = true; requestId = null; flight = SUPPORT_MISSILE_FLIGHT;
      launchPosition = { ...player.position }; position = { ...launchPosition }; return true;
    },
    reject(id: number) { if (id === requestId) clearRequest(); },
    step(dt: number, player: MissileRacer, rivals: readonly MissileRacer[]) {
      stopRemaining = Math.max(0, stopRemaining - dt);
      const rival = target(rivals);
      if (flight > 1e-8) {
        if (!player.active || !rival?.active) { flight = 0; position = null; return; }
        flight = Math.max(0, flight - dt);
        const u = 1 - flight / SUPPORT_MISSILE_FLIGHT, from = launchPosition!;
        position = { x: from.x + (rival.position.x - from.x) * u,
          y: from.y + (rival.position.y - from.y) * u, z: from.z + (rival.position.z - from.z) * u };
        if (flight <= 1e-8) { flight = 0; stopRemaining = SUPPORT_MISSILE_STOP; hitEventId++; }
      }
      if (spent) return;
      if (requestId !== null) {
        requestAge += dt;
        if (!rival || !closeEnough(player, rival, 180) || requestAge > 4) clearRequest();
      }
      for (const racer of rivals) {
        const gap = racer.distance - player.distance, prior = previous.get(racer.id);
        if (gap <= -2) behind.add(racer.id);
        if (prior !== undefined && prior < 2 && gap >= 2) {
          const overtook = behind.delete(racer.id);
          if (overtook && requestId === null && closeEnough(player, racer, 20)
            && worldDistance(player.position, racer.position) <= 24) {
            targetId = racer.id; requestId = ++serial; requestAge = 0;
          }
        }
        previous.set(racer.id, gap);
      }
    },
  };
}
