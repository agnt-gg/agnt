<template>
  <Transition name="modal-fade">
    <div v-if="show" class="terms-overlay" @click.self="close">
      <div class="terms-modal">
        <!-- Header with tabs -->
        <div class="modal-header">
          <h2>Legal Information</h2>
          <button @click="close" class="close-btn" aria-label="Close">×</button>
        </div>

        <!-- Tab Navigation -->
        <div class="tab-nav">
          <button :class="{ active: activeTab === 'license' }" @click="activeTab = 'license'" class="tab-btn">License</button>
          <button :class="{ active: activeTab === 'terms' }" @click="activeTab = 'terms'" class="tab-btn">Terms</button>
          <button :class="{ active: activeTab === 'privacy' }" @click="activeTab = 'privacy'" class="tab-btn">Privacy</button>
        </div>

        <!-- Content Area -->
        <div ref="modalBody" class="modal-body">
          <Transition name="tab-fade" mode="out-in">
            <!-- License: rendered from the repository LICENSE.md, the single source of truth -->
            <div v-if="activeTab === 'license'" key="license" class="content-section">
              <div v-if="licenseError" class="content-text">
                <p>
                  The license could not be loaded. Read it at
                  <a href="https://agnt.gg/LICENSE.md" target="_blank" rel="noopener">agnt.gg/LICENSE.md</a>.
                </p>
              </div>
              <div v-else class="content-text license-text" v-html="licenseHtml"></div>
            </div>

            <!-- Terms of Service -->
            <div v-else-if="activeTab === 'terms'" key="terms" class="content-section">
              <h3>Terms of Service</h3>
              <p class="subtitle-text">Usage Policies & User Responsibilities</p>
              <p class="last-updated">Last Updated: November 24, 2025</p>

              <div class="content-text">
                <h4>1. ACCEPTANCE OF TERMS</h4>
                <p>
                  By using AGNT, you ("The Node") agree to be bound by these Terms of Service. These terms govern your use of the platform and
                  services provided by AGNT GG, Inc. ("The Protocol").
                </p>

                <h4>2. ALPHA SOFTWARE NOTICE</h4>
                <div class="warning-box">
                  <strong>⚠️ INDUSTRIAL ALPHA STATE</strong>
                  <p>
                    AGNT is currently in Industrial Alpha. The software is experimental and may contain bugs, crashes, and unexpected behavior. By
                    using the platform, you acknowledge this is part of the development process.
                  </p>
                </div>

                <h4>3. USER RESPONSIBILITIES</h4>
                <p>You are solely responsible for:</p>
                <ul>
                  <li>The configuration and behavior of your autonomous agents</li>
                  <li>All actions taken by agents you create or deploy</li>
                  <li>Ensuring your use complies with applicable laws and third-party terms of service</li>
                  <li>Maintaining the security of your account and API keys</li>
                  <li>Any data loss or system issues resulting from agent actions</li>
                </ul>

                <h4>4. AUTOMATION RISKS & LIABILITY</h4>
                <p><strong>You accept full responsibility for automated actions, including but not limited to:</strong></p>
                <ul>
                  <li>Email campaigns that may result in domain blacklisting</li>
                  <li>Financial transactions and trading decisions</li>
                  <li>Web scraping or API usage that may violate third-party terms</li>
                  <li>File operations that may result in data loss</li>
                </ul>
                <p>
                  <strong>Indemnification:</strong> You agree to indemnify and hold harmless AGNT GG, Inc. from any claims, damages, or legal fees arising
                  from your use of the software or actions of your agents.
                </p>

                <h4>5. REFERRAL AND PARTNER PROGRAM</h4>
                <p><strong>Invited customers:</strong> Someone who joins through your invite and has never had an AGNT Cloud subscription gets their first month of Personal Cloud free (card required; it renews unless cancelled).</p>
                <p><strong>Referral credit:</strong> When a friend you referred pays their first invoice, you receive one month of Personal Cloud as account credit, up to 12 in any 12 months. Credit has no cash value.</p>
                <p><strong>Partner commission:</strong> With Stripe Connect set up before a friend first pays, you earn 30% of each of their subscription payments for 12 months from that first payment, instead of the credit.</p>
                <p><strong>Payout Terms:</strong></p>
                <ul>
                  <li>Commissions paid via Stripe Connect, with a 7-day hold</li>
                  <li>A refunded or disputed payment reverses the reward it earned</li>
                  <li>Cancelling a subscription keeps rewards already earned</li>
                  <li>Self-referrals are prohibited and may result in account termination</li>
                </ul>
                <p>Full terms: agnt.gg/terms#referrals</p>

                <h4>6. REFUND POLICY</h4>
                <p><strong>ALL SALES ARE FINAL.</strong></p>
                <p>
                  Due to the digital nature of Genesis Keys and immediate access to alpha builds, refunds are not provided for bugs, complexity, or
                  installation difficulties. Technical support will be provided to resolve environment issues. Refunds may be issued at the Founder's
                  sole discretion in exceptional cases.
                </p>

                <h4>7. DISCLAIMERS</h4>
                <p>
                  <strong>No Income Guarantee:</strong> AGNT provides automation infrastructure. We make no guarantees about profitability or
                  marketplace success.
                </p>
                <p>
                  <strong>No Financial Advice:</strong> AGNT does not provide financial, legal, or professional advice. Consult appropriate
                  professionals for such guidance.
                </p>

                <h4>8. ACCOUNT TERMINATION</h4>
                <p>We reserve the right to terminate accounts for:</p>
                <ul>
                  <li>Violation of these Terms of Service</li>
                  <li>Fraudulent activity or chargebacks</li>
                  <li>Abuse of the Partner Bounty Program</li>
                  <li>Illegal or harmful use of the platform</li>
                </ul>

                <h4>9. Contact</h4>
                <p>For questions about these Terms, contact: <a href="mailto:legal@agnt.gg">legal@agnt.gg</a></p>
              </div>
            </div>

            <!-- Privacy Policy -->
            <div v-else key="privacy" class="content-section">
              <h3>Privacy Policy</h3>
              <p class="subtitle-text">Your computer by default, our cloud when you choose it</p>
              <p class="last-updated">Last Updated: October 3, 2026</p>

              <div class="content-text">
                <div class="manifesto-intro">
                  <strong>✓ YOU DECIDE WHERE YOUR DATA LIVES</strong>
                  <p>
                    AGNT runs on your computer, and it also offers optional cloud services. What you keep on your machine stays there; what you
                    send to a cloud service is processed on our servers so that service can work. We do not sell your data.
                  </p>
                </div>

                <h4>1. WHAT STAYS ON YOUR COMPUTER</h4>
                <p>By default, the AGNT app keeps these in a database on your own machine:</p>
                <ul>
                  <li><strong>Your chats and prompts</strong>, unless you send them to a cloud model (see section 3).</li>
                  <li><strong>Your agents, workflows, tools, and skills</strong>, and their settings.</li>
                  <li><strong>Your files and outputs</strong>: whatever your automations create.</li>
                </ul>

                <h4>2. YOUR API KEYS AND SIGN-INS</h4>
                <ul>
                  <li>
                    <strong>Cloud storage of keys is optional.</strong> You can keep every key on your own machine, in environment variables or in
                    the app's local encrypted store, and AGNT will use them from there.
                  </li>
                  <li>
                    <strong>Cloud key sync</strong> is a feature of paid cloud plans. Your keys and sign-in tokens are stored encrypted on our
                    servers and refreshed automatically, so connections stay live even while your computer is off or offline.
                  </li>
                  <li>Disconnecting a service deletes the tokens we stored for it.</li>
                </ul>

                <h4>3. CLOUD SERVICES YOU CHOOSE TO USE</h4>
                <p>When you use one of these, the data needed for it is sent to and processed on our servers:</p>
                <ul>
                  <li>
                    <strong>AGNT models</strong> (such as AGNT Flash): your prompts pass through our model service to the model that answers.
                    We keep usage records (tokens and cost) for billing, not the text of your prompts or responses.
                  </li>
                  <li><strong>Web search</strong>: we keep a billing record for each search, not your search terms.</li>
                  <li><strong>Email inboxes</strong>: messages sent and received through an AGNT inbox are stored so you can read them.</li>
                  <li>
                    <strong>Cloud instances and shared workspaces</strong>: the work you run there, and anything you share with your team, is
                    stored on our servers.
                  </li>
                </ul>

                <h4>4. WHAT WE COLLECT FOR YOUR ACCOUNT</h4>
                <ul>
                  <li><strong>Identity:</strong> email address and name.</li>
                  <li><strong>Billing:</strong> plan and subscription status. Payments are handled by Stripe; we never see your card number.</li>
                  <li><strong>License:</strong> a hashed hardware ID, to prevent license sharing.</li>
                  <li><strong>Usage of paid services:</strong> what you used and what it cost.</li>
                  <li><strong>Crash reports:</strong> only if you turn them on.</li>
                </ul>

                <h4>5. OTHER SERVICES YOU CONNECT</h4>
                <p>
                  When you use another company's AI model with your own key, or connect an app such as Gmail, Slack, or a database, AGNT talks to
                  that service using your credentials, and that service's own privacy policy applies. Some connections are set up through our
                  servers, which store the resulting sign-in tokens encrypted. You are responsible for following the terms of the services you
                  connect.
                </p>

                <h4>6. CONTACT</h4>
                <p>
                  The full policy is at <a href="https://agnt.gg/privacy/" target="_blank" rel="noopener">agnt.gg/privacy</a>. Questions:
                  <a href="mailto:legal@agnt.gg">legal@agnt.gg</a>
                </p>
              </div>
            </div>
          </Transition>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <button @click="close" class="btn-primary">I Understand</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script>
