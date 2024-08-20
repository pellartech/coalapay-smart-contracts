// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract CoalaPay is ERC721, AccessControl {
    using Strings for uint256;

    event AddTokenInfo(uint256 tokenId, string projectId, TokenInfo tokenInfo);

    event SetTokenInfo(uint256 tokenId, TokenInfo tokenInfo);

    struct TokenInfo {
        address receiver;
        address paymentToken;
        uint256 price;
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

    function setBaseUri(string calldata _baseUri) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseUri = _baseUri;
    }

    function setFee(uint256 _feePercent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        feePercent = _feePercent;
    }

    function setFeeTo(address _feeTo) external onlyRole(DEFAULT_ADMIN_ROLE) {
        feeTo = _feeTo;
    }

    function addToken(TokenInfo calldata _tokenInfo, string calldata _projectId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 tokenId = totalSupply;
        tokenInfos[tokenId] = _tokenInfo;
        totalSupply ++;
        emit AddTokenInfo(tokenId, _projectId, _tokenInfo);
    }

    function updateToken(uint256 _tokenId, TokenInfo calldata _tokenInfo) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(totalSupply > _tokenId, "Invalid token");
        tokenInfos[_tokenId] = _tokenInfo;
        emit SetTokenInfo(_tokenId, _tokenInfo);
    }

    function updateTokenUri(uint256 _tokenId, string calldata _tokenUri) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(totalSupply > _tokenId, "Invalid token");
        tokenUris[_tokenId] = _tokenUri;
    }

    function mint(address to, uint256 tokenId) external payable {
        _safeMint(to, tokenId);
        TokenInfo memory _tokenInfo = tokenInfos[tokenId];
        uint256 fee = getFee(_tokenInfo.price);
        transferPayment(_tokenInfo.receiver, _tokenInfo.paymentToken, _tokenInfo.price, fee);
    }

    function adminMint(address to, uint256 tokenId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _safeMint(to, tokenId);
    }

    function transferPayment(address to, address paymentToken, uint256 amount, uint256 fee) internal {
        if (paymentToken == address(0)) {
            require(amount + fee == msg.value, "Incorrect token price");
            (bool fullAmountSuccess, ) = to.call{ value: amount }("");
            require(fullAmountSuccess, "Transfer full amount failed");
            (bool feeAmountSuccess, ) = feeTo.call{ value: fee }("");
            require(feeAmountSuccess, "Transfer fee amount failed");
        } else {
            SafeERC20.safeTransferFrom(IERC20(paymentToken), msg.sender, to, amount);
            SafeERC20.safeTransferFrom(IERC20(paymentToken), msg.sender, feeTo, fee);
        }
    }

    function tokenURI(uint256 _tokenId)
        public
        view
        override
        returns (string memory)
    {
        if (bytes(tokenUris[_tokenId]).length > 0) {
            return tokenUris[_tokenId];
        }
        return string.concat(baseUri, _tokenId.toString());
    }

    function getTokenInfo(uint256 _tokenId) public view returns (TokenInfo memory tokenInfo, uint256 fee) {
        tokenInfo = tokenInfos[_tokenId];
        fee = getFee(tokenInfo.price);
    }

    function getFee(uint256 _fullAmount) public view returns (uint256 fee) {
        fee = (_fullAmount * feePercent) / 10000;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

}