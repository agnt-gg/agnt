export const mockUser = {
  id: 'test-user-id',
  email: 'test@agnt.gg',
  name: 'Test Agent',
  isAuthenticated: true,
};

export const mockSubscription = {
  planType: 'pro',
  status: 'active',
  features: {
    agents: true,
    workflows: true,
  },
};

export const mockWorkflowsData = [
  {
    id: 'wf-1',
    name: 'Test Workflow 1',
    description: 'A test workflow',
    status: 'active',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'wf-2',
    name: 'Test Workflow 2',
    description: 'Another test workflow',
    status: 'draft',
    updatedAt: new Date().toISOString(),
  },
];

export const mockAgentsData = [
  {
    id: 'agent-1',
    name: 'Test Agent 1',
    role: 'Test Role',
    description: 'A test agent',
    avatar: '🤖',
  },
  {
    id: 'agent-2',
    name: 'Test Agent 2',
    role: 'Helper',
    description: 'Another test agent',
    avatar: '👾',
  },
];

/**
 * Mocks the authentication flow for the given window/page
 * @param {import('@playwright/test').Page} page
 */
export async function loginUser(page) {
  // 1. Mock the API responses
  // Mock Auth Status
  await page.route('**/users/auth/status', async (route) => {
    // console.log('Intercepted /users/auth/status');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ isAuthenticated: true, user: mockUser }),
    });
  });

  // Mock Subscription Status
  await page.route('**/users/subscription/status', async (route) => {
    // console.log('Intercepted /users/subscription/status');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockSubscription),
    });
  });

  // Mock Pseudonym/Referral
  await page.route('**/referrals/user/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pseudonym: 'TestUser' }),
    });
  });

  // Mock Connected Apps
  await page.route('**/auth/connected', async (route) => {
    // console.log('Intercepted /auth/connected');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(['OpenAI', 'Anthropic']),
    });
  });

  // 2. Set localStorage
  await page.evaluate(() => {
    localStorage.setItem('token', 'mock-test-token');
    localStorage.setItem('hasCompletedOnboarding', 'true');
    // Set default AI provider
    localStorage.setItem('selectedProvider', 'OpenAI');
    localStorage.setItem('selectedModel', 'gpt-4o');
  });

  // console.log('Mocked login state set in localStorage');
}

export async function mockWorkflows(page) {
  // Matches .../api/workflows/ and .../api/workflows/?status=...
  await page.route('**/workflows/**', async (route) => {
    // console.log('Intercepted /workflows');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ workflows: mockWorkflowsData }),
    });
  });
}

export async function mockAgents(page) {
  // Matches .../api/agents/
  await page.route('**/agents/**', async (route) => {
    // console.log('Intercepted /agents');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ agents: mockAgentsData }),
    });
  });
}
