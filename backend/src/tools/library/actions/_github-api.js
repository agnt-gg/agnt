import BaseAction from '../BaseAction.js';
import AuthManager from '../../../services/auth/AuthManager.js';

class GitHubAPI extends BaseAction {
  static schema = {
    title: 'GitHub API',
    category: 'action',
    type: 'github-api',
    icon: 'github',
    description: 'Interact with GitHub to perform various operations on repositories, issues, pull requests, and more.',
    authRequired: 'oauth',
    authProvider: 'github',
    parameters: {
      action: {
        type: 'string',
        inputType: 'select',
        options: [
          'CREATE_ISSUE',
          'CREATE_PR',
          'GET_REPO_INFO',
          'CREATE_BRANCH',
          'MERGE_PR',
          'LIST_PRS',
          'GET_PR_CHANGES',
          'ADD_LABELS',
          'REMOVE_LABELS',
          'GET_FILE_CONTENT',
          'GET_REPO_CONTENTS',
          'CREATE_FILE',
          'UPDATE_FILE',
          'CREATE_RELEASE',
          'LIST_COMMITS',
        ],
        description: 'The action to perform on GitHub',
      },
      owner: {
        type: 'string',
        inputType: 'text',
        description: 'The owner of the repository',
      },
      repo: {
        type: 'string',
        inputType: 'text',
        description: 'The name of the repository',
      },
      title: {
        type: 'string',
        inputType: 'text',
        description: 'The title of the issue or pull request',
        conditional: {
          field: 'action',
          value: ['CREATE_ISSUE', 'CREATE_PR'],
        },
      },
      body: {
        type: 'string',
        inputType: 'textarea',
        description: 'The body of the issue or pull request',
        conditional: {
          field: 'action',
          value: ['CREATE_ISSUE', 'CREATE_PR'],
        },
      },
      head: {
        type: 'string',
        inputType: 'text',
        description: 'The name of the branch where your changes are implemented',
        conditional: {
          field: 'action',
          value: 'CREATE_PR',
        },
      },
      base: {
        type: 'string',
        inputType: 'text',
        description: 'The name of the branch you want the changes pulled into',
        conditional: {
          field: 'action',
          value: 'CREATE_PR',
        },
      },
      baseBranch: {
        type: 'string',
        inputType: 'text',
        description: 'The name of the branch to create the new branch from',
        conditional: {
          field: 'action',
          value: 'CREATE_BRANCH',
        },
      },
      newBranch: {
        type: 'string',
        inputType: 'text',
        description: 'The name of the new branch to create',
        conditional: {
          field: 'action',
          value: 'CREATE_BRANCH',
        },
      },
      pullNumber: {
        type: 'string',
        inputType: 'text',
        description: 'The number of the pull request',
        conditional: {
          field: 'action',
          value: ['MERGE_PR', 'GET_PR_CHANGES'],
        },
      },
      mergeMethod: {
        type: 'string',
        inputType: 'select',
        options: ['merge', 'squash', 'rebase'],
        description: 'The method to use when merging the pull request',
        conditional: {
          field: 'action',
          value: 'MERGE_PR',
        },
      },
      state: {
        type: 'string',
        inputType: 'select',
        options: ['open', 'closed', 'all'],
        description: 'The state of pull requests to list',
        conditional: {
          field: 'action',
          value: 'LIST_PRS',
        },
      },
      labels: {
        type: 'array',
        inputType: 'text',
        description: 'The labels to add or remove',
        conditional: {
          field: 'action',
          value: ['ADD_LABELS', 'REMOVE_LABELS'],
        },
      },
      filePath: {
        type: 'string',
        inputType: 'text',
        description: 'The path to the file',
        conditional: {
          field: 'action',
          value: ['GET_FILE_CONTENT', 'CREATE_FILE', 'UPDATE_FILE'],
        },
      },
      content: {
        type: 'string',
        inputType: 'textarea',
        description: 'The content of the file',
        conditional: {
          field: 'action',
          value: ['CREATE_FILE', 'UPDATE_FILE'],
        },
      },
      commitMessage: {
        type: 'string',
        inputType: 'text',
        description: 'The commit message',
        conditional: {
          field: 'action',
          value: ['CREATE_FILE', 'UPDATE_FILE'],
        },
      },
      tagName: {
        type: 'string',
        inputType: 'text',
        description: 'The name of the tag',
        conditional: {
          field: 'action',
          value: 'CREATE_RELEASE',
        },
      },
      releaseName: {
        type: 'string',
        inputType: 'text',
        description: 'The name of the release',
        conditional: {
          field: 'action',
          value: 'CREATE_RELEASE',
        },
      },
      releaseNotes: {
        type: 'string',
        inputType: 'textarea',
        description: 'The release notes',
        conditional: {
          field: 'action',
          value: 'CREATE_RELEASE',
        },
      },
      branch: {
        type: 'string',
        inputType: 'text',
        description: 'The branch to list commits from',
        conditional: {
          field: 'action',
          value: 'LIST_COMMITS',
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the action was successful',
      },
      result: {
        type: 'object',
        description: 'The result of the action, varies based on the action performed',
      },
      error: {
        type: 'string',
        description: 'Error message if the action failed',
      },
    },
  };

  constructor() {
    super('github-api');
    this.baseUrl = 'https://api.github.com';
  }
  async execute(params, inputData, workflowEngine) {
    console.log('Executing GitHub API with params:', JSON.stringify(params, null, 2));
    this.validateParams(params);

    try {
      const userId = workflowEngine.userId;
      console.log('Attempting to perform GitHub action for user:', userId);
      console.log('Action:', params.action);

      const accessToken = await AuthManager.getValidAccessToken(userId, 'github');
      if (!accessToken) {
        throw new Error('No valid access token. User needs to authenticate.');
      }

      params.accessToken = accessToken;

      let result;
      switch (params.action) {
        case 'CREATE_ISSUE':
          result = await this.createIssue(params);
          break;
        case 'CREATE_PR':
          result = await this.createPullRequest(params);
          break;
        case 'GET_REPO_INFO':
          result = await this.getRepoInfo(params);
          break;
        case 'CREATE_BRANCH':
          result = await this.createBranch(params);
          break;
        case 'MERGE_PR':
          result = await this.mergePullRequest(params);
          break;
        case 'LIST_PRS':
          result = await this.listPullRequests(params);
          break;
        case 'GET_PR_CHANGES':
          result = await this.getPullRequestChanges(params);
          break;
        case 'ADD_LABELS':
          result = await this.addLabels(params);
          break;
        case 'REMOVE_LABELS':
          result = await this.removeLabels(params);
          break;
        case 'GET_FILE_CONTENT':
          result = await this.getFileContent(params);
          break;
        case 'GET_REPO_CONTENTS':
          result = await this.getRepoContents(params);
          break;
        case 'CREATE_FILE':
          result = await this.createFile(params);
          break;
        case 'UPDATE_FILE':
          result = await this.updateFile(params);
          break;
        case 'CREATE_RELEASE':
          result = await this.createRelease(params);
          break;
        case 'LIST_COMMITS':
          result = await this.listCommits(params);
          break;
        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }

      return this.formatOutput({
        success: true,
        result: result,
        error: null,
      });
    } catch (error) {
      console.error('GitHub API Error:', error);
      return this.formatOutput({
        success: false,
        result: null,
        error: error.message,
      });
    }
  }
  async createIssue(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/issues`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: params.title,
          body: params.body,
        }),
      },
      params.accessToken
    );

    return {
      issueNumber: response.number,
      issueUrl: response.html_url,
    };
  }
  async createPullRequest(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: params.title,
          body: params.body,
          head: params.head,
          base: params.base,
        }),
      },
      params.accessToken
    );

    return {
      pullRequestNumber: response.number,
      pullRequestUrl: response.html_url,
    };
  }
  async getRepoInfo(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}`,
      {
        method: 'GET',
      },
      params.accessToken
    );

    return {
      name: response.name,
      fullName: response.full_name,
      description: response.description,
      stars: response.stargazers_count,
      forks: response.forks_count,
      openIssues: response.open_issues_count,
      defaultBranch: response.default_branch,
    };
  }
  async createBranch(params) {
    const getRefResponse = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/git/ref/heads/${params.baseBranch}`,
      { method: 'GET' },
      params.accessToken
    );

    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/git/refs`,
      {
        method: 'POST',
        body: JSON.stringify({
          ref: `refs/heads/${params.newBranch}`,
          sha: getRefResponse.object.sha,
        }),
      },
      params.accessToken
    );

