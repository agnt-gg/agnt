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
            <!-- License (EULA) -->
            <div v-if="activeTab === 'license'" key="license" class="content-section">
              <h3>AGNT Master License Agreement</h3>
              <p class="subtitle-text">End User License Agreement (EULA)</p>
              <p class="version">Version 0 (Genesis Epoch)</p>
              <p class="last-updated">Last Updated: November 24, 2025</p>

              <div class="content-text">
                <div class="legal-notice">
                  <strong>THIS IS A LEGALLY BINDING AGREEMENT.</strong>
                  <p>
                    READ IT CAREFULLY. BY DOWNLOADING, INSTALLING, OR USING THE SOFTWARE ("AGNT"), YOU (THE "LICENSEE") AGREE TO BE BOUND BY THE TERMS
                    OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT INSTALL THE SOFTWARE.
                  </p>
                </div>

                <h4>1. GRANT OF LICENSE</h4>
                <p>
                  Subject to your payment of applicable fees and compliance with this Agreement, AGNT Inc. ("Licensor") grants you a limited,
                  non-exclusive, non-transferable, revocable license to install and execute the AGNT software solely in object code (binary) format on
                  hardware owned or controlled by you.
                </p>
                <p>
                  <strong>1.1 Genesis Architect License:</strong> If you hold an Architect Node, this license is Perpetual for the version purchased
                  and all subsequent updates released during the product's lifespan.
                </p>
                <p>
                  <strong>1.2 Standard License (Builders / Operators):</strong> If you hold a Builder or Operator Node, this license is Term-Based
                  (Annual) and requires an active subscription to maintain access to the Runtime.
                </p>

                <h4>2. RESTRICTIONS</h4>
                <p>You acknowledge that the Software contains proprietary trade secrets of AGNT Inc. You agree NOT to:</p>
                <ul>
                  <li>Decompile, disassemble, reverse engineer, or attempt to derive the source code of the Software.</li>
                  <li>Bypass, modify, or tamper with the License Verification mechanism (the "Auth Handshake").</li>
                  <li>
                    Rent, lease, lend, or resell the Software binary to third parties (except via authorized transfer of a Genesis Node with written
                    consent from Licensor).
                  </li>
                  <li>
                    Create derivative works based on the AGNT Core Runtime. (Note: You are permitted to build and sell Agent Configurations and
                    Workflows that run on top of the Runtime).
                  </li>
                </ul>

                <h4>3. BARE METAL DISCLAIMER & RISK ASSUMPTION</h4>
                <div class="warning-box">
                  <strong>⚠️ WARNING: BARE METAL EXECUTION</strong>
                  <p>The Software runs as a native process with the full privileges of your user account ("Bare Metal"). It is NOT sandboxed.</p>
                </div>
                <p>
                  <strong>3.1 System Access:</strong> You explicitly authorize the Software to read, write, modify, and delete files on your local
                  storage drives as directed by the automated agents you configure.
                </p>
                <p>
                  <strong>3.2 User Responsibility:</strong> You are solely responsible for configuring the permissions and logic of your Agents. If
                  you configure an Agent to delete your operating system files, it will do so. Licensor is not liable for data loss, hardware damage,
                  or system corruption.
                </p>
                <p>
                  <strong>3.3 No Monitoring:</strong> Licensor does not monitor or control the actions of your Agents. You assume full legal liability
                  for any actions taken by the Software on your behalf, including but not limited to web scraping, automated messaging, and financial
                  transactions.
                </p>

                <h4>4. INTELLECTUAL PROPERTY & OWNERSHIP</h4>
                <p>
                  <strong>4.1 The Software:</strong> Licensor retains all title, ownership, and intellectual property rights in and to the AGNT Core
                  Runtime.
                </p>
                <p>
                  <strong>4.2 Your Data:</strong> You retain all title, ownership, and intellectual property rights in and to the data you process,
                  the Agent definitions (JSON/Python) you create, and the outputs generated by the Software.
                </p>

                <h4>5. ALPHA SOFTWARE ACKNOWLEDGEMENT</h4>
                <p>
                  You acknowledge that the Software is currently in an "Industrial Alpha" state. It may contain defects, errors, and bugs. It may
                  function unexpectedly.
                </p>
                <p>
                  <strong>5.1 No Warranty:</strong> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
                  NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
                </p>
                <p>
                  <strong>5.2 Support:</strong> Licensor is under no obligation to provide technical support, updates, or maintenance, except as
                  explicitly defined in your specific Tier benefits.
                </p>

                <h4>6. LIMITATION OF LIABILITY</h4>
                <p>
                  TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL LICENSOR BE LIABLE FOR ANY SPECIAL, INCIDENTAL, INDIRECT, OR
                  CONSEQUENTIAL DAMAGES WHATSOEVER (INCLUDING, WITHOUT LIMITATION, DAMAGES FOR LOSS OF BUSINESS PROFITS, BUSINESS INTERRUPTION, LOSS
                  OF BUSINESS INFORMATION, OR ANY OTHER PECUNIARY LOSS) ARISING OUT OF THE USE OF OR INABILITY TO USE THE SOFTWARE, EVEN IF LICENSOR
                  HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
                </p>

                <h4>7. TERMINATION</h4>
                <p><strong>7.1</strong> This Agreement is effective until terminated.</p>
                <p>
                  <strong>7.2</strong> Licensor may terminate this Agreement immediately if you breach any provision of Section 2 (Restrictions) or if
                  your payment is refunded or charged back.
                </p>
                <p><strong>7.3</strong> Upon termination, you must cease all use of the Software and destroy all copies in your possession.</p>

                <h4>8. GOVERNING LAW</h4>
                <p>
                  This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, United States, without
                  regard to its conflict of laws principles.
                </p>

                <h4>9. Contact Information</h4>
                <p>For questions about this License Agreement, please contact us at: <a href="mailto:legal@agnt.gg">legal@agnt.gg</a></p>
              </div>
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
                  services provided by AGNT Inc. ("The Protocol").
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
                  <strong>Indemnification:</strong> You agree to indemnify and hold harmless AGNT Inc. from any claims, damages, or legal fees arising
                  from your use of the software or actions of your agents.
                </p>

                <h4>5. PARTNER BOUNTY PROGRAM</h4>
                <p><strong>Referral Commission:</strong> Earn 30% commission on approved sales via your unique Node Key.</p>
                <p><strong>Payout Terms:</strong></p>
                <ul>
                  <li>Commissions paid via Stripe Connect</li>
                  <li>7-Day Security Hold on all payouts</li>
                  <li>Clawbacks apply for chargebacks or fraud</li>
                  <li>Self-referrals prohibited and will result in account termination</li>
                </ul>

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
              <h3>Privacy Manifesto</h3>
              <p class="subtitle-text">The Local-First Promise</p>
              <p class="last-updated">Last Updated: November 24, 2025</p>

              <div class="content-text">
                <div class="manifesto-intro">
                  <strong>✓ PRIVACY FIRST</strong>
                  <p>We do not want your data. Privacy first is the entire point of AGNT.</p>
                </div>

                <h4>1. WHAT WE COLLECT (The Control Plane)</h4>
                <p>We collect only the minimum data required to operate the automation system:</p>
                <ul>
                  <li><strong>Identity:</strong> Email Address, Name, Stripe Customer ID.</li>
                  <li><strong>Hardware:</strong> A hashed Hardware ID (to prevent license sharing).</li>
                  <li>
                    <strong>API Keys:</strong> Your API keys and auth tokens are stored fully encrypted on our servers to ensure 100% uptime on
                    refresh tokens. Only your node can decrypt and access these keys.
                  </li>
                  <li><strong>Telemetry:</strong> Crash logs and error reports (only if you opt-in via the Debug Console).</li>
                </ul>

                <h4>2. WHAT WE DO NOT COLLECT (The Data Plane)</h4>
                <p>Everything else stays on your machine. We have Zero Visibility into:</p>
                <ul>
                  <li><strong>Your Prompts:</strong> We do not see what you type.</li>
                  <li><strong>Your Agents:</strong> We do not see the agents you build.</li>
                  <li><strong>Your Outputs:</strong> The results of your automations live in your local SQLite database.</li>
                </ul>

                <h4>3. THIRD-PARTY SERVICES & INTEGRATIONS</h4>
                <p>
                  AGNT integrates with various third-party services. Your data interactions with these services are governed by their respective
                  privacy policies:
                </p>
                <ul>
                  <li><strong>Stripe:</strong> Processes payments and identity verification.</li>
                  <li>
                    <strong>LLM Providers:</strong> If you use OpenAI, Anthropic, Google, or other AI providers, your prompts and data are sent
                    directly from your machine to them. We do not proxy this traffic.
                  </li>
                  <li>
                    <strong>Third-Party Integrations:</strong> AGNT allows you to connect to any third-party service (email providers, databases,
                    APIs, social media platforms, etc.). When you configure these integrations, your agents communicate directly with these services
                    using your credentials. We do not intercept, store, or monitor this traffic.
                  </li>
                  <li>
                    <strong>Your Responsibility:</strong> You are responsible for reviewing and complying with the privacy policies and terms of
                    service of any third-party services you integrate with AGNT.
                  </li>
                </ul>

                <h4>4. Contact Us</h4>
                <p>
                  If you have questions about this Privacy Policy, please contact us at:
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
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
  padding: 20px;
}

