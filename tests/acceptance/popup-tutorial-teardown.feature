# Executable mapping: frontend/src/views/_components/utility/PopupTutorial.spec.js
# Vitest executes the Given/When/Then scenarios; this file is their readable
# acceptance contract, not a second Cucumber runner.
Feature: PopupTutorial scenario isolation
  Tutorial scenarios must release their components before jsdom is torn down.
  Clearing timers or filtering unhandled errors must not hide a leaked fixture.

  Background:
    Given an isolated tutorial scenario with controlled timers
    And a target element and restorable DOM mocks

  Scenario: Positioning retry is pending at scenario completion
    Given a mounted tutorial has scheduled a 20 millisecond positioning retry
    When the scenario ends before that retry fires
    Then the component is unmounted while the DOM still exists
    And no timers remain before the test safety net clears them

  Scenario: Auto-advance is pending at scenario completion
    Given a visible tutorial has scheduled a 1000 millisecond auto-advance
    When the scenario ends before advancement
    Then the pending advancement is cancelled by component unmount
    And no timers remain before the test safety net clears them

  Scenario Outline: All existing tutorial behaviors leave an isolated environment
    Given the tutorial exercises <behavior>
    When the scenario fixture is disposed
    Then no mounted tutorial or target element remains
    And querySelector, scrollIntoView and window dimensions are restored
    And immediate storage events have settled
    And no pending timer remains before safety cleanup

    Examples:
      | behavior             |
      | enabled rendering    |
      | disabled rendering   |
      | next-step content    |
      | close-button event   |
      | final-step completion|