    return {
      branchName: params.newBranch,
      branchUrl: response.url,
    };
  }
  async mergePullRequest(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/merge`,
      {
        method: 'PUT',
        body: JSON.stringify({
          merge_method: params.mergeMethod || 'merge',
        }),
      },
      params.accessToken
    );

    return {
      merged: response.merged,
      message: response.message,
    };
  }
  async listPullRequests(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/pulls`,
      {
        method: 'GET',
        params: {
          state: params.state || 'open',
          sort: params.sort || 'created',
          direction: params.direction || 'desc',
        },
      },
      params.accessToken
    );

    return response.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      url: pr.html_url,
    }));
  }
  async getPullRequestChanges(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/files`,
      {
        method: 'GET',
      },
      params.accessToken
    );

    return response.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch,
    }));
  }
  async addLabels(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/issues/${params.issueNumber}/labels`,
      {
        method: 'POST',
        body: JSON.stringify(params.labels),
      },
      params.accessToken
    );

    return {
      labels: response.map((label) => label.name),
    };
  }
  async removeLabels(params) {
    for (const label of params.labels) {
      await this.makeRequest(
        `/repos/${params.owner}/${params.repo}/issues/${params.issueNumber}/labels/${label}`,
        { method: 'DELETE' },
        params.accessToken
      );
    }

    return {
      removedLabels: params.labels,
    };
  }
  async createFile(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/contents/${params.path}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: params.commitMessage,
          content: Buffer.from(params.content).toString('base64'),
          branch: params.branch,
        }),
      },
      params.accessToken
    );

    return {
      fileUrl: response.content.html_url,
      commitSha: response.commit.sha,
    };
  }
  async getFileContent(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/contents/${params.filePath}`,
      {
        method: 'GET',
        params: {
          ref: params.ref || undefined,
        },
      },
      params.accessToken
    );

    if (response.size > 1000000) {
      // If file is larger than 1MB
      return {
        content: 'File too large to display',
        sha: response.sha,
        size: response.size,
        url: response.html_url,
      };
    }

    return {
      content: Buffer.from(response.content, 'base64').toString('utf-8'),
      sha: response.sha,
      size: response.size,
      url: response.html_url,
    };
  }
  async getRepoContents(params) {
    const path = params.path || '';
    const recursive = params.recursive || false;

    const listContents = async (path) => {
      const response = await this.makeRequest(
        `/repos/${params.owner}/${params.repo}/contents/${path}`,
        {
          method: 'GET',
          params: {
            ref: params.ref || undefined,
          },
        },
        params.accessToken
      );

      const contents = await Promise.all(
        response.map(async (item) => {
          if (item.type === 'file') {
            const fileContent = await this.getFileContent({
              ...params,
              filePath: item.path,
            });
            return {
              ...item,
              content: fileContent.content,
            };
          } else if (item.type === 'dir' && recursive) {
            return {
              ...item,
              contents: await listContents(item.path),
            };
          }
          return item;
        })
      );

      return contents;
    };

    return listContents(path);
  }
  async updateFile(params) {
    const currentFile = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/contents/${params.path}`,
      { method: 'GET' },
      params.accessToken
    );

    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/contents/${params.path}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: params.commitMessage,
          content: Buffer.from(params.content).toString('base64'),
          sha: currentFile.sha,
          branch: params.branch,
        }),
      },
      params.accessToken
    );

    return {
      fileUrl: response.content.html_url,
      commitSha: response.commit.sha,
    };
  }
  async createRelease(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/releases`,
      {
        method: 'POST',
        body: JSON.stringify({
          tag_name: params.tagName,
          name: params.releaseName,
          body: params.releaseNotes,
          draft: params.draft || false,
          prerelease: params.prerelease || false,
        }),
      },
      params.accessToken
    );

    return {
      releaseId: response.id,
      releaseUrl: response.html_url,
    };
  }
  async listCommits(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/commits`,
      {
        method: 'GET',
        params: {
          sha: params.branch,
          per_page: params.perPage || 30,
        },
      },
      params.accessToken
    );

    return response.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date,
    }));
  }
  async makeRequest(endpoint, options, accessToken) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };

    console.log(`Making request to: ${url}`);
    console.log(`Request method: ${options.method}`);
    console.log(`Request headers:`, JSON.stringify(headers, null, 2));
    console.log(`Request body:`, options.body);

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    const responseData = await response.json();
    console.log(`Response status: ${response.status}`);
    console.log(`Response headers:`, JSON.stringify(response.headers, null, 2));
    console.log(`Response data:`, JSON.stringify(responseData, null, 2));

    if (!response.ok) {
      if (responseData.message === 'Resource not accessible by integration') {
        throw new Error(
          `Insufficient permissions. Please re-authorize the GitHub integration with the necessary permissions. Full error: ${JSON.stringify(
            responseData
          )}`
        );
      }
      throw new Error(`GitHub API error: ${JSON.stringify(responseData)}`);
    }

    return responseData;
  }
  validateParams(params) {
    if (!params.action) {
      throw new Error('Action is required');
    }
    if (!params.owner) {
      throw new Error('Owner is required');
    }
    if (!params.repo) {
      throw new Error('Repository name is required');
    }
    if (params.action === 'GET_PR_CHANGES') {
      if (!params.pullNumber) {
        throw new Error('Pull request number is required');
      }
    }
    // Add more specific validations for each action as needed
  }
  formatOutput(output) {
    return {
      success: output.success,
      result: output.result,
      error: output.error,
    };
  }
}

export default new GitHubAPI();
