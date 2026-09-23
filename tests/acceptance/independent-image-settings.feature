Feature: Independent image settings with revocable connection consent
  # Contract/storage scenarios execute in imageSettingsContract.bdd.test.js and
  # imageSettingsStore.bdd.test.js using Vitest, not a Cucumber runtime.

  @contract
  Scenario: Text provider changes do not choose the image provider
    Given server-owned image settings select connection A
    When the text provider changes to B
    Then the image request remains bound to A

  @sqlite
  Scenario: Concurrent writers cannot overwrite consent
    Given two SQLite connections read the same settings revision
    When both attempt a compare-and-swap write
    Then exactly one commits
    And the other reports a revision conflict

  @contract
  Scenario: Revocation invalidates work waiting to dispatch
    Given an issued subscription image request with consent revision N
    When consent is revoked and later regranted
    Then the old request fails pre-dispatch validation
    And it is not resurrected by the new grant

  @contract
  Scenario: Account alias replacement does not inherit consent
    Given an issued request bound to account identity A
    When the connection slot is rebound to identity B
    Then pre-dispatch validation rejects the old request
    And token refresh that preserves A does not itself revoke consent

  @compatibility
  Scenario: Explicit API workflows retain routing
    Given no interactive image default is configured
    When a trusted workflow entry supplies an explicit API connection and pin
    Then that request retains its connection and model
    And an explicit subscription workflow still requires current consent

  @preserved @browser
  Scenario: Reuse a prior result as a draft attachment
    Given a native saved-image receipt in the current conversation
    When the user explicitly selects it in the reference picker
    Then one bounded PNG is attached to the draft
    And no chat or generation request is sent
    And switching conversations removes that reference but preserves ordinary attachments

  @not_implemented @integration
  Scenario: Settings screen through real provider execution
    Given authenticated production settings and a qualified server connection resolver
    When the user saves image options and applicable consent
    And submits a generate or edit request from chat
    Then storage revisions and connection identity are revalidated before dispatch
    And the selected image provider is used independently of text routing
    And the artifact is saved and displayed
