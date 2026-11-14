/**
 * The signed-in account's invite link, and whether the account joined through
 * one. Both are null until api.agnt.gg answers, and stay null when it cannot:
 * a missing link hides the invite rather than offering a broken one.
 */
import { computed, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { fetchReferralProfile, inviteLink } from '@/services/referral/referralProgram.js';

export function useInviteLink() {
  const store = useStore();
  const profile = ref(null);
  const email = computed(() => store?.getters?.['userAuth/userEmail'] || '');

  watch(
    email,
    async (address) => {
      profile.value = null;
      if (!address) return;
      const answer = await fetchReferralProfile({ email: address, token: store?.state?.userAuth?.token });
      // Another account signed in while this one was being read: its answer wins.
      if (email.value === address) profile.value = answer;
    },
    { immediate: true },
  );

  return {
    link: computed(() => (profile.value?.code ? inviteLink(profile.value.code) : null)),
    invited: computed(() => profile.value?.invited ?? null),
  };
}
