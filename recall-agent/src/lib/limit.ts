import { chatMaxInflight, chatSlotWaitMs } from "@/lib/env";

type Waiter = {
  resume: (got: boolean) => void;
};

const state = {
  active: 0,
  waiters: [] as Waiter[],
};

export type ChatSlot =
  | { ok: true; release: () => void }
  | { ok: false; waiting: number; waitMs: number };

export function chatGateSnapshot() {
  return {
    active: state.active,
    waiting: state.waiters.length,
    max: chatMaxInflight(),
  };
}

export function acquireChatSlot(): Promise<ChatSlot> {
  const max = chatMaxInflight();
  const waitMs = chatSlotWaitMs();

  if (state.active < max) {
    state.active += 1;
    return Promise.resolve({ ok: true, release });
  }

  if (waitMs <= 0) {
    return Promise.resolve({
      ok: false,
      waiting: state.waiters.length,
      waitMs,
    });
  }

  return new Promise((resolve) => {
    const waiter: Waiter = {
      resume(got) {
        if (got) {
          state.active += 1;
          resolve({ ok: true, release });
        } else {
          resolve({
            ok: false,
            waiting: state.waiters.length,
            waitMs,
          });
        }
      },
    };
    state.waiters.push(waiter);
    setTimeout(() => {
      const idx = state.waiters.indexOf(waiter);
      if (idx < 0) return;
      state.waiters.splice(idx, 1);
      waiter.resume(false);
    }, waitMs);
  });
}

function release() {
  state.active = Math.max(0, state.active - 1);
  const next = state.waiters.shift();
  if (next) next.resume(true);
}
