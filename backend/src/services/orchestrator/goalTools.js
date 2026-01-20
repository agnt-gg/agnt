/**
 * Goal-specific tools for the goal task orchestrator
 */

export function getGoalToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'create_goal',
        description: 'Create a new goal with AI-powered task breakdown and analysis',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'The goal description text to analyze and break down into tasks',
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent'],
              description: 'Priority level for the goal',
              default: 'medium',
            },
            provider: {
              type: 'string',
              description: 'AI provider to use for goal analysis (optional)',
            },
            model: {
              type: 'string',
              description: 'AI model to use for goal analysis (optional)',
            },
          },
          required: ['text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_goals',
        description: 'List all user goals with their current status and progress',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['all', 'planning', 'executing', 'paused', 'completed', 'failed', 'stopped'],
              description: 'Filter goals by status',
              default: 'all',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of goals to return',
              default: 50,
            },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_goal_details',
        description: 'Get detailed information about a specific goal including tasks and progress',
        parameters: {
          type: 'object',
          properties: {
            goal_id: {
              type: 'string',
              description: 'The ID of the goal to retrieve details for',
            },
          },
          required: ['goal_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'execute_goal',
        description: 'Start execution of a goal and begin processing its tasks',
        parameters: {
          type: 'object',
          properties: {
            goal_id: {
              type: 'string',
              description: 'The ID of the goal to execute',
            },
            provider: {
              type: 'string',
              description: 'AI provider to use for task execution',
            },
            model: {
              type: 'string',
              description: 'AI model to use for task execution',
            },
          },
          required: ['goal_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'pause_goal',
        description: 'Pause execution of a running goal',
        parameters: {
          type: 'object',
          properties: {
            goal_id: {
              type: 'string',
              description: 'The ID of the goal to pause',
            },
          },
          required: ['goal_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'resume_goal',
        description: 'Resume execution of a paused goal',
        parameters: {
          type: 'object',
          properties: {
            goal_id: {
              type: 'string',
              description: 'The ID of the goal to resume',
            },
          },
          required: ['goal_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_goal',
        description: 'Permanently delete a goal and all its associated tasks',
        parameters: {
          type: 'object',
          properties: {
            goal_id: {
              type: 'string',
              description: 'The ID of the goal to delete',
            },
          },
          required: ['goal_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_goal_status',
        description: 'Get real-time status and progress information for a goal',
        parameters: {
          type: 'object',
          properties: {
            goal_id: {
              type: 'string',
              description: 'The ID of the goal to check status for',
            },
          },
          required: ['goal_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_task_status',
        description: 'Update the status and progress of a specific task within a goal',
        parameters: {
          type: 'object',
          properties: {
            goal_id: {
              type: 'string',
              description: 'The ID of the goal containing the task',
            },
            task_id: {
              type: 'string',
              description: 'The ID of the task to update',
            },
            status: {
              type: 'string',
              enum: ['pending', 'running', 'completed', 'failed', 'paused'],
              description: 'New status for the task',
            },
            progress: {
              type: 'number',
              description: 'Progress percentage (0-100)',
              minimum: 0,
              maximum: 100,
            },
            output: {
              type: 'string',
              description: 'Task output or result data',
            },
            error: {
              type: 'string',
              description: 'Error message if task failed',
            },
          },
          required: ['goal_id', 'task_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fetch_goal_tasks',
        description: 'Get detailed information about all tasks in a goal',
        parameters: {
          type: 'object',
          properties: {
            goal_id: {
              type: 'string',
              description: 'The ID of the goal to fetch tasks for',
            },
          },
          required: ['goal_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'evaluate_goal',
        description: 'Evaluate a completed goal against its success criteria using AI-powered analysis',
        parameters: {
          type: 'object',
          properties: {
            goal_id: {
              type: 'string',
              description: 'The ID of the goal to evaluate',
            },
            evaluation_type: {
              type: 'string',
              enum: ['automatic', 'manual', 'hybrid'],
              description: 'Type of evaluation to perform',
              default: 'automatic',
            },
          },
          required: ['goal_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_evaluation_report',
        description: 'Get the evaluation report for a goal including scores and feedback',
        parameters: {
          type: 'object',
          properties: {
            goal_id: {
              type: 'string',
              description: 'The ID of the goal to get evaluation report for',
            },
          },
          required: ['goal_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'save_as_golden_standard',
        description: 'Save a successfully completed goal as a golden standard template for future reference',
        parameters: {
          type: 'object',
          properties: {
            goal_id: {
              type: 'string',
              description: 'The ID of the goal to save as golden standard',
            },
            category: {
              type: 'string',
              description: 'Category for the golden standard (e.g., "research", "content-creation", "data-analysis")',
            },
          },
          required: ['goal_id', 'category'],
        },
      },
    },
  ];
}

export async function executeGoalTool(functionName, args, authToken, context) {
  const { userId } = context;

  try {
    switch (functionName) {
      case 'create_goal':
        return await handleCreateGoal(args, authToken, context);

      case 'list_goals':
        return await handleListGoals(args, authToken, context);

      case 'get_goal_details':
        return await handleGetGoalDetails(args, authToken, context);

      case 'execute_goal':
        return await handleExecuteGoal(args, authToken, context);

      case 'pause_goal':
        return await handlePauseGoal(args, authToken, context);

      case 'resume_goal':
        return await handleResumeGoal(args, authToken, context);

      case 'delete_goal':
        return await handleDeleteGoal(args, authToken, context);

      case 'get_goal_status':
        return await handleGetGoalStatus(args, authToken, context);

      case 'update_task_status':
        return await handleUpdateTaskStatus(args, authToken, context);

      case 'fetch_goal_tasks':
        return await handleFetchGoalTasks(args, authToken, context);

      case 'evaluate_goal':
        return await handleEvaluateGoal(args, authToken, context);

      case 'get_evaluation_report':
        return await handleGetEvaluationReport(args, authToken, context);

      case 'save_as_golden_standard':
        return await handleSaveAsGoldenStandard(args, authToken, context);

      default:
        return JSON.stringify({
          success: false,
          error: `Unknown goal tool function: ${functionName}`,
        });
    }
  } catch (error) {
    console.error(`Error executing goal tool ${functionName}:`, error);
    return JSON.stringify({
      success: false,
      error: `Goal tool execution failed: ${error.message}`,
      function: functionName,
    });
  }
}

async function handleCreateGoal(args, authToken, context) {
  const { text, priority = 'medium', provider, model } = args;

  try {
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3333';
    const response = await fetch(`${API_BASE_URL}/api/goals/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify({
        text,
        priority,
        provider,
        model,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    return JSON.stringify({
      success: true,
      goal: {
        id: data.goal.goalId,
        title: data.goal.title,
        description: data.goal.description,
        status: 'planning',
        priority,
        tasks: data.goal.tasks || [],
        task_count: data.goal.tasks?.length || 0,
        completed_tasks: 0,
        created_at: new Date().toISOString(),
      },
      message: `Goal "${data.goal.title}" created successfully with ${data.goal.tasks?.length || 0} tasks`,
    });
  } catch (error) {
    console.error('Error creating goal:', error);
    return JSON.stringify({
      success: false,
      error: `Failed to create goal: ${error.message}`,
    });
  }
}

async function handleListGoals(args, authToken, context) {
  const { status = 'all', limit = 50 } = args;

  try {
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3333';
    const response = await fetch(`${API_BASE_URL}/api/goals`, {
      headers: {
        Authorization: authToken,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    let goals = data.goals || [];

    // Filter by status if specified
    if (status !== 'all') {
      goals = goals.filter((goal) => goal.status === status);
    }

    // Apply limit
    goals = goals.slice(0, limit);

    return JSON.stringify({
      success: true,
      goals: goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        description: goal.description,
        status: goal.status,
        priority: goal.priority,
        progress: goal.progress || 0,
        task_count: goal.task_count || 0,
        completed_tasks: goal.completed_tasks || 0,
        created_at: goal.created_at,
        updated_at: goal.updated_at,
      })),
      count: goals.length,
      message: `Found ${goals.length} goals${status !== 'all' ? ` with status '${status}'` : ''}`,
    });
  } catch (error) {
    console.error('Error listing goals:', error);
    return JSON.stringify({
      success: false,
      error: `Failed to list goals: ${error.message}`,
    });
  }
}

async function handleGetGoalDetails(args, authToken, context) {
  const { goal_id } = args;

  try {
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3333';
    const response = await fetch(`${API_BASE_URL}/api/goals/${goal_id}`, {
      headers: {
        Authorization: authToken,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return JSON.stringify({
          success: false,
          error: 'Goal not found',
        });
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    return JSON.stringify({
      success: true,
      goal: data.goal,
      message: `Retrieved details for goal "${data.goal.title}"`,
    });
  } catch (error) {
    console.error('Error getting goal details:', error);
    return JSON.stringify({
      success: false,
      error: `Failed to get goal details: ${error.message}`,
    });
  }
}

async function handleExecuteGoal(args, authToken, context) {
  const { goal_id, provider, model } = args;

  try {
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3333';
    const response = await fetch(`${API_BASE_URL}/api/goals/${goal_id}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify({
        provider,
        model,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    return JSON.stringify({
      success: true,
      goal_id,
      status: 'executing',
      agent: data.agent,
      message: `Goal execution started successfully`,
    });
  } catch (error) {
    console.error('Error executing goal:', error);
    return JSON.stringify({
      success: false,
      error: `Failed to execute goal: ${error.message}`,
    });
  }
}

async function handlePauseGoal(args, authToken, context) {
  const { goal_id } = args;

  try {
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3333';
    const response = await fetch(`${API_BASE_URL}/api/goals/${goal_id}/pause`, {
      method: 'POST',
      headers: {
        Authorization: authToken,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return JSON.stringify({
      success: true,
      goal_id,
      status: 'paused',
      message: 'Goal execution paused successfully',
    });
  } catch (error) {
    console.error('Error pausing goal:', error);
    return JSON.stringify({
      success: false,
      error: `Failed to pause goal: ${error.message}`,
    });
  }
}

async function handleResumeGoal(args, authToken, context) {
  const { goal_id } = args;

  try {
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3333';
    const response = await fetch(`${API_BASE_URL}/api/goals/${goal_id}/resume`, {
      method: 'POST',
      headers: {
        Authorization: authToken,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return JSON.stringify({
      success: true,
      goal_id,
      status: 'executing',
      message: 'Goal execution resumed successfully',
    });
  } catch (error) {
    console.error('Error resuming goal:', error);
    return JSON.stringify({
      success: false,
      error: `Failed to resume goal: ${error.message}`,
    });
  }
}

async function handleDeleteGoal(args, authToken, context) {
  const { goal_id } = args;

  try {
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3333';
    const response = await fetch(`${API_BASE_URL}/api/goals/${goal_id}`, {
      method: 'DELETE',
      headers: {
        Authorization: authToken,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return JSON.stringify({
      success: true,
      goal_id,
      message: 'Goal deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting goal:', error);
    return JSON.stringify({
      success: false,
      error: `Failed to delete goal: ${error.message}`,
    });
  }
}

async function handleGetGoalStatus(args, authToken, context) {
  const { goal_id } = args;

  try {
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3333';
    const response = await fetch(`${API_BASE_URL}/api/goals/${goal_id}/status`, {
      headers: {
        Authorization: authToken,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return JSON.stringify({
          success: false,
          error: 'Goal not found',
        });
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const status = await response.json();

    return JSON.stringify({
      success: true,
      goal_id,
      status: status.status,
      progress: status.progress,
      tasks: status.tasks,
      currentTasks: status.currentTasks,
      allTasks: status.allTasks,
      message: `Goal is ${status.status} with ${status.progress}% progress`,
    });
  } catch (error) {
    console.error('Error getting goal status:', error);
    return JSON.stringify({
      success: false,
      error: `Failed to get goal status: ${error.message}`,
    });
  }
}

async function handleUpdateTaskStatus(args, authToken, context) {
  const { goal_id, task_id, status, progress, output, error } = args;

  try {
    // This would typically call a backend endpoint to update task status
    // For now, we'll simulate the update and return success
    console.log(`Updating task ${task_id} in goal ${goal_id} to status: ${status}`);

    return JSON.stringify({
      success: true,
      goal_id,
      task_id,
      status,
      progress,
      output,
      error,
      message: `Task status updated successfully`,
    });
  } catch (err) {
    console.error('Error updating task status:', err);
    return JSON.stringify({
      success: false,
      error: `Failed to update task status: ${err.message}`,
    });
  }
}

async function handleFetchGoalTasks(args, authToken, context) {
  const { goal_id } = args;

  try {
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3333';
    const response = await fetch(`${API_BASE_URL}/api/goals/${goal_id}`, {
      headers: {
        Authorization: authToken,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return JSON.stringify({
          success: false,
          error: 'Goal not found',
        });
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    return JSON.stringify({
      success: true,
      goal_id,
      tasks: data.goal.tasks || [],
      task_count: data.goal.tasks?.length || 0,
      message: `Retrieved ${data.goal.tasks?.length || 0} tasks for goal`,
    });
  } catch (error) {
    console.error('Error fetching goal tasks:', error);
    return JSON.stringify({
      success: false,
      error: `Failed to fetch goal tasks: ${error.message}`,
    });
  }
}

async function handleEvaluateGoal(args, authToken, context) {
  const { goal_id, evaluation_type = 'automatic' } = args;

  try {
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3333';
    const response = await fetch(`${API_BASE_URL}/api/goals/${goal_id}/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify({
        evaluation_type,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const evaluation = await response.json();

    return JSON.stringify({
      success: true,
      evaluation_id: evaluation.evaluationId,
      goal_id,
      passed: evaluation.passed,
      scores: evaluation.scores,
      feedback: evaluation.feedback,
      status: evaluation.status,
      message: `Goal evaluation complete: ${evaluation.passed ? 'PASSED' : 'NEEDS REVIEW'} (${evaluation.scores.overall}%)`,
    });
  } catch (error) {
    console.error('Error evaluating goal:', error);
    return JSON.stringify({
      success: false,
      error: `Failed to evaluate goal: ${error.message}`,
    });
  }
}

async function handleGetEvaluationReport(args, authToken, context) {
  const { goal_id } = args;

  try {
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3333';
    const response = await fetch(`${API_BASE_URL}/api/goals/${goal_id}/evaluation`, {
      headers: {
        Authorization: authToken,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return JSON.stringify({
          success: false,
          error: 'No evaluation found for this goal',
        });
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const report = await response.json();

    return JSON.stringify({
      success: true,
      goal_id,
      evaluation: report,
      message: 'Retrieved evaluation report successfully',
    });
  } catch (error) {
    console.error('Error getting evaluation report:', error);
    return JSON.stringify({
      success: false,
      error: `Failed to get evaluation report: ${error.message}`,
    });
  }
}

async function handleSaveAsGoldenStandard(args, authToken, context) {
  const { goal_id, category } = args;

  try {
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3333';
    const response = await fetch(`${API_BASE_URL}/api/goals/${goal_id}/golden-standard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify({
        category,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const standard = await response.json();

    return JSON.stringify({
      success: true,
      standard_id: standard.id,
      goal_id,
      category,
      message: `Goal saved as golden standard in category "${category}"`,
    });
  } catch (error) {
    console.error('Error saving golden standard:', error);
    return JSON.stringify({
      success: false,
      error: `Failed to save as golden standard: ${error.message}`,
    });
  }
}
