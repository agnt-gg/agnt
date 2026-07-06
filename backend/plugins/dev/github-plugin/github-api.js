/**
 * GitHub API Plugin Tool (v2)
 *
 * Full repository lifecycle: repos, branches, files, issues, comments,
 * pull requests, reviews, releases, GitHub Actions/CI, and search.
 */
import fs from 'fs';
import path from 'path';

/** Per-action required parameters. Actions absent here require nothing beyond `action`. */
const ACTION_REQUIREMENTS = {
  // Issues
  CREATE_ISSUE: ['owner', 'repo', 'title'],
  LIST_ISSUES: ['owner', 'repo'],
  GET_ISSUE: ['owner', 'repo', 'issueNumber'],
  UPDATE_ISSUE: ['owner', 'repo', 'issueNumber'],
  COMMENT_ON_ISSUE: ['owner', 'repo', 'issueNumber', 'body'],
  LIST_COMMENTS: ['owner', 'repo', 'issueNumber'],
  ADD_LABELS: ['owner', 'repo', 'issueNumber', 'labels'],
  REMOVE_LABELS: ['owner', 'repo', 'issueNumber', 'labels'],
  // Pull requests
  CREATE_PR: ['owner', 'repo', 'title', 'head', 'base'],
  LIST_PRS: ['owner', 'repo'],
  GET_PR: ['owner', 'repo', 'pullNumber'],
  UPDATE_PR: ['owner', 'repo', 'pullNumber'],
  MERGE_PR: ['owner', 'repo', 'pullNumber'],
  GET_PR_CHANGES: ['owner', 'repo', 'pullNumber'],
  CREATE_PR_REVIEW: ['owner', 'repo', 'pullNumber', 'reviewEvent'],
  LIST_PR_REVIEWS: ['owner', 'repo', 'pullNumber'],
  REQUEST_REVIEWERS: ['owner', 'repo', 'pullNumber', 'reviewers'],
  // Repos & branches
  GET_REPO_INFO: ['owner', 'repo'],
  LIST_REPOS: [],
  CREATE_REPO: ['repo'],
  FORK_REPO: ['owner', 'repo'],
  LIST_BRANCHES: ['owner', 'repo'],
  CREATE_BRANCH: ['owner', 'repo', 'baseBranch', 'newBranch'],
  DELETE_BRANCH: ['owner', 'repo', 'branch'],
  // Files & contents
  GET_FILE_CONTENT: ['owner', 'repo', 'filePath'],
  GET_REPO_CONTENTS: ['owner', 'repo'],
  CREATE_FILE: ['owner', 'repo', 'filePath', 'content', 'commitMessage'],
  UPDATE_FILE: ['owner', 'repo', 'filePath', 'content', 'commitMessage'],
  DELETE_FILE: ['owner', 'repo', 'filePath', 'commitMessage'],
  // Commits
  LIST_COMMITS: ['owner', 'repo'],
  GET_COMMIT: ['owner', 'repo', 'ref'],
  COMPARE_COMMITS: ['owner', 'repo', 'base', 'head'],
  // Releases
  CREATE_RELEASE: ['owner', 'repo', 'tagName'],
  LIST_RELEASES: ['owner', 'repo'],
  GET_LATEST_RELEASE: ['owner', 'repo'],
  UPLOAD_RELEASE_ASSET: ['owner', 'repo', 'releaseId', 'assetPath'],
  // Actions / CI
  LIST_WORKFLOWS: ['owner', 'repo'],
  LIST_WORKFLOW_RUNS: ['owner', 'repo'],
  GET_WORKFLOW_RUN: ['owner', 'repo', 'runId'],
  TRIGGER_WORKFLOW: ['owner', 'repo', 'workflowId', 'ref'],
  RERUN_WORKFLOW: ['owner', 'repo', 'runId'],
  GET_CHECK_RUNS: ['owner', 'repo', 'ref'],
  // Search & account
  SEARCH_ISSUES: ['query'],
  SEARCH_CODE: ['query'],
  SEARCH_REPOS: ['query'],
  GET_AUTHENTICATED_USER: [],
};

