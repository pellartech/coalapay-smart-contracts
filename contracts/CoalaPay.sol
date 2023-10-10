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
    mapping(uint256 => TokenInfo) public tokenInfo;
    mapping(uint256 => string) public tokenUris;
    string public baseUri;

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

    function updateToken(uint256 _tokenId, TokenInfo calldata _tokenInfo) external onlyOwner {
        require(totalSupply > _tokenId, "Invalid token");
        tokenInfo[_tokenId] = _tokenInfo;
        emit SetTokenInfo(_tokenInfo);
    }

    function updateTokenUri(uint256 _tokenId, string calldata _tokenUri) external onlyOwner {
        require(totalSupply > _tokenId, "Invalid token");
        tokenUris[_tokenId] = _tokenUri;
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

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

}