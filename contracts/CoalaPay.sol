// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract CoalaPay is ERC721, AccessControl, ReentrancyGuard {
    using Strings for uint256;

    event AddTokenInfo(uint256 tokenId, string projectId, TokenInfo tokenInfo);

    event SetTokenInfo(uint256 tokenId, TokenInfo tokenInfo);

    struct Recipient {
        address receiver;
        uint256 amount;
    }

    struct TokenInfo {
        address paymentToken;
        uint256 price;
        Recipient[] recipients;
    }

    uint256 public totalSupply;
    address public feeTo = 0x21c10038fC68d1f05400b2693dAe30772a1736a3;
    uint256 public feePercent = 500; //5%
    mapping(uint256 => TokenInfo) public tokenInfos;
    mapping(uint256 => string) public tokenUris;
    string public baseUri;

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _baseURI
    ) ERC721(_name, _symbol) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        baseUri = _baseURI;
    }

    function setBaseUri(
        string calldata _baseUri
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseUri = _baseUri;
    }

    function setFee(uint256 _feePercent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        feePercent = _feePercent;
    }

    function setFeeTo(address _feeTo) external onlyRole(DEFAULT_ADMIN_ROLE) {
        feeTo = _feeTo;
    }

    function addToken(
        TokenInfo calldata _tokenInfo,
        string calldata _projectId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _validateTokenInfo(_tokenInfo);
        uint256 tokenId = totalSupply;
        tokenInfos[tokenId] = _tokenInfo;
        totalSupply++;
        emit AddTokenInfo(tokenId, _projectId, _tokenInfo);
    }

    function updateToken(
        uint256 _tokenId,
        TokenInfo calldata _tokenInfo
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(totalSupply > _tokenId, "Invalid token");
        _validateTokenInfo(_tokenInfo);
        tokenInfos[_tokenId] = _tokenInfo;
        emit SetTokenInfo(_tokenId, _tokenInfo);
    }

    function updateTokenUri(
        uint256 _tokenId,
        string calldata _tokenUri
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(totalSupply > _tokenId, "Invalid token");
        tokenUris[_tokenId] = _tokenUri;
    }

    function mint(address to, uint256 tokenId) external payable nonReentrant {
        require(tokenId < totalSupply, "Invalid token");
        _safeMint(to, tokenId);
        TokenInfo memory _tokenInfo = tokenInfos[tokenId];
        uint256 fee = getFee(_tokenInfo.price);
        transferPayment(_tokenInfo, fee);
    }

    function adminMint(
        address to,
        uint256 tokenId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _safeMint(to, tokenId);
    }

    function transferPayment(TokenInfo memory tokenInfo, uint256 fee) internal {
        if (tokenInfo.paymentToken == address(0)) {
            require(
                tokenInfo.price + fee == msg.value,
                "Incorrect token price"
            );

            (bool feeAmountSuccess, ) = feeTo.call{value: fee}("");
            require(feeAmountSuccess, "Transfer fee amount failed");

            for (uint256 i = 0; i < tokenInfo.recipients.length; i++) {
                (bool fullAmountSuccess, ) = tokenInfo
                    .recipients[i]
                    .receiver
                    .call{value: tokenInfo.recipients[i].amount}("");
                require(fullAmountSuccess, "Transfer full amount failed");
            }
        } else {
            SafeERC20.safeTransferFrom(
                IERC20(tokenInfo.paymentToken),
                msg.sender,
                feeTo,
                fee
            );

            for (uint256 i = 0; i < tokenInfo.recipients.length; i++) {
                SafeERC20.safeTransferFrom(
                    IERC20(tokenInfo.paymentToken),
                    msg.sender,
                    tokenInfo.recipients[i].receiver,
                    tokenInfo.recipients[i].amount
                );
            }
        }
    }

    function tokenURI(
        uint256 _tokenId
    ) public view override returns (string memory) {
        if (bytes(tokenUris[_tokenId]).length > 0) {
            return tokenUris[_tokenId];
        }
        return string.concat(baseUri, _tokenId.toString());
    }

    function getTokenInfo(
        uint256 _tokenId
    ) public view returns (TokenInfo memory tokenInfo, uint256 fee) {
        tokenInfo = tokenInfos[_tokenId];
        fee = getFee(tokenInfo.price);
    }

    function getFee(uint256 _fullAmount) public view returns (uint256 fee) {
        fee = (_fullAmount * feePercent) / 10000;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _validateTokenInfo(TokenInfo calldata _tokenInfo) internal pure {
        require(_tokenInfo.recipients.length > 0, "Recipients are required");
        require(_tokenInfo.price > 0, "Price is required");
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < _tokenInfo.recipients.length; i++) {
            require(_tokenInfo.recipients[i].amount > 0, "Recipient amount is 0");
            require(_tokenInfo.recipients[i].receiver != address(0), "Recipient receiver is 0");
            totalAmount += _tokenInfo.recipients[i].amount;
        }
        require(_tokenInfo.price == totalAmount, "Invalid price");
    }
}