.terms-modal {
  background: radial-gradient(circle at top, rgba(0, 255, 153, 0.06), transparent 55%),
    linear-gradient(135deg, var(--color-darker-1) 0%, var(--color-darker-0) 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 24px;
  max-width: 800px;
  width: 100%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
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
  background: rgba(255, 255, 255, 0.1);
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
  font-family: 'League Spartan', sans-serif;
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
  background: rgba(255, 255, 255, 0.03);
}

.tab-btn.active {
  color: var(--color-green);
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
  color: var(--color-green);
  text-decoration: none;
}

.content-text a:hover {
  text-decoration: underline;
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
  color: #ffc107;
  font-size: 1.1em;
  margin-bottom: 8px;
}

.warning-box p {
  margin: 0;
  color: var(--color-text);
  opacity: 1;
}

.manifesto-intro {
  background: rgba(0, 255, 153, 0.1);
  border: 2px solid rgba(0, 255, 153, 0.4);
  border-radius: 12px;
  padding: 16px 20px;
  margin: 0 0 24px 0;
}

.manifesto-intro strong {
  display: block;
  color: var(--color-green);
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
  color: #ff3b30;
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
  color: var(--color-ultra-dark-navy);
  border: none;
  padding: 12px 32px;
  border-radius: 999px;
  font-family: 'League Spartan', sans-serif;
  font-size: 1em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 255, 153, 0.3);
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
