/**
 * GitHub API Plugin Tool
 *
 * Manage repositories, issues, pull requests, branches, and releases.
 */
class GitHubAPI {
  constructor() {
    this.name = 'github-api';
    this.baseUrl = 'https://api.github.com';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[GitHubPlugin] Executing with params:', JSON.stringify(params, null, 2));
    this.validateParams(params);

    try {
      // Import AuthManager dynamically to avoid path issues
      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const userId = workflowEngine.userId;
      const accessToken = await AuthManager.getValidAccessToken(userId, 'github');
      if (!accessToken) {
        throw new Error('No valid access token. Please connect to GitHub in Settings.');
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

      return {
        success: true,
        result: result,
        error: null,
      };
    } catch (error) {
      console.error('[GitHubPlugin] Error:', error);
      return {
        success: false,
        result: null,
        error: error.message,
      };
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
      { method: 'GET' },
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
      `/repos/${params.owner}/${params.repo}/pulls?state=${params.state || 'open'}`,
      { method: 'GET' },
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
      { method: 'GET' },
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
      `/repos/${params.owner}/${params.repo}/contents/${params.filePath}`,
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
      { method: 'GET' },
      params.accessToken
    );

    if (response.size > 1000000) {
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
        { method: 'GET' },
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
      `/repos/${params.owner}/${params.repo}/contents/${params.filePath}`,
      { method: 'GET' },
      params.accessToken
    );

    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/contents/${params.filePath}`,
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
      `/repos/${params.owner}/${params.repo}/commits?sha=${params.branch || ''}&per_page=${params.perPage || 30}`,
      { method: 'GET' },
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

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    const responseData = await response.json();

    if (!response.ok) {
      if (responseData.message === 'Resource not accessible by integration') {
        throw new Error(
          `Insufficient permissions. Please re-authorize the GitHub integration with the necessary permissions.`
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
  }
}

export default new GitHubAPI();
