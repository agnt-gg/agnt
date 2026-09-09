Feature: Two distinct subscription image choices in AGNT
  Image selection must not silently use a default model, another account, or API billing.
  Text Fast is independent of image policy.

  # Executed Given/When/Then scenarios live in the *.bdd.test.js/*.bdd.spec.js
  # and codexImageIntent.test.js files. These are Vitest, not a Cucumber runner.
  @implemented @safety
  Scenario Outline: Freeze the user's image policy for this turn
    Given the selected Codex account has enabled subscription images
    And the preferred image policy is <policy>
    When a chat request is encoded as JSON or multipart
    Then the backend receives that exact policy and account
    And later preference changes do not mutate the bound intent
    Examples:
      | policy      |
      | latest      |
      | latest-fast |

  @implemented @safety
  Scenario Outline: Refuse silent provider or model fallback
    Given a turn bound to account1 and latest
    When a native image tool or workflow action requests <substitution>
    Then the call is rejected before image dispatch or API credential lookup
    And the result is not retryable
    Examples:
      | substitution          |
      | OpenAI API provider   |
      | Codex account2        |
      | provider-default      |
      | latest-fast           |

  @implemented @ui
  Scenario: Persist independent account-specific preferences
    Given Standard text speed and image generation disabled
    When I enable subscription images and choose Latest Fast
    Then Standard text speed remains selected
    And the image preference survives storage reload
    And switching to another account does not copy consent
    And no generation request is sent just by changing controls
    And the UI says both choices remain blocked

  @implemented @references
  Scenario: Resolve only explicit current-turn PNG uploads
    Given host-owned PNG uploads for this turn
    When the model references upload:1 explicitly
    Then only that upload's bytes are forwarded
    And paths, URLs, wrong-turn handles and duplicate handles are rejected

  @blocked @release
  Scenario Outline: Actually generate with a distinct supported subscription choice
    Given authoritative Codex evidence for distinct quality and speed selectors
    And the selected account is entitled to <policy>
    When I generate a UI concept from the rendered AGNT chat
    Then the provider acknowledgment establishes the accepted <policy>
    And the request tree contains no API-key billing route or fallback
    And the image is persisted and shown inline
    Examples:
      | policy      |
      | latest      |
      | latest-fast |

  @blocked @release
  Scenario: Ignore-selector negative control prevents false certification
    Given a backend that returns its default image for every selector
    When the requested selector is invalid or its acknowledgment is missing
    Then the two-choice release gate fails
    And no image or returned label is claimed as verified selection

  @blocked @release
  Scenario: Iteratively edit an explicitly selected prior result
    Given a persisted generated image selected in the real chat UI
    When I request an edit with either supported image policy
    Then the backend resolves an authorized prior-image handle
    And the requested policy is acknowledged and the edited result is displayed

  @implemented @ui @browser
  Scenario: Explicitly reuse a prior result without automatically sending
    Given a persisted native image receipt in the current conversation
    When I open Use a previous image and select its entry
    Then one bounded PNG media request loads the selected file
    And the file appears in the composer attachment chips
    And no chat or generation request is sent
    And switching conversation removes that reference but preserves ordinary attachments

  @implemented @safety
  Scenario: Cancel a pending reference load without leaking into another conversation
    Given a reference download is pending
    When the picker closes, unmounts, or its conversation scope changes
    Then the request is aborted and late results cannot attach
    And mismatched message collections offer no image choice
