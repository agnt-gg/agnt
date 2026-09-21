/** Subscribe to verified credential updates without persisting or logging tokens. */
export function installWorkCredentialRecovery({ subscribe, store, scheduler, onError = console.error }) {
  let closed = false;
  const unsubscribe = subscribe(({ userId }) => {
    if (closed || !userId) return;
    // The callback deliberately ignores the credential value. Resumption resolves
    // current authority again at execution time, including revocation checks.
    store.run(`UPDATE conversation_work SET status='queued',next_wake=0,
      reason='credential_updated',updated_at=? WHERE owner_id=? AND status='waiting_auth'`,
    [Date.now(),userId]).then(() => { if (!closed) return scheduler.tick(); }).catch(onError);
  });
  return () => {closed=true;unsubscribe();};
}
