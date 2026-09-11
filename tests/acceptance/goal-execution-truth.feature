Feature: Goal completion reflects execution and evaluation
  # Executable Given/When/Then tests use Vitest, not a Cucumber runtime.

  Scenario: A virtual executor receives its declared tools
    Given a built-in worker without a saved agent row
    When its runtime is assembled
    Then declared available tools are retained within its ceiling
    And missing declared tools fail before a model request
    And client context cannot impersonate a virtual configuration

  Scenario: Explicit failure cannot become completion
    Given a worker reports Status: Blocked
    When its result is persisted
    Then the task is failed with its original output preserved
    And its goal does not validate

  Scenario: Historical failure prose is not a current failure declaration
    Given the result starts Failed initially, then succeeded
    When the completion evidence is inspected
    Then that sentence alone does not mark the task blocked

  Scenario: Aggregate scores cannot hide an unmet required task
    Given an aggregate score above the passing threshold
    And one task has an unmet criterion or failing task score
    When the goal is evaluated
    Then the goal needs review with a rejection reason

  Scenario: Failed-only tool evidence contradicts optimistic prose
    Given every recorded tool response explicitly failed
    When the worker says Done
    Then task completion is rejected
    And mixed traces require evaluator judgment rather than presumed recovery

  Scenario: Evaluator failure is not successful completion
    Given execution has ended
    When grading is unavailable or incomplete
    Then the goal remains needs_review
    And no completed-success notification is emitted beforehand

  Scenario: A write may have committed even when verification fails
    Given a task update reaches storage
    When readback fails
    Then the result distinguishes committed or unknown write state
    And it does not authorize automatic retry

  Scenario: Finished records do not use stale live progress
    Given an inactive goal with current server counters
    And stale live task events remain cached
    When the card renders
    Then it uses the current server counters
