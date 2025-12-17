// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
contract LastMileCashPayments is AccessControl, ReentrancyGuard, ERC721 {
    using SafeERC20 for IERC20;
    using Strings for uint256;
    /* ---------- Roles ---------- */
    bytes32 public constant BATCH_PROCESSOR_ROLE =
        keccak256("BATCH_PROCESSOR_ROLE");

    /* ---------- Fee config ---------- */
    address public feeTo;
    uint256 public feePercent = 0; // 5 % (basis-points)

    /* ---------- Storage ---------- */

    struct Batch {
        uint256 projectId; // which project this batch belongs to
        uint256 beneficiaries; // human-readable count (filled at process time)
        uint256 amount; // sum of recipient amounts
        bool processed; // true once funds transferred
    }

    struct Project {
        address donor;
        address organisation;
        IERC20 token;
        uint256 budget;
        uint256 paid;
        uint256 scheduled;
        uint256 beneficiaries;
        uint256 feePaid;
        uint256 orgFeePaid;
        // Organization fee configuration (per project), paid only on completion.
        address[] orgFeeRecipients;
        uint16[] orgFeeBps; // per-recipient bps; sum must be <= 10000 (100%)
        bool prefunded;
        bool completed;
    }

    uint256 public nextProjectId = 1;
    mapping(uint256 => uint256) public nextBatchSeq; // projectId => next batch #
    mapping(uint256 => Project) public projects;
    mapping(uint256 => mapping(uint256 => Batch)) public batches; // projectId => batchId => Batch
    mapping(uint256 => mapping(uint256 => mapping(string => uint256)))
        public payments; // projectId => batchId => household => amount

    string private _baseTokenURI;

    /* ---------- Events ---------- */
    event ProjectCreated(
        uint256 indexed projectId,
        address indexed donor,
        address indexed organisation,
        address token,
        uint256 budget,
        bool prefunded,
        string projectKey
    );
    event BatchCreated(uint256 indexed batchId, uint256 indexed projectId);
    event BatchProcessed(
        uint256 indexed projectId,
        uint256 indexed batchId,
        uint256 batchAmount,
        uint256 feeAmount,
        uint256 beneficiaryCount
    );
    event ProjectCompleted(
        uint256 indexed projectId,
        address donor,
        uint256 beneficiaries,
        uint256 paid,
        uint256 feePaid,
        uint256 orgFeePaid
    );
    event BaseURISet(string oldBase, string newBase);
    event ProjectPrefunded(
        uint256 indexed projectId,
        address indexed donor,
        uint256 budget,
        uint256 fee
    );
    event FeePercentUpdated(uint256 oldFee, uint256 newFee);
    event FeeToUpdated(address oldAddr, address newAddr);
    event ProjectOrgFeeRecipientsUpdated(
        uint256 indexed projectId,
        address[] recipients,
        uint16[] bps
    );
    event OrgFeesDistributed(
        uint256 indexed projectId,
        uint256 totalOrgFee,
        address[] recipients,
        uint256[] amounts
    );

    /* ---------- Constructor ---------- */
    constructor(
        string memory _name,
        string memory _symbol,
        string memory _baseURI,
        address _initialAdmin,
        address _feeTo
    ) ERC721(_name, _symbol) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DEFAULT_ADMIN_ROLE, _initialAdmin);
        feeTo = _feeTo;
        _baseTokenURI = _baseURI;
    }
    /* ---------- Admin ---------- */
    function setBaseURI(
        string calldata newBase
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit BaseURISet(_baseTokenURI, newBase);
        _baseTokenURI = newBase;
    }

    function setFeePercent(
        uint256 newPercent
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newPercent <= 10_000, "fee>100%");
        emit FeePercentUpdated(feePercent, newPercent);
        feePercent = newPercent;
    }

    function setFeeTo(address newFeeTo) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFeeTo != address(0), "feeTo=0");
        emit FeeToUpdated(feeTo, newFeeTo);
        feeTo = newFeeTo;
    }

    /* ---------- Fee helper ---------- */
    function getFee(uint256 _amount) public view returns (uint256) {
        return (_amount * feePercent) / 10_000;
    }

    function _calcProcessingFee(
        uint256 _amount
    ) internal view returns (uint256) {
        return (_amount * feePercent) / 10_000;
    }

    function _orgFeeTotalBps(
        Project storage p
    ) internal view returns (uint16 total) {
        uint256 len = p.orgFeeBps.length;
        for (uint256 i; i < len; ++i) {
            total += p.orgFeeBps[i];
        }
    }

    function _calcOrgFee(
        Project storage p,
        uint256 _amount
    ) internal view returns (uint256) {
        uint16 totalBps = _orgFeeTotalBps(p);
        return (_amount * totalBps) / 10_000;
    }

    /* ---------- Project lifecycle ---------- */
    function _createProject(
        address organisation,
        IERC20 token,
        uint256 budget,
        address donor,
        string calldata projectKey
    ) internal returns (uint256 projectId) {
        require(organisation != address(0), "organisation=0");
        require(budget > 0, "budget=0");

        projectId = nextProjectId++;
        projects[projectId] = Project({
            donor: donor,
            organisation: organisation,
            token: token,
            budget: budget,
            paid: 0,
            scheduled: 0,
            beneficiaries: 0,
            feePaid: 0,
            orgFeePaid: 0,
            orgFeeRecipients: new address[](0),
            orgFeeBps: new uint16[](0),
            prefunded: false,
            completed: false
        });

        emit ProjectCreated(
            projectId,
            donor,
            organisation,
            address(token),
            budget,
            false,
            projectKey
        );
    }

    /**
     * @notice Create a project with per-project fee configuration.
     * @dev orgRecipients/orgBps must be same length, sum(orgBps) <= 10000 (100%).
     * processingFeeBps must be <= 10000 (100%).
     */
    function createProject(
        address organisation,
        IERC20 token,
        uint256 budget,
        address donor,
        string calldata projectKey,
        address[] calldata orgRecipients,
        uint16[] calldata orgBps
    )
        external
        nonReentrant
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (uint256 projectId)
    {
        projectId = _createProject(
            organisation,
            token,
            budget,
            donor,
            projectKey
        );
        _setProjectOrgFees(projectId, orgRecipients, orgBps);
    }

    function _setProjectOrgFees(
        uint256 projectId,
        address[] memory recipients,
        uint16[] memory bps
    ) internal {
        require(recipients.length == bps.length, "len mismatch");
        for (uint256 i; i < recipients.length; ++i) {
            require(recipients[i] != address(0), "recipient=0");
        }
        uint256 totalBps;
        for (uint256 i; i < bps.length; ++i) {
            totalBps += bps[i];
        }
        require(totalBps <= 10000, "orgFee>100%");
        Project storage p = projects[projectId];
        // overwrite arrays
        p.orgFeeRecipients = recipients;
        p.orgFeeBps = bps;
        emit ProjectOrgFeeRecipientsUpdated(projectId, recipients, bps);
    }

    /**
     * @notice Prefund a project with tokens (budget + upfront fee).
     * @dev This is used to transfer tokens from the donor to the contract
     * before any batches are processed. The donor can later withdraw any
     * unspent funds after the project is completed.
     * @param projectId ID of the project to prefund.
     * @dev The project must not be completed, must not have been paid yet,
     * and must not have been prefunded already.
     */

    function prefundProject(uint256 projectId) external nonReentrant {
        Project storage p = projects[projectId];
        require(projectId != 0 && !p.completed, "invalid project");
        require(p.paid == 0, "already paid");
        require(!p.prefunded, "already prefunded");

        uint256 upfrontProcFee = _calcProcessingFee(p.budget);
        uint256 upfrontOrgFee = _calcOrgFee(p, p.budget);
        uint256 total = p.budget + upfrontProcFee + upfrontOrgFee;

        p.prefunded = true;
        p.token.safeTransferFrom(msg.sender, address(this), total);

        emit ProjectPrefunded(
            projectId,
            msg.sender,
            p.budget,
            upfrontProcFee + upfrontOrgFee
        );
    }

    /* ---------- Batch handling ---------- */
    /**
     * @notice Register a new batch for a given project.
     * @dev Callable by the same backend that later calls `processBatch`.
     */
    function createBatch(
        uint256 projectId
    ) external onlyRole(BATCH_PROCESSOR_ROLE) returns (uint256 batchId) {
        Project storage p = projects[projectId];
        require(projectId != 0 && !p.completed, "invalid project");

        batchId = ++nextBatchSeq[projectId]; // starts at 1 per project
        batches[projectId][batchId] = Batch({
            projectId: projectId,
            beneficiaries: 0,
            amount: 0,
            processed: false
        });

        emit BatchCreated(batchId, projectId);
    }

    /**
     * @notice Add recipients to a batch.
     * @dev This is called by the backend to add households and amounts
     * to a batch before it is processed.
     * @param projectId ID of the project this batch belongs to.
     * @param batchId ID of the batch to add recipients to.
     * @param recipients Array of household identifiers (e.g. hashes).
     * @param amounts Array of amounts corresponding to each recipient.
     */
    function addRecipients(
        uint256 projectId,
        uint256 batchId,
        string[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyRole(BATCH_PROCESSOR_ROLE) {
        require(recipients.length == amounts.length, "len mismatch");
        require(recipients.length > 0, "empty");

        Batch storage b = batches[projectId][batchId];
        Project storage p = projects[projectId];
        require(!b.processed, "already processed");
        require(!p.completed, "project done");

        uint256 totalAmount = 0;

        for (uint256 i; i < recipients.length; ++i) {
            string memory hh = recipients[i];
            uint256 amt = amounts[i];
            require(amt > 0, "amount=0");
            require(payments[projectId][batchId][hh] == 0, "household paid");

            payments[projectId][batchId][hh] = amt;
            totalAmount += amt;
        }

        b.amount += totalAmount;
        b.beneficiaries += recipients.length;
        p.scheduled += totalAmount;
        p.beneficiaries += recipients.length;

        require(p.paid + p.scheduled <= p.budget, "exceeds budget");
    }

    function processBatch(
        uint256 projectId,
        uint256 batchId
    ) external nonReentrant onlyRole(BATCH_PROCESSOR_ROLE) {
        Batch storage b = batches[projectId][batchId];
        require(!b.processed, "batch already processed");
        require(b.amount > 0, "amount=0");

        Project storage p = projects[projectId];
        require(!p.completed, "project done");

        uint256 feeAmount = _calcProcessingFee(b.amount);
        p.feePaid += feeAmount;
        // move scheduled to paid on processing
        require(p.scheduled >= b.amount, "scheduled underflow");
        p.scheduled -= b.amount;
        p.paid += b.amount;
        _transferPaymentToOrganisation(p, b.amount, feeAmount);

        b.processed = true;

        emit BatchProcessed(
            projectId,
            batchId,
            b.amount,
            feeAmount,
            b.beneficiaries
        );
    }

    /**
     * @notice Finalise a project. Mints an NFT receipt and refunds any unused funds.
     */
    function completeProject(uint256 projectId) external nonReentrant {
        Project storage p = projects[projectId];
        require(!p.completed, "already done");
        require(
            msg.sender == p.donor || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "not authorised"
        );
        p.completed = true;

        // Calculate and distribute organization fees on completion (no batches)
        _distributeOrgFees(p, projectId);

        if (p.prefunded) {
            uint256 principalLeft = p.budget - p.paid;
            uint256 procFeeLeft = _calcProcessingFee(p.budget) - p.feePaid;
            uint256 orgFeeLeft = _calcOrgFee(p, p.budget) - p.orgFeePaid;
            uint256 refund = principalLeft + procFeeLeft + orgFeeLeft;

            if (refund > 0) {
                p.token.safeTransfer(p.donor, refund);
            }
        }

        _safeMint(p.donor, projectId);
        emit ProjectCompleted(
            projectId,
            p.donor,
            p.beneficiaries,
            p.paid,
            p.feePaid,
            p.orgFeePaid
        );
    }

    /* ─────────── Internal helpers ─────────── */
    function _distributeOrgFees(Project storage p, uint256 projectId) internal {
        uint256 totalOrgFee = _calcOrgFee(p, p.paid);
        if (totalOrgFee == 0 || p.orgFeeRecipients.length == 0) {
            p.orgFeePaid = 0;
            return;
        }
        uint256[] memory distributed = new uint256[](p.orgFeeRecipients.length);
        uint256 running;
        for (uint256 i; i < p.orgFeeRecipients.length; ++i) {
            uint256 amount;
            if (i == p.orgFeeRecipients.length - 1) {
                amount = totalOrgFee - running;
            } else {
                amount = (totalOrgFee * p.orgFeeBps[i]) / 10_000;
                running += amount;
            }
            distributed[i] = amount;
            if (amount == 0) continue;
            _transferPaymentTo(p.orgFeeRecipients[i], p, amount);
        }
        p.orgFeePaid = totalOrgFee;
        emit OrgFeesDistributed(
            projectId,
            totalOrgFee,
            p.orgFeeRecipients,
            distributed
        );
    }

    function _transferPaymentToOrganisation(
        Project storage p,
        uint256 amount,
        uint256 fee
    ) internal {
        if (p.prefunded) {
            p.token.safeTransfer(p.organisation, amount);
            p.token.safeTransfer(feeTo, fee);
        } else {
            p.token.safeTransferFrom(p.donor, p.organisation, amount);
            p.token.safeTransferFrom(p.donor, feeTo, fee);
        }
    }

    function _transferPaymentTo(
        address to,
        Project storage p,
        uint256 amount
    ) internal {
        if (p.prefunded) {
            p.token.safeTransfer(to, amount);
        } else {
            p.token.safeTransferFrom(p.donor, to, amount);
        }
    }

    /* ---------- Views ---------- */
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /**
     * @dev Needed because of multiple inheritance.
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(AccessControl, ERC721) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function tokenURI(
        uint256 _tokenId
    ) public view override returns (string memory) {
        return
            string.concat(
                _baseTokenURI,
                Strings.toHexString(uint256(uint160(address(this))), 20),
                "/",
                _tokenId.toString()
            );
    }
}
