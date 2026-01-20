# GitHub API 🐙

## Id

`github-api`

## Description

Manages GitHub repositories with full repository operations including issues, pull requests, branches, releases, and file management. Supports repository CRUD operations and comprehensive GitHub workflow automation.

## Tags

github, api, repository, issues, pull-requests, branches, releases, git

## Input Parameters

### Required

- **action** (string): Action to perform (`CREATE_ISSUE`, `CREATE_PR`, `GET_REPO_INFO`, `CREATE_BRANCH`, `MERGE_PR`, `LIST_PRS`, `GET_PR_CHANGES`, `ADD_LABELS`, `REMOVE_LABELS`, `GET_FILE_CONTENT`, `GET_REPO_CONTENTS`, `CREATE_FILE`, `UPDATE_FILE`, `CREATE_RELEASE`, `LIST_COMMITS`)
- **owner** (string): Repository owner/organization
- **repo** (string): Repository name

### Optional

- **title** (string): Issue or PR title
- **body** (string): Issue or PR description
- **head** (string): Source branch for PRs
- **base** (string): Target branch for PRs
- **pullNumber** (number): Pull request number
- **filePath** (string): File path for file operations
- **content** (string): File content for create/update operations
- **tagName** (string): Release tag name
- **releaseName** (string): Release name
- **releaseNotes** (string): Release description

## Output Format

- **success** (boolean): Whether the GitHub operation was successful
- **result** (object): Operation result including issue numbers, PR URLs, file URLs, or commit lists
- **error** (string|null): Error message if the operation failed