class GitHubAPI {
  constructor() {
    this.name = 'github-api';
    this.baseUrl = 'https://api.github.com';
    this.uploadsUrl = 'https://uploads.github.com';
  }

  async execute(params, inputData, workflowEngine) {
    try {
      this.validateParams(params);

      const accessToken = params.__auth?.token;
      if (!accessToken) {
        throw new Error('Not connected to GitHub. Connect in Settings → Connections.');
      }
      params.accessToken = accessToken;

      const handlers = {
        // Issues
        CREATE_ISSUE: this.createIssue,
        LIST_ISSUES: this.listIssues,
        GET_ISSUE: this.getIssue,
        UPDATE_ISSUE: this.updateIssue,
        COMMENT_ON_ISSUE: this.commentOnIssue,
        LIST_COMMENTS: this.listComments,
        ADD_LABELS: this.addLabels,
        REMOVE_LABELS: this.removeLabels,
        // Pull requests
        CREATE_PR: this.createPullRequest,
        LIST_PRS: this.listPullRequests,
        GET_PR: this.getPullRequest,
        UPDATE_PR: this.updatePullRequest,
        MERGE_PR: this.mergePullRequest,
        GET_PR_CHANGES: this.getPullRequestChanges,
        CREATE_PR_REVIEW: this.createPullRequestReview,
        LIST_PR_REVIEWS: this.listPullRequestReviews,
        REQUEST_REVIEWERS: this.requestReviewers,
        // Repos & branches
        GET_REPO_INFO: this.getRepoInfo,
        LIST_REPOS: this.listRepos,
        CREATE_REPO: this.createRepo,
        FORK_REPO: this.forkRepo,
        LIST_BRANCHES: this.listBranches,
        CREATE_BRANCH: this.createBranch,
        DELETE_BRANCH: this.deleteBranch,
        // Files & contents
        GET_FILE_CONTENT: this.getFileContent,
        GET_REPO_CONTENTS: this.getRepoContents,
        CREATE_FILE: this.createFile,
        UPDATE_FILE: this.updateFile,
        DELETE_FILE: this.deleteFile,
        // Commits
        LIST_COMMITS: this.listCommits,
        GET_COMMIT: this.getCommit,
        COMPARE_COMMITS: this.compareCommits,
        // Releases
        CREATE_RELEASE: this.createRelease,
        LIST_RELEASES: this.listReleases,
        GET_LATEST_RELEASE: this.getLatestRelease,
        UPLOAD_RELEASE_ASSET: this.uploadReleaseAsset,
        // Actions / CI
        LIST_WORKFLOWS: this.listWorkflows,
        LIST_WORKFLOW_RUNS: this.listWorkflowRuns,
        GET_WORKFLOW_RUN: this.getWorkflowRun,
        TRIGGER_WORKFLOW: this.triggerWorkflow,
        RERUN_WORKFLOW: this.rerunWorkflow,
        GET_CHECK_RUNS: this.getCheckRuns,
        // Search & account
        SEARCH_ISSUES: this.searchIssues,
        SEARCH_CODE: this.searchCode,
        SEARCH_REPOS: this.searchRepos,
        GET_AUTHENTICATED_USER: this.getAuthenticatedUser,
      };

      const handler = handlers[params.action];
      if (!handler) {
        throw new Error(`Unsupported action: ${params.action}`);
      }

      const result = await handler.call(this, params);
      return { success: true, result, error: null };
    } catch (error) {
      console.error('[GitHubPlugin] Error:', error.message);
      return { success: false, result: null, error: error.message };
    }
  }

  // ─────────────────────────── Issues ───────────────────────────

  async createIssue(params) {
    const body = {
      title: params.title,
      body: params.body || '',
    };
    const labels = this.normalizeList(params.labels);
    if (labels.length) body.labels = labels;
    const assignees = this.normalizeList(params.assignees);
    if (assignees.length) body.assignees = assignees;

    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/issues`,
      { method: 'POST', body: JSON.stringify(body) },
      params.accessToken
    );

    return {
      issueNumber: response.number,
      issueUrl: response.html_url,
      state: response.state,
    };
  }

  async listIssues(params) {
    const query = this.listQuery(params, {
      state: params.state || 'open',
      labels: this.normalizeList(params.labels).join(',') || undefined,
    });
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/issues?${query}`,
      { method: 'GET' },
      params.accessToken
    );

