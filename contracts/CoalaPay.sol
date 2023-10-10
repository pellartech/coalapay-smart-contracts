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

    uint256 totalSupply;
    mapping(uint256 => TokenInfo) tokenInfo;
    string baseUri;

    constructor() ERC721("Coala Pay", "CPAY") Ownable(msg.sender) {}

    function setBaseUri(string calldata _baseUri) external onlyOwner {
        baseUri = _baseUri;
    }

    function addToken(TokenInfo calldata _tokenInfo) external onlyOwner {
        uint256 tokenId = totalSupply;
        tokenInfo[tokenId] = _tokenInfo;
        totalSupply ++;
        emit SetTokenInfo(_tokenInfo);
    }

    function updateTokenPaymentInfo(uint256 _tokenId, address _paymentToken, uint256 _price) external onlyOwner {
        require(totalSupply > _tokenId, "Invalid token");
        TokenInfo storage _tokenInfo = tokenInfo[_tokenId];
        _tokenInfo.paymentToken = _paymentToken;
        _tokenInfo.price = _price;
        emit SetTokenInfo(_tokenInfo);
    }

    function updateTokenReceiver(uint256 _tokenId, address _receiver) external onlyOwner {
        require(totalSupply > _tokenId, "Invalid token");
        TokenInfo storage _tokenInfo = tokenInfo[_tokenId];
        _tokenInfo.receiver = _receiver;
        emit SetTokenInfo(_tokenInfo);
    }

    function updateToken(uint256 _tokenId, TokenInfo calldata _tokenInfo) external onlyOwner {
        require(totalSupply > _tokenId, "Invalid token");
        tokenInfo[_tokenId] = _tokenInfo;
        emit SetTokenInfo(_tokenInfo);
    }

    function mint(address to, uint256 tokenId) external payable {
        _safeMint(to, tokenId);
        TokenInfo memory _tokenInfo = tokenInfo[tokenId];
        transferPayment(_tokenInfo.receiver, _tokenInfo.paymentToken, _tokenInfo.price);
    }

    function adminMint(address to, uint256 tokenId) external onlyOwner {
        _safeMint(to, tokenId);
    }

    function transferPayment(address to, address paymentToken, uint256 amount) internal {
        if (paymentToken == address(0)) {
            require(amount == msg.value, "Incorrect token price");
            (bool success, ) = to.call{ value: amount }("");
            require(success, "Transfer failed");
        } else {
            IERC20(paymentToken).transferFrom(msg.sender, to, amount);
        }
    }

    function getTokenInfo(uint256 _tokenId) external view returns (TokenInfo memory) {
        return tokenInfo[_tokenId];
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        return string.concat(baseUri, tokenId.toString());
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