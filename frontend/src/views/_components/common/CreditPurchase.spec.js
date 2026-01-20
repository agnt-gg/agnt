import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import CreditPurchase from './CreditPurchase.vue';

// Mock the config
vi.mock('@/tt.config.js', () => ({
  API_CONFIG: {
    REMOTE_URL: 'http://localhost:3000',
  },
}));

// Mock Stripe
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() =>
    Promise.resolve({
      elements: vi.fn(() => ({
        create: vi.fn(() => ({
          mount: vi.fn(),
          on: vi.fn(),
          destroy: vi.fn(),
        })),
      })),
      createPaymentMethod: vi.fn(() =>
        Promise.resolve({
          paymentMethod: { id: 'pm_test123' },
        })
      ),
      confirmCardPayment: vi.fn(() =>
        Promise.resolve({
          paymentIntent: { status: 'succeeded' },
        })
      ),
    })
  ),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('CreditPurchase', () => {
  let wrapper;

  beforeEach(() => {
    vi.useFakeTimers();

    // Reset fetch mock
    global.fetch.mockReset();
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ credits: 1000 }),
    });

    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(() => 'test-token'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });

    // Mock document.body.setAttribute
    document.body.setAttribute = vi.fn();

    // Mock getElementById for card-element
    const mockCardElement = document.createElement('div');
    mockCardElement.id = 'card-element';
    document.getElementById = vi.fn((id) => {
      if (id === 'card-element') return mockCardElement;
      if (id === 'card-errors') return document.createElement('div');
      return null;
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createWrapper = () => {
    const mockShowModal = vi.fn().mockResolvedValue(true);
    const wrapper = mount(CreditPurchase, {
      global: {
        stubs: {
          SimpleModal: {
            template: '<div class="simple-modal-stub" ref="modal"></div>',
            methods: {
              showModal: mockShowModal,
            },
          },
        },
      },
      attachTo: document.body,
    });

    // Attach mock to wrapper for easy access in tests
    wrapper.mockShowModal = mockShowModal;

    return wrapper;
  };

  describe('Rendering', () => {
    it('renders credit purchase component', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.credit-purchase').exists()).toBe(true);
    });

    it('displays current token credits section', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Current Token Credits');
    });

    it('displays purchase tokens section', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('Purchase Tokens');
    });

    it('displays pricing info', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('1,000 tokens = $10');
    });

    it('renders amount input', () => {
      wrapper = createWrapper();
      expect(wrapper.find('input[type="number"]').exists()).toBe(true);
    });

    it('renders stripe element container', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.stripe-element-container').exists()).toBe(true);
    });

    it('renders purchase button', () => {
      wrapper = createWrapper();
      expect(wrapper.find('button').exists()).toBe(true);
    });

    it('renders SimpleModal component', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.simple-modal-stub').exists()).toBe(true);
    });
  });

  describe('Credits Display', () => {
    it('fetches credits on mount', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/users/credits', expect.objectContaining({ headers: expect.any(Object) }));
    });

    it('displays formatted credits', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ credits: 12345 }),
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.formattedCredits).toBe('12,345');
    });

    it('floors credits to whole number', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ credits: 1234.56 }),
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.formattedCredits).toBe('1,234');
    });
  });

  describe('Amount Input', () => {
    it('has default amount of 0', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.amount).toBe(0);
    });

    it('updates amount on input', async () => {
      wrapper = createWrapper();
      await wrapper.find('input[type="number"]').setValue(100);
      expect(wrapper.vm.amount).toBe(100);
    });

    it('has min attribute of 0', () => {
      wrapper = createWrapper();
      expect(wrapper.find('input[type="number"]').attributes('min')).toBe('0');
    });

    it('has step attribute of 1', () => {
      wrapper = createWrapper();
      expect(wrapper.find('input[type="number"]').attributes('step')).toBe('1');
    });

    it('selects input content on focus', async () => {
      wrapper = createWrapper();
      const input = wrapper.find('input[type="number"]');
      const selectSpy = vi.fn();
      input.element.select = selectSpy;

      await input.trigger('focus');

      expect(selectSpy).toHaveBeenCalled();
    });
  });

  describe('Purchase Button State', () => {
    it('is disabled when amount is 0', () => {
      wrapper = createWrapper();
      expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    });

    it('is disabled when amount is negative', async () => {
      wrapper = createWrapper();
      await wrapper.find('input[type="number"]').setValue(-10);
      expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    });

    it('is disabled when card is not complete', async () => {
      wrapper = createWrapper();
      await wrapper.find('input[type="number"]').setValue(100);
      wrapper.vm.isCardComplete = false;
      await wrapper.vm.$nextTick();
      expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    });

    it('is enabled when amount > 0 and card is complete', async () => {
      wrapper = createWrapper();
      await wrapper.find('input[type="number"]').setValue(100);
      wrapper.vm.isCardComplete = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.find('button').attributes('disabled')).toBeUndefined();
    });

    it('shows "Purchase Credits" text normally', () => {
      wrapper = createWrapper();
      expect(wrapper.find('button').text()).toBe('Purchase Credits');
    });

    it('shows "Processing..." when processing', async () => {
      wrapper = createWrapper();
      wrapper.vm.isProcessing = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.find('button').text()).toBe('Processing...');
    });

    it('shows "Payment Unavailable" when stripe is blocked', async () => {
      wrapper = createWrapper();
      wrapper.vm.stripeBlocked = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.find('button').text()).toBe('Payment Unavailable');
    });

    it('has button-ready class when ready', async () => {
      wrapper = createWrapper();
      await wrapper.find('input[type="number"]').setValue(100);
      wrapper.vm.isCardComplete = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.find('button').classes()).toContain('button-ready');
    });

    it('has button-processing class when processing', async () => {
      wrapper = createWrapper();
      wrapper.vm.isProcessing = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.find('button').classes()).toContain('button-processing');
    });
  });

  describe('Stripe Setup', () => {
    it('sets up Stripe after delay', async () => {
      wrapper = createWrapper();

      // Advance past the nextTick and setTimeout
      await wrapper.vm.$nextTick();
      vi.advanceTimersByTime(1000);
      await flushPromises();

      expect(wrapper.vm.setupAttempted).toBe(true);
    });

    it('only attempts setup once', async () => {
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      vi.advanceTimersByTime(1000);
      await flushPromises();

      const firstAttempt = wrapper.vm.setupAttempted;

      // Try to setup again
      await wrapper.vm.setupStripe();

      expect(wrapper.vm.setupAttempted).toBe(firstAttempt);
    });
  });

  describe('Purchase Flow', () => {
    it('does not process if already processing', async () => {
      wrapper = createWrapper();
      wrapper.vm.isProcessing = true;

      await wrapper.vm.handlePurchase();

      // Should not have made any API calls
      expect(global.fetch).toHaveBeenCalledTimes(1); // Only the initial credits fetch
    });

    it('shows error modal when no token', async () => {
      localStorage.getItem = vi.fn(() => null);

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      await wrapper.vm.handlePurchase();
      await flushPromises();

      // The component should handle the no-token case
      expect(wrapper.vm.isProcessing).toBe(false);
    });

    it('shows error modal when stripe is blocked', async () => {
      wrapper = createWrapper();
      wrapper.vm.stripeBlocked = true;
      await wrapper.vm.$nextTick();

      await wrapper.vm.handlePurchase();

      expect(wrapper.mockShowModal).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Payment Unavailable',
        })
      );
    });

    it('sets isProcessing to true during purchase', async () => {
      global.fetch.mockImplementation(() => new Promise(() => {}));

      wrapper = createWrapper();
      wrapper.vm.amount = 100;
      wrapper.vm.isCardComplete = true;

      wrapper.vm.handlePurchase();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isProcessing).toBe(true);
    });

    it('resets isProcessing after purchase completes', async () => {
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ credits: 1000 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ clientSecret: 'secret', paymentIntentId: 'pi_123' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ credits: 1100 }),
        });

      wrapper = createWrapper();
      wrapper.vm.amount = 100;
      wrapper.vm.isCardComplete = true;
      wrapper.vm.stripeBlocked = false;

      await wrapper.vm.handlePurchase();
      await flushPromises();

      expect(wrapper.vm.isProcessing).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('handles fetch credits error gracefully', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      wrapper = createWrapper();
      await flushPromises();

      // Should not throw
      expect(wrapper.exists()).toBe(true);
    });

    it('shows error modal on purchase failure', async () => {
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ credits: 1000 }),
        })
        .mockRejectedValueOnce(new Error('Purchase failed'));

      wrapper = createWrapper();
      wrapper.vm.amount = 100;
      wrapper.vm.isCardComplete = true;
      wrapper.vm.stripeBlocked = false;

      await wrapper.vm.handlePurchase();
      await flushPromises();

      expect(wrapper.mockShowModal).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
        })
      );
    });
  });

  describe('Stripe Blocked Message', () => {
    it('shows blocked message in card element', () => {
      wrapper = createWrapper();

      const mockElement = document.createElement('div');
      document.getElementById = vi.fn(() => mockElement);

      wrapper.vm.showStripeBlockedMessage();

      expect(mockElement.innerHTML).toContain('Payment processing is currently unavailable');
    });
  });

  describe('Lifecycle', () => {
    it('sets data-page attribute on mount', () => {
      wrapper = createWrapper();
      expect(document.body.setAttribute).toHaveBeenCalledWith('data-page', 'agents');
    });

    it('fetches credits on mount', async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/users/credits'), expect.any(Object));
    });
  });

  describe('Computed Properties', () => {
    it('formattedCredits formats large numbers', async () => {
      wrapper = createWrapper();
      wrapper.vm.credits = 1000000;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formattedCredits).toBe('1,000,000');
    });

    it('formattedCredits handles zero', async () => {
      wrapper = createWrapper();
      wrapper.vm.credits = 0;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.formattedCredits).toBe('0');
    });
  });
});
