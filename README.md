# CoalaPay Smart Contract

This repository contains the `CoalaPay` smart contract, an ERC721-based contract that enables the minting and management of NFTs with integrated payment processing. The contract includes features such as setting custom token URIs, handling payments in various ERC20 tokens, and charging a fee on transactions.

## Features

- Minting NFTs: Allows the minting of ERC721 tokens with associated payment processing.
- Token Management: Admins can update token information, including token URIs and payment details.
- Payment Handling: Supports payments in native currency (e.g., ETH) and ERC20 tokens, with a configurable fee percentage.
- Access Control: Utilizes OpenZeppelin's `AccessControl` to manage administrative roles and permissions.

## Contract Details

Contract Name: `CoalaPay`

### Inheritance

- `ERC721`: Implements the ERC721 standard for non-fungible tokens.
- `AccessControl`: Provides role-based access control to manage permissions.
- `SafeERC20`: Ensures safe handling of ERC20 token transfers.

### State Variables

- `totalSupply`: Tracks the total number of minted tokens.
- `feeTo`: The address that receives the fee from transactions.
- `feePercent`: The percentage fee charged on transactions (in basis points, e.g., 500 = 5%).
- `tokenInfos`: A mapping of token IDs to `TokenInfo` structs, which store payment details for each token.
- `tokenUris`: A mapping of token IDs to their respective URIs.
- `baseUri`: The base URI used to construct the token URI if a specific URI is not set.

### Events

- `AddTokenInfo(uint256 tokenId, string projectId, TokenInfo tokenInfo)`: Emitted when a new token is added.
- `SetTokenInfo(uint256 tokenId, TokenInfo tokenInfo)`: Emitted when a token's information is updated.

### Functions

**Admin Functions:**

- `setBaseUri(string calldata _baseUri)`: Sets the base URI for tokens.
- `setFee(uint256 _feePercent)`: Sets the transaction fee percentage.
- `setFeeTo(address _feeTo)`: Sets the address to receive transaction fees.
- `addToken(TokenInfo calldata _tokenInfo, string calldata _projectId)`: Adds a new token with its payment details.
- `updateToken(uint256 _tokenId, TokenInfo calldata _tokenInfo)`: Updates the payment details of an existing token.
- `updateTokenUri(uint256 _tokenId, string calldata _tokenUri)`: Updates the URI of an existing token.
- `adminMint(address to, uint256 tokenId)`: Mints a new token to the specified address without requiring payment.

**Public Functions:**

- `mint(address to, uint256 tokenId)`: Mints a new token to the specified address, handling payment and fees.
- `tokenURI(uint256 _tokenId)`: Returns the URI of a given token.
- `getTokenInfo(uint256 _tokenId)`: Retrieves the payment information and fee for a given token.
- `getFee(uint256 _fullAmount)`: Calculates the fee based on the given amount.

### Deployment

To deploy the contract using Hardhat and TypeScript, follow these steps:

1.  Install dependencies: `npm install`
2.  Compile the contract: `npx hardhat compile`
3.  Deploy the contract: Create a deployment script under `scripts/` directory, then run `npx hardhat run scripts/deploy.ts --network <network-name>`
4.  Verify the deployment on Etherscan: `npx hardhat verify --network <network-name> <contract-address> <constructor-args>`

### Testing

Write your tests in the `test/` directory using Hardhat's testing framework. Run tests using: `npx hardhat test`

### License

This project is licensed under the MIT License.
