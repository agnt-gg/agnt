# Vultisig Tool Integration

The Vultisig tool enables secure cryptographic operations across multiple parties without any single party having access to the complete private key material.

## Key Features

- **Create Vaults**: Establish secure multi-party vaults for key management
- **Sign Transactions**: Collaboratively sign blockchain transactions
- **Derive Child Keys**: Generate hierarchical deterministic wallet addresses
- **Export Public Keys**: Share public key information without compromising security

## Getting Started

1. **Connect to Vultisig**: Go to Settings -> Connected Services and connect your Vultisig account
2. **Create a Vault**: Use the "createVault" operation with at least one other party
3. **Store Key Data**: Save the returned key data securely for future operations
4. **Perform Operations**: Use the stored key data for signing and other operations

## Multi-Party Workflow

For multi-party operations, all parties must:

1. **Agree on a Session ID**: Use the same session ID across all parties
2. **Designate Roles**: One party must be the "initiator" and others "participants"
3. **List Other Parties**: Each party must correctly list all other participating parties
4. **Complete Together**: All required parties must execute their respective nodes within the timeout period

## Security Considerations

- **Key Data**: The key data returned by operations contains sensitive material and should be stored securely
- **Encryption Key**: Use a strong encryption key and keep it secure
- **Threshold**: Setting a threshold less than the total number of parties allows operations to complete with a subset of parties

## Example: Two-Party Vault Creation

For Party 1 (Initiator):
- Operation: createVault
- Party Role: initiator
- Party ID: party1
- Other Parties: party2
- Session ID: [shared-session-id]

For Party 2 (Participant):
- Operation: createVault
- Party Role: participant
- Party ID: party2
- Other Parties: party1
- Session ID: [same-shared-session-id]

Both parties must execute their respective nodes for the operation to complete successfully.