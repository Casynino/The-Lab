// A guard that lets one press through until its request has finished. React's busy state arrives a render
// late, so two clicks in the same frame both fired (audit admin-ops-3: "Settlement approved" and then
// "This submission was already decided."). Keyed, so on a list one row being approved does not block
// another row. Pure, so it is tested without React (once.test.mjs); useOnce wraps it in a hook.
export function makeOnce() {
  const busy = new Set();
  return {
    // Runs fn unless the same key is still in flight. Returns whether it ran.
    run(fn, key = '*') {
      if (busy.has(key)) return false;
      busy.add(key);
      fn();
      return true;
    },
    // Frees one key — for onSettled: (_data, _error, id) => once.release(id).
    release(key = '*') { busy.delete(key); },
    // Frees every key; safe as onSettled: once.done (it ignores the arguments React Query passes).
    done() { busy.clear(); },
    isBusy(key = '*') { return busy.has(key); },
  };
}

// A 409 from a money write that the server lets through once — a deduction, a commission correction, a
// forgiven fine — means the same press already went through: a double tap, or a retry after the first
// answer was lost. The window treats it as done (closes, reloads the balances, says so), not as an error,
// so nobody changes the note by one letter and sends it again (audit backend-integrity-2).
export const wentThrough = (error) => error?.response?.status === 409;
