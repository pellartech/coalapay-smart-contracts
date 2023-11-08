// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract CoalaPay is ERC721, Ownable {
    using Strings for uint256;

    event SetTokenInfo(TokenInfo tokenInfo);

    struct TokenInfo {
        address receiver;
        address paymentToken;
        uint256 price;
    }

    uint256 public totalSupply;
    address public feeTo = 0x96Bb94A6349a2Dd9CCB2d953c86ad64e949A9f88;
    uint256 public feePercent = 500; //5%
    mapping(uint256 => TokenInfo) public tokenInfos;
    mapping(uint256 => string) public tokenUris;
    string public baseUri = "https://federation-stage.coalapay.org/api/v2/";

    constructor() ERC721("Coala Pay", "CPAY") Ownable(msg.sender) {}

    function setBaseUri(string calldata _baseUri) external onlyOwner {
        baseUri = _baseUri;
    }

    function setFee(uint256 _feePercent) external onlyOwner {
        feePercent = _feePercent;
    }

    function setFeeTo(address _feeTo) external onlyOwner {
        feeTo = _feeTo;
    }

    function addToken(TokenInfo calldata _tokenInfo) external onlyOwner {
        uint256 tokenId = totalSupply;
        tokenInfos[tokenId] = _tokenInfo;
        totalSupply ++;
        emit SetTokenInfo(_tokenInfo);
    }

    function updateToken(uint256 _tokenId, TokenInfo calldata _tokenInfo) external onlyOwner {
        require(totalSupply > _tokenId, "Invalid token");
        tokenInfos[_tokenId] = _tokenInfo;
        emit SetTokenInfo(_tokenInfo);
    }

    function updateTokenUri(uint256 _tokenId, string calldata _tokenUri) external onlyOwner {
        require(totalSupply > _tokenId, "Invalid token");
        tokenUris[_tokenId] = _tokenUri;
    }

    function mint(address to, uint256 tokenId) external payable {
        _safeMint(to, tokenId);
        TokenInfo memory _tokenInfo = tokenInfos[tokenId];
        uint256 fee = getFee(_tokenInfo.price);
        transferPayment(_tokenInfo.receiver, _tokenInfo.paymentToken, _tokenInfo.price, fee);
    }

    function adminMint(address to, uint256 tokenId) external onlyOwner {
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
            IERC20(paymentToken).transferFrom(msg.sender, to, amount);
            IERC20(paymentToken).transferFrom(msg.sender, feeTo, fee);
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
        override(ERC721)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

}