import { ref, watch, nextTick } from 'vue';

// The license text is loaded from the repository LICENSE.md so the app can never show a
// different license than the one that governs the code. Both loads are lazy: most users
// never open this tab, so neither the text nor the markdown renderer ships in the main chunk.
let licenseHtmlCache = null;
async function loadLicenseHtml() {
  if (licenseHtmlCache) return licenseHtmlCache;
  const [{ default: licenseMarkdown }, { default: showdown }] = await Promise.all([
    import('../../../LICENSE.md?raw'),
    import('showdown'),
  ]);
  const converter = new showdown.Converter({ tables: true, strikethrough: true });
  licenseHtmlCache = converter.makeHtml(licenseMarkdown);
  return licenseHtmlCache;
}

export default {
  name: 'TermsPrivacyModal',
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    defaultTab: {
      type: String,
      default: 'license',
      validator: (value) => ['license', 'terms', 'privacy'].includes(value),
    },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const activeTab = ref(props.defaultTab);
    const modalBody = ref(null);
    const licenseHtml = ref('');
    const licenseError = ref(false);

    const ensureLicenseLoaded = async () => {
      if (licenseHtml.value || licenseError.value) return;
      try {
        licenseHtml.value = await loadLicenseHtml();
      } catch (error) {
        console.error('[TermsPrivacyModal] Failed to load LICENSE.md:', error);
        licenseError.value = true;
      }
    };

    // The modal stays mounted, so its tab must be re-selected on every open; otherwise a
    // "Privacy Policy" or "License" link would open on whichever tab was used last.
    watch(
      () => props.show,
      (isShown) => {
        if (isShown) activeTab.value = props.defaultTab;
      },
    );

    watch(
      () => [props.show, activeTab.value],
      ([isShown, tab]) => {
        if (isShown && tab === 'license') ensureLicenseLoaded();
      },
      { immediate: true },
    );

    const close = () => {
      emit('close');
    };

    // Scroll to top when tab changes (after transition completes)
    watch(activeTab, () => {
      nextTick(() => {
        // Delay scroll until after the tab transition animation completes (0.2s)
        setTimeout(() => {
          if (modalBody.value) {
            modalBody.value.scrollTop = 0;
          }
        }, 200);
      });
    });

    return {
      activeTab,
      modalBody,
      licenseHtml,
      licenseError,
      close,
    };
  },
};
</script>

