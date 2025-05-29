// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract CoalaPayV2 is ERC721, AccessControl, ReentrancyGuard {
    using Strings for uint256;

    enum PaymentType {
        ESCROW,
        AUTHORISED
    }

    event AddTokenInfo(uint256 tokenId, string projectId, TokenInfo tokenInfo);

    event SetTokenInfo(uint256 tokenId, TokenInfo tokenInfo);

    event MilestonePaid(uint256 tokenId, uint256 milestoneId, uint256 amount);

    struct Milestone {
        uint256 amount;
        bool paid;
        uint256 date;
    }

    struct TokenInfo {
        bool inited;
        PaymentType paymentType;
        address receiver; // the recipient address of the funds
        address paymentToken;
        uint256 price;
        Milestone[] milestones;
        address donor; // to be set when the donor funds
        bool refunded;
        uint256 milestonesPaid;
    }

    bytes32 public constant PROJECT_PAYER = keccak256("PROJECT_PAYER");

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

    function setProjectPayer(
        address _projectPayer
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(PROJECT_PAYER, _projectPayer);
    }

    function addToken(
        TokenInfo calldata _tokenInfo,
        string calldata _projectId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 tokenId = totalSupply;
        _validateTokenInfo(_tokenInfo);
        TokenInfo storage tokenInfo = tokenInfos[tokenId];
        for (uint256 i = 0; i < _tokenInfo.milestones.length; i++) {
            tokenInfo.milestones.push(_tokenInfo.milestones[i]);
        }
        tokenInfo.paymentType = _tokenInfo.paymentType;
        tokenInfo.receiver = _tokenInfo.receiver;
        tokenInfo.paymentToken = _tokenInfo.paymentToken;
        tokenInfo.price = _tokenInfo.price;
        totalSupply++;
        emit AddTokenInfo(tokenId, _projectId, _tokenInfo);
    }

    function updateToken(
        uint256 _tokenId,
        TokenInfo calldata _tokenInfo
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(totalSupply > _tokenId, "Invalid token");
        _validateTokenInfo(_tokenInfo);
        TokenInfo storage tokenInfo = tokenInfos[_tokenId];
        require(!tokenInfo.inited, "Token is not updateable");
        delete tokenInfo.milestones;
        for (uint256 i = 0; i < _tokenInfo.milestones.length; i++) {
            tokenInfo.milestones.push(_tokenInfo.milestones[i]);
        }
        tokenInfo.paymentType = _tokenInfo.paymentType;
        tokenInfo.receiver = _tokenInfo.receiver;
        tokenInfo.paymentToken = _tokenInfo.paymentToken;
        tokenInfo.price = _tokenInfo.price;
        emit SetTokenInfo(_tokenId, _tokenInfo);
    }

    function updateTokenUri(
        uint256 _tokenId,
        string calldata _tokenUri
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(totalSupply > _tokenId, "Invalid token");
        tokenUris[_tokenId] = _tokenUri;
    }

    function payMilestone(
        uint256 _tokenId,
        uint256 _milestoneId
    ) external payable nonReentrant {
        TokenInfo storage _tokenInfo = tokenInfos[_tokenId];
        Milestone storage milestone = _tokenInfo.milestones[_milestoneId];
        require(!milestone.paid, "Milestone already paid");
        require(_tokenInfo.milestonesPaid == _milestoneId, "Sequence error");
        require(
            _tokenInfo.donor == address(0) ||
                hasRole(PROJECT_PAYER, msg.sender) ||
                msg.sender == _tokenInfo.donor,
            "Not project payer"
        );
        milestone.paid = true;
        milestone.date = block.timestamp;

        address payer = msg.sender;

        if (!_tokenInfo.inited) {
            _tokenInfo.inited = true;
            _tokenInfo.donor = payer;

            if (_tokenInfo.paymentType == PaymentType.ESCROW) {
                uint256 _feeAmount = getFee(_tokenInfo.price);
                _receivePayment(
                    payer,
                    _tokenInfo.paymentToken,
                    _tokenInfo.price,
                    _feeAmount
                );
            }
        }

        payer = address(this);
        if (_tokenInfo.paymentType == PaymentType.AUTHORISED) {
            payer = _tokenInfo.donor;
        }

        uint256 feeAmount = getFee(milestone.amount);
        _transferPayment(
            payer,
            address(this),
            _tokenInfo.paymentToken,
            milestone.amount,
            address(this),
            feeAmount
        );
        _transferPayment(
            address(this),
            _tokenInfo.receiver,
            _tokenInfo.paymentToken,
            milestone.amount,
            feeTo,
            feeAmount
        );
        _tokenInfo.milestonesPaid++;

        emit MilestonePaid(_tokenId, _milestoneId, milestone.amount);

        if (_tokenInfo.milestonesPaid == _tokenInfo.milestones.length) {
            _safeMint(_tokenInfo.donor, _tokenId);
        }
    }

    function refund(
        uint256 _tokenId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        TokenInfo storage _tokenInfo = tokenInfos[_tokenId];
        require(!_tokenInfo.refunded, "Token is already refunded");
        require(_tokenInfo.donor != address(0), "Token is not initialized");
        require(
            _tokenInfo.paymentType == PaymentType.ESCROW,
            "Token is not escrow"
        );
        _tokenInfo.refunded = true;

        uint256 fee = 0;
        uint256 amount = 0;
        for (uint256 i = 0; i < _tokenInfo.milestones.length; i++) {
            if (_tokenInfo.milestones[i].paid) continue;
            amount += _tokenInfo.milestones[i].amount;
            fee += getFee(_tokenInfo.milestones[i].amount);
        }
        _transferPayment(
            address(this),
            _tokenInfo.donor,
            _tokenInfo.paymentToken,
            amount,
            _tokenInfo.donor,
            fee
        );
    }

    function adminMint(
        address to,
        uint256 tokenId
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _safeMint(to, tokenId);
    }

    function _transferPayment(
        address from,
        address to,
        address paymentToken,
        uint256 amount,
        address feeReceiver,
        uint256 fee
    ) internal {
        if (from == to) return;
        if (from == address(this)) {
            SafeERC20.safeTransfer(IERC20(paymentToken), to, amount);
            SafeERC20.safeTransfer(IERC20(paymentToken), feeReceiver, fee);
            return;
        }

        SafeERC20.safeTransferFrom(IERC20(paymentToken), from, to, amount);
        SafeERC20.safeTransferFrom(
            IERC20(paymentToken),
            from,
            feeReceiver,
            fee
        );
    }

    function _receivePayment(
        address from,
        address paymentToken,
        uint256 amount,
        uint256 fee
    ) internal {
        SafeERC20.safeTransferFrom(
            IERC20(paymentToken),
            from,
            address(this),
            amount
        );
        SafeERC20.safeTransferFrom(
            IERC20(paymentToken),
            from,
            address(this),
            fee
        );
    }

    function tokenURI(
        uint256 _tokenId
    ) public view override returns (string memory) {
        if (bytes(tokenUris[_tokenId]).length > 0) {
            return tokenUris[_tokenId];
        }
        return string.concat(baseUri, _tokenId.toString());
    }

    function getMilestoneInfo(
        uint256 _tokenId,
        uint256 _milestoneId
    ) public view returns (Milestone memory milestone, uint256 fee) {
        milestone = tokenInfos[_tokenId].milestones[_milestoneId];
        fee = getFee(milestone.amount);
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
        require(
            _tokenInfo.paymentType == PaymentType.AUTHORISED ||
                _tokenInfo.paymentType == PaymentType.ESCROW,
            "Invalid payment type"
        );
        require(_tokenInfo.receiver != address(0), "Receiver is required");
        require(
            _tokenInfo.paymentToken != address(0),
            "Payment token is required"
        );
        require(_tokenInfo.price > 0, "Price is required");
        require(_tokenInfo.milestones.length > 0, "Milestones are required");
        require(_tokenInfo.milestones.length < 11, "Too many milestones");
        uint256 totalMilestonesAmount = 0;
        for (uint256 i = 0; i < _tokenInfo.milestones.length; i++) {
            require(
                _tokenInfo.milestones[i].amount > 0,
                "Milestone amount is 0"
            );
            require(
                _tokenInfo.milestones[i].paid == false,
                "Milestone already paid"
            );
            totalMilestonesAmount += _tokenInfo.milestones[i].amount;
        }
        require(_tokenInfo.price == totalMilestonesAmount, "Invalid price");
    }
}