    // The issues endpoint also returns PRs; exclude them.
    return response
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: (issue.labels || []).map((l) => l.name),
        assignees: (issue.assignees || []).map((a) => a.login),
        author: issue.user?.login,
        comments: issue.comments,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        url: issue.html_url,
      }));
  }

  async getIssue(params) {
    const issue = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/issues/${params.issueNumber}`,
      { method: 'GET' },
      params.accessToken
    );

    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: (issue.labels || []).map((l) => l.name),
      assignees: (issue.assignees || []).map((a) => a.login),
      author: issue.user?.login,
      comments: issue.comments,
      isPullRequest: Boolean(issue.pull_request),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      closedAt: issue.closed_at,
      url: issue.html_url,
    };
  }

  async updateIssue(params) {
    const body = {};
    if (params.title) body.title = params.title;
    if (params.body) body.body = params.body;
    if (params.issueState) body.state = params.issueState;
    const labels = this.normalizeList(params.labels);
    if (labels.length) body.labels = labels;
    const assignees = this.normalizeList(params.assignees);
    if (assignees.length) body.assignees = assignees;
    if (Object.keys(body).length === 0) {
      throw new Error('UPDATE_ISSUE requires at least one of: title, body, issueState, labels, assignees');
    }

    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/issues/${params.issueNumber}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      params.accessToken
    );

    return {
      issueNumber: response.number,
      title: response.title,
      state: response.state,
      url: response.html_url,
    };
  }

  async commentOnIssue(params) {
    // Works for both issues and pull requests (PRs are issues in the comments API).
    const number = params.issueNumber || params.pullNumber;
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/issues/${number}/comments`,
      { method: 'POST', body: JSON.stringify({ body: params.body }) },
      params.accessToken
    );

    return {
      commentId: response.id,
      commentUrl: response.html_url,
      createdAt: response.created_at,
    };
  }

  async listComments(params) {
    const number = params.issueNumber || params.pullNumber;
    const query = this.listQuery(params);
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/issues/${number}/comments?${query}`,
      { method: 'GET' },
      params.accessToken
    );

    return response.map((comment) => ({
      id: comment.id,
      author: comment.user?.login,
      body: comment.body,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      url: comment.html_url,
    }));
  }

  async addLabels(params) {
    const labels = this.normalizeList(params.labels);
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/issues/${params.issueNumber}/labels`,
      { method: 'POST', body: JSON.stringify({ labels }) },
      params.accessToken
    );

    return { labels: response.map((label) => label.name) };
  }

  async removeLabels(params) {
    const labels = this.normalizeList(params.labels);
    const removed = [];
    for (const label of labels) {
      await this.makeRequest(
        `/repos/${params.owner}/${params.repo}/issues/${params.issueNumber}/labels/${encodeURIComponent(label)}`,
        { method: 'DELETE' },
        params.accessToken
      );
      removed.push(label);
    }
    return { removedLabels: removed };
  }

  // ─────────────────────── Pull requests ────────────────────────

  async createPullRequest(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: params.title,
          body: params.body || '',
          head: params.head,
          base: params.base,
          draft: this.flag(params.draft),
        }),
      },
      params.accessToken
    );

    return {
      pullRequestNumber: response.number,
      pullRequestUrl: response.html_url,
      draft: response.draft,
      state: response.state,
    };
  }

  async listPullRequests(params) {
    const query = this.listQuery(params, {
      state: params.state || 'open',
      sort: params.sort || 'created',
      direction: params.direction || 'desc',
    });
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/pulls?${query}`,
      { method: 'GET' },
      params.accessToken
    );

    return response.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.draft,
      author: pr.user?.login,
      headRef: pr.head?.ref,
      baseRef: pr.base?.ref,
      createdAt: pr.created_at,
      url: pr.html_url,
    }));
  }

  async getPullRequest(params) {
    const pr = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}`,
      { method: 'GET' },
      params.accessToken
    );

    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      draft: pr.draft,
      merged: pr.merged,
      mergeable: pr.mergeable,
      mergeableState: pr.mergeable_state,
      headRef: pr.head?.ref,
      headSha: pr.head?.sha,
      baseRef: pr.base?.ref,
      author: pr.user?.login,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      commits: pr.commits,
      comments: pr.comments,
      reviewComments: pr.review_comments,
      labels: (pr.labels || []).map((l) => l.name),
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      mergedAt: pr.merged_at,
      url: pr.html_url,
    };
  }

  async updatePullRequest(params) {
    const body = {};
    if (params.title) body.title = params.title;
    if (params.body) body.body = params.body;
    if (params.issueState) body.state = params.issueState;
    if (params.base) body.base = params.base;
    if (Object.keys(body).length === 0) {
      throw new Error('UPDATE_PR requires at least one of: title, body, issueState, base');
    }

    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      params.accessToken
    );

    return {
      pullRequestNumber: response.number,
      title: response.title,
      state: response.state,
      url: response.html_url,
    };
  }

  async mergePullRequest(params) {
    const body = { merge_method: params.mergeMethod || 'merge' };
    if (params.commitTitle) body.commit_title = params.commitTitle;

    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/merge`,
      { method: 'PUT', body: JSON.stringify(body) },
      params.accessToken
    );

    return {
      merged: response.merged,
      message: response.message,
      sha: response.sha,
    };
  }

  async getPullRequestChanges(params) {
    const query = this.listQuery(params);
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/files?${query}`,
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

  async createPullRequestReview(params) {
    const event = String(params.reviewEvent || '').toUpperCase();
    if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event)) {
      throw new Error(`Invalid reviewEvent: ${params.reviewEvent}. Use APPROVE, REQUEST_CHANGES, or COMMENT.`);
    }
    if ((event === 'REQUEST_CHANGES' || event === 'COMMENT') && !params.body) {
      throw new Error(`A review body is required when reviewEvent is ${event}.`);
    }

    const body = { event };
    if (params.body) body.body = params.body;

    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/reviews`,
      { method: 'POST', body: JSON.stringify(body) },
      params.accessToken
    );

    return {
      reviewId: response.id,
      state: response.state,
      url: response.html_url,
    };
  }

  async listPullRequestReviews(params) {
    const query = this.listQuery(params);
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/reviews?${query}`,
      { method: 'GET' },
      params.accessToken
    );

    return response.map((review) => ({
      id: review.id,
      author: review.user?.login,
      state: review.state,
      body: review.body,
      submittedAt: review.submitted_at,
      url: review.html_url,
    }));
  }

  async requestReviewers(params) {
    const reviewers = this.normalizeList(params.reviewers);
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/requested_reviewers`,
      { method: 'POST', body: JSON.stringify({ reviewers }) },
      params.accessToken
    );

    return {
      requestedReviewers: (response.requested_reviewers || []).map((r) => r.login),
      url: response.html_url,
    };
  }

  // ─────────────────── Repositories & branches ──────────────────

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
      private: response.private,
      stars: response.stargazers_count,
      forks: response.forks_count,
      openIssues: response.open_issues_count,
      defaultBranch: response.default_branch,
      language: response.language,
      url: response.html_url,
    };
  }

  async listRepos(params) {
    const query = this.listQuery(params, {
      visibility: params.visibility && params.visibility !== 'all' ? params.visibility : undefined,
      sort: params.sort || 'updated',
    });
    const response = await this.makeRequest(
      `/user/repos?${query}`,
      { method: 'GET' },
      params.accessToken
    );

    return response.map((repo) => ({
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner?.login,
      private: repo.private,
      description: repo.description,
      defaultBranch: repo.default_branch,
      stars: repo.stargazers_count,
      language: repo.language,
      updatedAt: repo.updated_at,
      url: repo.html_url,
    }));
  }

  async createRepo(params) {
    const response = await this.makeRequest(
      '/user/repos',
      {
        method: 'POST',
        body: JSON.stringify({
          name: params.repo,
          description: params.description || '',
          private: this.flag(params.private),
          auto_init: true,
        }),
      },
      params.accessToken
    );

    return {
      name: response.name,
      fullName: response.full_name,
      private: response.private,
      defaultBranch: response.default_branch,
      url: response.html_url,
    };
  }

  async forkRepo(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/forks`,
      { method: 'POST', body: JSON.stringify({}) },
      params.accessToken
    );

    return {
      fullName: response.full_name,
      owner: response.owner?.login,
      url: response.html_url,
      note: 'Forking is asynchronous; the fork may take a few seconds to be fully available.',
    };
  }

  async listBranches(params) {
    const query = this.listQuery(params);
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/branches?${query}`,
      { method: 'GET' },
      params.accessToken
    );

    return response.map((branch) => ({
      name: branch.name,
      sha: branch.commit?.sha,
      protected: branch.protected,
    }));
  }

  async createBranch(params) {
    const getRefResponse = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/git/ref/heads/${this.encodePath(params.baseBranch)}`,
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
      sha: response.object?.sha,
      branchUrl: response.url,
    };
  }

  async deleteBranch(params) {
    await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/git/refs/heads/${this.encodePath(params.branch)}`,
      { method: 'DELETE' },
      params.accessToken
    );

    return { deleted: true, branchName: params.branch };
  }

  // ─────────────────────── Files & contents ─────────────────────

  async getFileContent(params) {
    const queryParams = params.ref ? `?ref=${encodeURIComponent(params.ref)}` : '';
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/contents/${this.encodePath(params.filePath)}${queryParams}`,
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
    // Recursive listing uses the git trees API: one request, metadata only.
    // (v1 downloaded every file's full content recursively — a rate-limit bomb.)
    if (this.flag(params.recursive)) {
      let ref = params.ref;
      if (!ref) {
        const repoInfo = await this.makeRequest(
          `/repos/${params.owner}/${params.repo}`,
          { method: 'GET' },
          params.accessToken
        );
        ref = repoInfo.default_branch;
      }

      const response = await this.makeRequest(
        `/repos/${params.owner}/${params.repo}/git/trees/${this.encodePath(ref)}?recursive=1`,
        { method: 'GET' },
        params.accessToken
      );

      return {
        ref,
        truncated: response.truncated,
        entries: (response.tree || []).map((item) => ({
          path: item.path,
          type: item.type === 'tree' ? 'dir' : 'file',
          size: item.size,
          sha: item.sha,
        })),
      };
    }

    const dirPath = params.filePath || '';
    const queryParams = params.ref ? `?ref=${encodeURIComponent(params.ref)}` : '';
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/contents/${this.encodePath(dirPath)}${queryParams}`,
      { method: 'GET' },
      params.accessToken
    );

    const items = Array.isArray(response) ? response : [response];
    return {
      path: dirPath || '/',
      entries: items.map((item) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        sha: item.sha,
        url: item.html_url,
      })),
    };
  }

  async createFile(params) {
    const body = {
      message: params.commitMessage,
      content: Buffer.from(params.content).toString('base64'),
    };
    if (params.branch) body.branch = params.branch;

    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/contents/${this.encodePath(params.filePath)}`,
      { method: 'PUT', body: JSON.stringify(body) },
      params.accessToken
    );

    return {
      fileUrl: response.content?.html_url,
      commitSha: response.commit?.sha,
    };
  }

  async updateFile(params) {
    const refQuery = params.branch ? `?ref=${encodeURIComponent(params.branch)}` : '';
    const currentFile = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/contents/${this.encodePath(params.filePath)}${refQuery}`,
      { method: 'GET' },
      params.accessToken
    );

    const body = {
      message: params.commitMessage,
      content: Buffer.from(params.content).toString('base64'),
      sha: currentFile.sha,
    };
    if (params.branch) body.branch = params.branch;

    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/contents/${this.encodePath(params.filePath)}`,
      { method: 'PUT', body: JSON.stringify(body) },
      params.accessToken
    );

    return {
      fileUrl: response.content?.html_url,
      commitSha: response.commit?.sha,
    };
  }

  async deleteFile(params) {
    const refQuery = params.branch ? `?ref=${encodeURIComponent(params.branch)}` : '';
    const currentFile = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/contents/${this.encodePath(params.filePath)}${refQuery}`,
      { method: 'GET' },
      params.accessToken
    );

    const body = {
      message: params.commitMessage,
      sha: currentFile.sha,
    };
    if (params.branch) body.branch = params.branch;

    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/contents/${this.encodePath(params.filePath)}`,
      { method: 'DELETE', body: JSON.stringify(body) },
      params.accessToken
    );

    return {
      deleted: true,
      filePath: params.filePath,
      commitSha: response.commit?.sha,
    };
  }

  // ───────────────────────── Commits ────────────────────────────

  async listCommits(params) {
    const query = this.listQuery(params, {
      sha: params.branch || undefined,
    });
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/commits?${query}`,
      { method: 'GET' },
      params.accessToken
    );

    return response.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author?.name,
      date: commit.commit.author?.date,
      url: commit.html_url,
    }));
  }

  async getCommit(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/commits/${this.encodePath(params.ref)}`,
      { method: 'GET' },
      params.accessToken
    );

    return {
      sha: response.sha,
      message: response.commit?.message,
      author: response.commit?.author?.name,
      date: response.commit?.author?.date,
      stats: response.stats,
      files: (response.files || []).map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      })),
      url: response.html_url,
    };
  }

  async compareCommits(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/compare/${this.encodePath(params.base)}...${this.encodePath(params.head)}`,
      { method: 'GET' },
      params.accessToken
    );

    return {
      status: response.status,
      aheadBy: response.ahead_by,
      behindBy: response.behind_by,
      totalCommits: response.total_commits,
      commits: (response.commits || []).map((c) => ({
        sha: c.sha,
        message: c.commit?.message,
        author: c.commit?.author?.name,
      })),
      files: (response.files || []).map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      })),
      url: response.html_url,
    };
  }

  // ───────────────────────── Releases ───────────────────────────

  async createRelease(params) {
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/releases`,
      {
        method: 'POST',
        body: JSON.stringify({
          tag_name: params.tagName,
          name: params.releaseName || params.tagName,
          body: params.releaseNotes || '',
          draft: this.flag(params.draft),
          prerelease: this.flag(params.prerelease),
        }),
      },
      params.accessToken
    );

    return {
      releaseId: response.id,
      releaseUrl: response.html_url,
      tagName: response.tag_name,
    };
  }

  async listReleases(params) {
    const query = this.listQuery(params);
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/releases?${query}`,
      { method: 'GET' },
      params.accessToken
    );

    return response.map((release) => ({
      id: release.id,
      tagName: release.tag_name,
      name: release.name,
      draft: release.draft,
      prerelease: release.prerelease,
      publishedAt: release.published_at,
      assets: (release.assets || []).map((a) => ({ id: a.id, name: a.name, size: a.size, downloadUrl: a.browser_download_url })),
      url: release.html_url,
    }));
  }

  async getLatestRelease(params) {
    const release = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/releases/latest`,
      { method: 'GET' },
      params.accessToken
    );

    return {
      id: release.id,
      tagName: release.tag_name,
      name: release.name,
      body: release.body,
      publishedAt: release.published_at,
      assets: (release.assets || []).map((a) => ({ id: a.id, name: a.name, size: a.size, downloadUrl: a.browser_download_url })),
      url: release.html_url,
    };
  }

  async uploadReleaseAsset(params) {
    if (!fs.existsSync(params.assetPath)) {
      throw new Error(`Asset file not found: ${params.assetPath}`);
    }
    const data = fs.readFileSync(params.assetPath);
    const name = params.assetName || path.basename(params.assetPath);

    const url = `${this.uploadsUrl}/repos/${params.owner}/${params.repo}/releases/${params.releaseId}/assets?name=${encodeURIComponent(name)}`;
    const response = await this.makeRequest(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data,
      },
      params.accessToken
    );

    return {
      assetId: response.id,
      name: response.name,
      size: response.size,
      downloadUrl: response.browser_download_url,
    };
  }

  // ──────────────────── GitHub Actions / CI ─────────────────────

  async listWorkflows(params) {
    const query = this.listQuery(params);
    const response = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/actions/workflows?${query}`,
      { method: 'GET' },
      params.accessToken
    );

    return {
      totalCount: response.total_count,
      workflows: (response.workflows || []).map((wf) => ({
        id: wf.id,
        name: wf.name,
        path: wf.path,
        state: wf.state,
        url: wf.html_url,
      })),
    };
  }

  async listWorkflowRuns(params) {
    const query = this.listQuery(params, {
      branch: params.branch || undefined,
      status: params.runStatus || undefined,
    });
    const endpoint = params.workflowId
      ? `/repos/${params.owner}/${params.repo}/actions/workflows/${this.encodePath(String(params.workflowId))}/runs?${query}`
      : `/repos/${params.owner}/${params.repo}/actions/runs?${query}`;

    const response = await this.makeRequest(endpoint, { method: 'GET' }, params.accessToken);

    return {
      totalCount: response.total_count,
      runs: (response.workflow_runs || []).map((run) => ({
        id: run.id,
        name: run.name,
        headBranch: run.head_branch,
        headSha: run.head_sha,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        runNumber: run.run_number,
        createdAt: run.created_at,
        url: run.html_url,
      })),
    };
  }

  async getWorkflowRun(params) {
    const run = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/actions/runs/${params.runId}`,
      { method: 'GET' },
      params.accessToken
    );

    let jobs = [];
    try {
      const jobsResponse = await this.makeRequest(
        `/repos/${params.owner}/${params.repo}/actions/runs/${params.runId}/jobs`,
        { method: 'GET' },
        params.accessToken
      );
      jobs = (jobsResponse.jobs || []).map((job) => ({
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        startedAt: job.started_at,
        completedAt: job.completed_at,
      }));
    } catch (error) {
      // Jobs are supplementary; don't fail the whole action if they're unavailable.
      console.error('[GitHubPlugin] Could not fetch run jobs:', error.message);
    }

    return {
      id: run.id,
      name: run.name,
      headBranch: run.head_branch,
      headSha: run.head_sha,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      runNumber: run.run_number,
      runAttempt: run.run_attempt,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      jobs,
      url: run.html_url,
    };
  }

  async triggerWorkflow(params) {
    const body = { ref: params.ref };
    if (params.workflowInputs) {
      body.inputs = this.parseMaybeJson(params.workflowInputs, 'workflowInputs');
    }

    await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/actions/workflows/${this.encodePath(String(params.workflowId))}/dispatches`,
      { method: 'POST', body: JSON.stringify(body) },
      params.accessToken
    );

    return {
      triggered: true,
      workflowId: params.workflowId,
      ref: params.ref,
      note: 'Dispatch accepted. Use LIST_WORKFLOW_RUNS to find the new run (it may take a few seconds to appear).',
    };
  }

  async rerunWorkflow(params) {
    await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/actions/runs/${params.runId}/rerun`,
      { method: 'POST' },
      params.accessToken
    );

    return { rerunTriggered: true, runId: params.runId };
  }

  async getCheckRuns(params) {
    const checkRunsResponse = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/commits/${this.encodePath(params.ref)}/check-runs`,
      { method: 'GET' },
      params.accessToken
    );

    const statusResponse = await this.makeRequest(
      `/repos/${params.owner}/${params.repo}/commits/${this.encodePath(params.ref)}/status`,
      { method: 'GET' },
      params.accessToken
    );

    return {
      ref: params.ref,
      combinedStatus: statusResponse.state,
      totalCheckRuns: checkRunsResponse.total_count,
      checkRuns: (checkRunsResponse.check_runs || []).map((check) => ({
        id: check.id,
        name: check.name,
        status: check.status,
        conclusion: check.conclusion,
        startedAt: check.started_at,
        completedAt: check.completed_at,
        url: check.html_url,
      })),
      statuses: (statusResponse.statuses || []).map((s) => ({
        context: s.context,
        state: s.state,
        description: s.description,
      })),
    };
  }

  // ────────────────────── Search & account ──────────────────────

  async searchIssues(params) {
    const query = this.listQuery(params, { q: params.query });
    const response = await this.makeRequest(
      `/search/issues?${query}`,
      { method: 'GET' },
      params.accessToken
    );

    return {
      totalCount: response.total_count,
      items: (response.items || []).map((item) => ({
        number: item.number,
        title: item.title,
        state: item.state,
        isPullRequest: Boolean(item.pull_request),
        repository: item.repository_url?.replace('https://api.github.com/repos/', ''),
        author: item.user?.login,
        labels: (item.labels || []).map((l) => l.name),
        createdAt: item.created_at,
        url: item.html_url,
      })),
    };
  }

  async searchCode(params) {
    const query = this.listQuery(params, { q: params.query });
    const response = await this.makeRequest(
      `/search/code?${query}`,
      { method: 'GET' },
      params.accessToken
    );

    return {
      totalCount: response.total_count,
      items: (response.items || []).map((item) => ({
        name: item.name,
        path: item.path,
        repository: item.repository?.full_name,
        sha: item.sha,
        url: item.html_url,
      })),
    };
  }

  async searchRepos(params) {
    const query = this.listQuery(params, { q: params.query });
    const response = await this.makeRequest(
      `/search/repositories?${query}`,
      { method: 'GET' },
      params.accessToken
    );

    return {
      totalCount: response.total_count,
      items: (response.items || []).map((repo) => ({
        fullName: repo.full_name,
        description: repo.description,
        stars: repo.stargazers_count,
        language: repo.language,
        updatedAt: repo.updated_at,
        url: repo.html_url,
      })),
    };
  }

  async getAuthenticatedUser(params) {
    const user = await this.makeRequest('/user', { method: 'GET' }, params.accessToken);

    return {
      login: user.login,
      id: user.id,
      name: user.name,
      email: user.email,
      publicRepos: user.public_repos,
      privateRepos: user.total_private_repos,
      url: user.html_url,
    };
  }

  // ──────────────────────── HTTP core ───────────────────────────

  async makeRequest(endpoint, options = {}, accessToken) {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    // Rate-limit exhaustion: surface a clear, actionable error.
    if (
      (response.status === 403 || response.status === 429) &&
      response.headers.get('x-ratelimit-remaining') === '0'
    ) {
      const resetEpoch = Number(response.headers.get('x-ratelimit-reset'));
      const resetAt = resetEpoch ? new Date(resetEpoch * 1000).toISOString() : 'unknown';
      throw new Error(`GitHub API rate limit exceeded. Limit resets at ${resetAt}.`);
    }

    // 204/205 (and any empty body) have no JSON to parse.
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      const message = data?.message || text || response.statusText;
      if (message === 'Resource not accessible by integration') {
        throw new Error(
          'Insufficient permissions. Please re-authorize the GitHub integration with the necessary permissions.'
        );
      }
      const details = data?.errors ? ` Details: ${JSON.stringify(data.errors)}` : '';
      throw new Error(`GitHub API error (${response.status}): ${message}${details}`);
    }

    return data ?? { status: response.status };
  }

  // ───────────────────────── Helpers ────────────────────────────

  validateParams(params) {
    if (!params.action) {
      throw new Error('Action is required');
    }
    const required = ACTION_REQUIREMENTS[params.action];
    if (!required) {
      throw new Error(`Unsupported action: ${params.action}`);
    }
    for (const field of required) {
      const value = params[field];
      if (value === undefined || value === null || value === '') {
        throw new Error(`"${field}" is required for ${params.action}`);
      }
    }
  }

  /** Build a query string with pagination + extra filters (empty values omitted). */
  listQuery(params, extra = {}) {
    const query = new URLSearchParams();
    query.set('per_page', String(parseInt(params.perPage, 10) || 30));
    query.set('page', String(parseInt(params.page, 10) || 1));
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    }
    return query.toString();
  }

  /** Accept an array OR a comma-separated string; return a clean string array. */
  normalizeList(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }
    return String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  /** Checkbox params arrive as boolean or the string "true". */
  flag(value) {
    return value === true || value === 'true';
  }

  /** Encode a path, preserving `/` separators (handles spaces & special chars in segments). */
  encodePath(value) {
    return String(value)
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  /** Parse a JSON object param that may arrive as a string or an object. */
  parseMaybeJson(value, label) {
    if (typeof value === 'object' && value !== null) return value;
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`"${label}" must be a valid JSON object`);
    }
  }
}

export default new GitHubAPI();