<style scoped>
.terms-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /* background: rgba(0, 0, 0, 0.85); */
  /* backdrop-filter: blur(8px); */
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
  padding: 20px;
}

.terms-modal {
  /* background:
    radial-gradient(circle at top, rgba(var(--green-rgb), 0.06), transparent 55%),
    linear-gradient(135deg, var(--color-darker-1) 0%, var(--color-darker-0) 100%); */
  border: 1px solid var(--terminal-border-color);
  border-radius: 24px;
  max-width: 800px;
  width: 100%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  /* box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5); */
}

body.dark .terms-modal {
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 32px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.5em;
  color: var(--color-text);
}

.close-btn {
  background: transparent;
  border: none;
  font-size: 2em;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--surface-active);
  color: var(--color-text);
}

.tab-nav {
  display: flex;
  gap: 8px;
  padding: 16px 32px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.tab-btn {
  background: transparent;
  border: none;
  padding: 12px 20px;
  font-family: var(--font-family-primary);
  font-size: 0.95em;
  font-weight: 600;
  color: var(--color-text-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s ease;
  position: relative;
  bottom: -1px;
}

.tab-btn:hover {
  color: var(--color-text);
  background: var(--surface-hover);
}

.tab-btn.active {
  color: var(--text-green);
  border-bottom-color: var(--color-green);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
}

.content-section {
  animation: fadeIn 0.3s ease;
}

.content-section h3 {
  margin: 0 0 8px 0;
  font-size: 1.8em;
  color: var(--color-text);
}

.version {
  font-size: 0.85em;
  color: var(--color-text-muted);
  margin-bottom: 8px;
  opacity: 0.7;
}

.last-updated {
  font-size: 0.85em;
  color: var(--color-text-muted);
  margin-bottom: 24px;
  opacity: 0.7;
}

.content-text {
  line-height: 1.7;
  color: var(--color-text);
}

.content-text h4 {
  margin: 24px 0 12px 0;
  font-size: 1.2em;
  color: var(--color-text);
}

.content-text p {
  margin: 12px 0;
  color: var(--color-text-muted);
  opacity: 0.9;
}

.content-text ul {
  margin: 12px 0;
  padding-left: 24px;
}

.content-text li {
  margin: 8px 0;
  color: var(--color-text-muted);
  opacity: 0.9;
}

.content-text a {
  color: var(--text-green);
  text-decoration: none;
}

.content-text a:hover {
  text-decoration: underline;
}

/* Rendered LICENSE.md — mirrors the heading, text, and link styles above */
.license-text :deep(h1) {
  margin: 0 0 8px 0;
  font-size: 1.8em;
  color: var(--color-text);
}

.license-text :deep(h2) {
  margin: 24px 0 12px 0;
  font-size: 1.2em;
  color: var(--color-text);
}

.license-text :deep(h3) {
  margin: 20px 0 10px 0;
  font-size: 1.05em;
  color: var(--color-text);
}

.license-text :deep(p),
.license-text :deep(li) {
  color: var(--color-text-muted);
  opacity: 0.9;
}

.license-text :deep(p) {
  margin: 12px 0;
}

.license-text :deep(ul),
.license-text :deep(ol) {
  margin: 12px 0;
  padding-left: 24px;
}

.license-text :deep(li) {
  margin: 8px 0;
}

.license-text :deep(strong) {
  color: var(--color-text);
}

.license-text :deep(a) {
  color: var(--text-green);
  text-decoration: none;
}

.license-text :deep(a:hover) {
  text-decoration: underline;
}

.license-text :deep(hr) {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin: 24px 0;
}

.license-text :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 0.92em;
}

.license-text :deep(th),
.license-text :deep(td) {
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 8px 12px;
  text-align: left;
  vertical-align: top;
  color: var(--color-text-muted);
}

.license-text :deep(th) {
  color: var(--color-text);
  background: var(--color-darker-0);
}

/* Special Content Styles */
.subtitle-text {
  font-size: 1.1em;
  color: var(--color-text-muted);
  font-style: italic;
  margin-bottom: 8px;
  opacity: 0.8;
}

.warning-box {
  background: rgba(255, 193, 7, 0.1);
  border: 2px solid rgba(255, 193, 7, 0.4);
  border-radius: 12px;
  padding: 16px 20px;
  margin: 16px 0 24px 0;
}

.warning-box strong {
  display: block;
  color: var(--text-yellow);
  font-size: 1.1em;
  margin-bottom: 8px;
}

.warning-box p {
  margin: 0;
  color: var(--color-text);
  opacity: 1;
}

.manifesto-intro {
  background: rgba(var(--green-rgb), 0.1);
  border: 2px solid rgba(var(--green-rgb), 0.4);
  border-radius: 12px;
  padding: 16px 20px;
  margin: 0 0 24px 0;
}

.manifesto-intro strong {
  display: block;
  color: var(--text-green);
  font-size: 1.1em;
  margin-bottom: 8px;
}

.manifesto-intro p {
  margin: 0;
  color: var(--color-text);
  opacity: 1;
}

.legal-notice {
  background: rgba(255, 59, 48, 0.1);
  border: 2px solid rgba(255, 59, 48, 0.4);
  border-radius: 12px;
  padding: 16px 20px;
  margin: 0 0 24px 0;
}

.legal-notice strong {
  display: block;
  color: var(--color-red);
  font-size: 1.1em;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.legal-notice p {
  margin: 0;
  color: var(--color-text);
  opacity: 1;
}

.modal-footer {
  padding: 20px 32px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  justify-content: flex-end;
}

.btn-primary {
  background: linear-gradient(135deg, var(--color-green) 0%, #00d084 100%);
  color: var(--text-on-fill);
  border: none;
  padding: 12px 32px;
  border-radius: 999px;
  font-family: var(--font-family-primary);
  font-size: 1em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(var(--green-rgb), 0.3);
}

/* Transitions */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.tab-fade-enter-active,
.tab-fade-leave-active {
  transition: opacity 0.2s ease;
}

.tab-fade-enter-from,
.tab-fade-leave-to {
  opacity: 0;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* Scrollbar Styling */
.modal-body::-webkit-scrollbar {
  width: 8px;
}

.modal-body::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}

.modal-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.modal-body::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* Responsive */
@media (max-width: 768px) {
  .modal-header,
  .modal-body,
  .modal-footer {
    padding-left: 20px;
    padding-right: 20px;
  }

  .tab-nav {
    padding-left: 20px;
    padding-right: 20px;
  }

  .content-section h3 {
    font-size: 1.5em;
  }

  .content-text h4 {
    font-size: 1.1em;
  }
}
</style>
